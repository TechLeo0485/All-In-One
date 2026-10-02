import ICAL from 'ical.js'
import { createHash } from 'node:crypto'
import type { AttendeeStatus, EventAttendee } from '@shared/types'
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
}

/** Hard caps so a pathological RRULE can't hang the sync. */
const MAX_OCCURRENCES_PER_EVENT = 5000
const MAX_ITERATIONS_PER_EVENT = 200_000

export function parseIcs(calendarId: string, icsText: string, options: ParseOptions = {}): SyncedEventData[] {
  const now = Date.now()
  const windowStart = options.windowStart ?? new Date(now - 183 * 86_400_000)
  const windowEnd = options.windowEnd ?? new Date(now + 548 * 86_400_000)

  const root = new ICAL.Component(ICAL.parse(icsText))

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
      attendees: readAttendees(item)
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

  return mergeDuplicates(out)
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
  if (fmt) return zonedWallTimeToUtc(time, fmt).toISOString()
  return time.toJSDate().toISOString()
}

/** One formatter per IANA zone (construction is expensive); null = invalid zone. */
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>()
function zoneFormatter(tz: string): Intl.DateTimeFormat | null {
  if (!zoneFormatters.has(tz)) {
    try {
      zoneFormatters.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      )
    } catch {
      zoneFormatters.set(tz, null)
    }
  }
  return zoneFormatters.get(tz)!
}

/** Interprets the wall-clock fields of `time` in the formatter's IANA zone. */
function zonedWallTimeToUtc(time: ICAL.Time, fmt: Intl.DateTimeFormat): Date {
  const asUtc = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
  // Two passes handle DST transitions correctly in nearly all real cases.
  let guess = asUtc - tzOffsetMs(asUtc, fmt)
  guess = asUtc - tzOffsetMs(guess, fmt)
  return new Date(guess)
}

function tzOffsetMs(utcMs: number, fmt: Intl.DateTimeFormat): number {
  const parts = fmt.formatToParts(new Date(utcMs))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - (utcMs - (utcMs % 1000))
}
