import ICAL from 'ical.js'
import { createHash } from 'node:crypto'
import type { AttendeeStatus, EventAttendee } from '@shared/types'
import { sameMailbox } from '@shared/protonEmail'
import { zoneFormatter, zonedWallTimeToUtc } from '@shared/timezone'
import type { SyncedEventData } from '../database/eventRepository'

/**
 * Converts an ICS document into our internal event format.
 *
 * Recurring events are expanded into individual instances inside a bounded window
 * (default: 6 months back, 18 months ahead). Storing concrete instances keeps the
 * range query in SQLite trivial and lets notes attach to a single occurrence.
 *
 * This module is pure (no Electron imports) so it can be unit tested in Node.
 */

export interface ParseOptions {
  windowStart?: Date
  windowEnd?: Date
  /** Where the feed came from; a Google link names the calendar owner (see ownerEmail). */
  sourceUrl?: string
  /** The owner's address when the app knows it (a Proton account's email). */
  ownerEmail?: string
}

/** Hard caps so a pathological RRULE can't hang the sync. */
const MAX_OCCURRENCES_PER_EVENT = 5000
const MAX_ITERATIONS_PER_EVENT = 200_000

export function parseIcs(calendarId: string, icsText: string, options: ParseOptions = {}): SyncedEventData[] {
  const now = Date.now()
  const windowStart = options.windowStart ?? new Date(now - 183 * 86_400_000)
  const windowEnd = options.windowEnd ?? new Date(now + 548 * 86_400_000)

  let jcal: ReturnType<typeof ICAL.parse>
  try {
    jcal = ICAL.parse(icsText)
  } catch {
    // One malformed line (often from a third-party invite) makes ical.js reject the
    // whole file. Repair what we can and retry; rethrow if it still fails.
    jcal = ICAL.parse(repairIcs(icsText))
  }
  const root = new ICAL.Component(jcal)

  // Embedded VTIMEZONE definitions take priority; IANA TZIDs without a definition
  // are handled by the Intl fallback in toStoredTime().
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tzid = vtz.getFirstPropertyValue('tzid')
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(vtz)
    }
  }

  const all = root.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c))
  const masters = new Map<string, ICAL.Event>()
  const orphanExceptions: ICAL.Event[] = []

  for (const ev of all) {
    if (!ev.isRecurrenceException()) masters.set(ev.uid, ev)
  }
  for (const ev of all) {
    if (!ev.isRecurrenceException()) continue
    const master = masters.get(ev.uid)
    if (master) master.relateException(ev)
    else orphanExceptions.push(ev) // a moved instance whose series we didn't receive
  }

  // Stored times are ISO UTC or YYYY-MM-DD, so the window is compared as text.
  const windowEndIso = windowEnd.toISOString()
  const windowStartDate = windowStart.toISOString().slice(0, 10)

  const out: SyncedEventData[] = []
  const pushEvent = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, externalId: string): void => {
    if (isCancelled(item)) return
    const startTime = toStoredTime(start, item.component.getFirstProperty('dtstart'))
    let endTime = toStoredTime(end, item.component.getFirstProperty('dtend') ?? item.component.getFirstProperty('dtstart'))
    if (start.isDate && endTime <= startTime) endTime = addDays(startTime, 1)
    if (!start.isDate && endTime < startTime) endTime = startTime

    if (startTime >= windowEndIso || endTime < windowStartDate) return // outside the window
    out.push({
      id: makeEventId(calendarId, externalId),
      externalId,
      title: item.summary || '(No title)',
      description: item.description || '',
      startTime,
      endTime,
      allDay: start.isDate,
      location: item.location || '',
      attendees: readAttendees(item),
      myResponse: null // set below, once the owner is known
    })
  }

  for (const master of masters.values()) {
    if (!master.uid) continue
    if (!master.isRecurring()) {
      pushEvent(master, master.startDate, master.endDate, master.uid)
      continue
    }

    const iterator = master.iterator()
    const windowStartMs = windowStart.getTime() - 7 * 86_400_000 // slack for long events
    const windowEndMs = windowEnd.getTime()
    let emitted = 0
    let iterations = 0
    const seen = new Set<string>()
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (++iterations > MAX_ITERATIONS_PER_EVENT) {
        console.warn(`[ics] "${master.summary}": recurrence expansion capped at ${MAX_ITERATIONS_PER_EVENT} iterations`)
        break
      }
      const ms = next.toJSDate().getTime()
      if (ms > windowEndMs || emitted >= MAX_OCCURRENCES_PER_EVENT) break
      if (ms < windowStartMs) continue // old instances of long-running series
      emitted++
      const details = master.getOccurrenceDetails(next)
      // The recurrence id is the *original* slot, so the ID stays stable even if
      // that single instance gets moved in Proton.
      const recurrenceKey = details.recurrenceId.toString()
      seen.add(recurrenceKey)
      pushEvent(details.item, details.startDate, details.endDate, `${master.uid}::${recurrenceKey}`)
    }

    // Instances whose original slot is outside the window but that were *moved*
    // into it are not visited by the loop above; emit them from the exceptions.
    // (pushEvent drops anything that still doesn't overlap the window.)
    const exceptions = (master as unknown as { exceptions: Record<string, ICAL.Event> }).exceptions ?? {}
    for (const [key, ex] of Object.entries(exceptions)) {
      if (!seen.has(key)) pushEvent(ex, ex.startDate, ex.endDate, `${master.uid}::${key}`)
    }
  }

  for (const ev of orphanExceptions) {
    pushEvent(ev, ev.startDate, ev.endDate, `${ev.uid}::${ev.recurrenceId.toString()}`)
  }

  const events = mergeDuplicates(out)
  const owner = ownerEmail(events, [...(options.ownerEmail ? [options.ownerEmail] : []), ...ownerHints(root, options.sourceUrl)])
  if (owner) for (const e of events) e.myResponse = responseOf(e.attendees, owner)
  return events
}

/**
 * Emails the feed itself says belong to the calendar owner: Google's secret address
 * (".../calendar/ical/<email>/private-.../basic.ics") and a calendar name that is an
 * email (Google names primary calendars after the account).
 */
function ownerHints(root: ICAL.Component, sourceUrl: string | undefined): string[] {
  const hints: string[] = []
  const fromUrl = /\/calendar\/ical\/([^/]+)\//i.exec(sourceUrl ?? '')?.[1]
  if (fromUrl) {
    try {
      hints.push(decodeURIComponent(fromUrl))
    } catch {
      // malformed escape: no hint from the link
    }
  }
  hints.push(String(root.getFirstPropertyValue('x-wr-calname') ?? '').trim())
  return hints.filter((h) => h.includes('@')).map((h) => h.toLowerCase())
}

/**
 * The calendar owner's email, used to find their own RSVP. A known address (the Proton
 * account's, or a hint from the feed) wins if it is a guest anywhere; Proton aliases
 * count as the same address. Otherwise it's the guest on the most invitations, since the owner is on
 * every invitation in their calendar (organizers don't count: someone who sends many
 * invites would tie with the owner); a tie means we can't tell, so no RSVPs.
 */
function ownerEmail(events: SyncedEventData[], hints: string[]): string | null {
  const lists = new Map<string, number>()
  for (const e of events) {
    const guests = e.attendees.filter((a) => !a.isOrganizer && a.email).map((a) => a.email.toLowerCase())
    for (const email of new Set(guests)) lists.set(email, (lists.get(email) ?? 0) + 1)
  }
  for (const hint of hints) {
    const guest = [...lists.keys()].find((email) => sameMailbox(email, hint))
    if (guest) return guest
  }
  const [first, second] = [...lists].sort((a, b) => b[1] - a[1])
  return first && (!second || first[1] > second[1]) ? first[0] : null
}

/** The owner's RSVP; null when they aren't a guest or organize the event themselves. */
function responseOf(attendees: EventAttendee[], owner: string): AttendeeStatus | null {
  const me = attendees.find((a) => a.email.toLowerCase() === owner)
  return me && !me.isOrganizer ? me.status : null
}

/**
 * Some feeds contain one copy of a meeting per guest, each with its own UID (seen
 * with Google calendars), which would show the meeting once per guest. Copies with
 * the same title, time and location are merged into one event with the combined
 * guest list. The copy with the smallest external ID is kept so the event ID (and
 * any note attached to it) stays the same across syncs.
 */
function mergeDuplicates(events: SyncedEventData[]): SyncedEventData[] {
  const groups = new Map<string, SyncedEventData[]>()
  for (const e of events) {
    const key = [e.title, e.startTime, e.endTime, e.allDay, e.location].join('\n')
    const group = groups.get(key)
    if (group) group.push(e)
    else groups.set(key, [e])
  }

  const out: SyncedEventData[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0])
      continue
    }
    group.sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0))
    out.push({
      ...group[0],
      description: group.find((e) => e.description)?.description ?? '',
      attendees: mergeAttendees(group.flatMap((e) => e.attendees))
    })
  }
  return out
}

/** One entry per email; an actual RSVP wins over "no answer yet". */
function mergeAttendees(attendees: EventAttendee[]): EventAttendee[] {
  const byEmail = new Map<string, EventAttendee>()
  for (const a of attendees) {
    const key = a.email.toLowerCase()
    const existing = byEmail.get(key)
    if (!existing) {
      byEmail.set(key, a)
      continue
    }
    byEmail.set(key, {
      name: existing.name || a.name,
      email: existing.email,
      status: existing.status === 'needs-action' ? a.status : existing.status,
      isOrganizer: existing.isOrganizer || a.isOrganizer,
      optional: existing.optional && a.optional
    })
  }
  return sortAttendees([...byEmail.values()])
}

/** Organizer first, then by name/email. */
function sortAttendees(attendees: EventAttendee[]): EventAttendee[] {
  return attendees.sort(
    (a, b) => Number(b.isOrganizer) - Number(a.isOrganizer) || (a.name || a.email).localeCompare(b.name || b.email)
  )
}

const STATUS_BY_PARTSTAT: Record<string, AttendeeStatus> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative'
}

/**
 * Guests from ATTENDEE lines, plus the ORGANIZER. Rooms and other resources are
 * left out (the room already shows as the location). Events without guests return
 * an empty list, even though Google still names the calendar owner as organizer.
 */
function readAttendees(ev: ICAL.Event): EventAttendee[] {
  const people = ev.component.getAllProperties('attendee').filter((p) => {
    const cutype = String(p.getParameter('cutype') ?? 'INDIVIDUAL').toUpperCase()
    return cutype !== 'ROOM' && cutype !== 'RESOURCE'
  })
  if (people.length === 0) return []

  const organizer = ev.component.getFirstProperty('organizer')
  const organizerEmail = organizer ? emailOf(organizer) : ''

  const attendees: EventAttendee[] = people
    .map((p) => {
      const email = emailOf(p)
      return {
        name: paramText(p, 'cn', email),
        email,
        status: STATUS_BY_PARTSTAT[String(p.getParameter('partstat') ?? '').toUpperCase()] ?? 'needs-action',
        isOrganizer: Boolean(organizerEmail) && email.toLowerCase() === organizerEmail.toLowerCase(),
        optional: String(p.getParameter('role') ?? '').toUpperCase() === 'OPT-PARTICIPANT'
      }
    })
    .filter((a) => a.email || a.name)

  if (organizer && organizerEmail && !attendees.some((a) => a.isOrganizer)) {
    attendees.push({
      name: paramText(organizer, 'cn', organizerEmail),
      email: organizerEmail,
      status: 'accepted',
      isOrganizer: true,
      optional: false
    })
  }
  return mergeAttendees(attendees)
}

/** "mailto:a@b.com" -> "a@b.com" (falls back to the EMAIL parameter). */
function emailOf(prop: ICAL.Property): string {
  const value = String(prop.getFirstValue() ?? '').trim()
  const email = value.replace(/^mailto:/i, '')
  return email.includes('@') ? email : String(prop.getParameter('email') ?? email)
}

/** A text parameter, or '' if it just repeats the email address (Google sets CN to the email). */
function paramText(prop: ICAL.Property, name: string, email: string): string {
  const value = String(prop.getParameter(name) ?? '').trim()
  return value.toLowerCase() === email.toLowerCase() ? '' : value
}

/** Deterministic ID so the same feed item always maps to the same row (and note). */
export function makeEventId(calendarId: string, externalId: string): string {
  return createHash('sha1').update(`${calendarId}\n${externalId}`).digest('hex').slice(0, 32)
}

function isCancelled(ev: ICAL.Event): boolean {
  const status = ev.component.getFirstPropertyValue('status')
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED'
}

/**
 * Best-effort fix-up for content lines that have no ':' value delimiter, which
 * ical.js rejects outright:
 *  - `NAME;PARAM=text` (e.g. `DESCRIPTION;VALUE=Some text`) becomes `NAME:text`.
 *  - A bare line with neither ';' nor ':' is a line break that wasn't folded, so it
 *    is joined onto the previous line.
 */
export function repairIcs(icsText: string): string {
  const lines = icsText.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (line === '' || line.includes(':')) {
      out.push(line)
      continue
    }
    const withParam = /^([A-Za-z0-9-]+);[A-Za-z0-9-]+=(.*)$/.exec(line)
    if (withParam) out.push(`${withParam[1]}:${withParam[2]}`)
    else if (!line.includes(';') && out.length > 0) out[out.length - 1] += `\\n${line}`
    // Anything else can't be salvaged; drop it rather than lose the whole calendar.
  }
  return out.join('\r\n')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * All-day values become "YYYY-MM-DD"; timed values become ISO UTC.
 * If the time references a TZID that had no VTIMEZONE block, ical.js treats it as
 * floating; in that case we resolve the IANA zone ourselves via Intl.
 */
function toStoredTime(time: ICAL.Time, prop: ICAL.Property | null): string {
  if (time.isDate) return `${time.year}-${pad(time.month)}-${pad(time.day)}`

  const tzid = prop?.getParameter('tzid')
  const zoneId = time.zone?.tzid
  const isFloating = !zoneId || zoneId === 'floating'
  const fmt = typeof tzid === 'string' && isFloating ? zoneFormatter(tzid) : null
  if (fmt) {
    const ms = zonedWallTimeToUtc(fmt, time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
    return new Date(ms).toISOString()
  }
  return time.toJSDate().toISOString()
}

