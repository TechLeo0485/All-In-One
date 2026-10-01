import ICAL from 'ical.js'
import { createHash } from 'node:crypto'
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

  const out: SyncedEventData[] = []
  const pushEvent = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, externalId: string): void => {
    if (isCancelled(item)) return
    const startTime = toStoredTime(start, item.component.getFirstProperty('dtstart'))
    let endTime = toStoredTime(end, item.component.getFirstProperty('dtend') ?? item.component.getFirstProperty('dtstart'))
    if (start.isDate && endTime <= startTime) endTime = addDays(startTime, 1)
    if (!start.isDate && endTime < startTime) endTime = startTime

    if (!overlaps(startTime, endTime, windowStart, windowEnd)) return
    out.push({
      id: makeEventId(calendarId, externalId),
      externalId,
      title: item.summary || '(No title)',
      description: item.description || '',
      startTime,
      endTime,
      allDay: start.isDate,
      location: item.location || ''
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

  return out
}

/** Deterministic ID so the same feed item always maps to the same row (and note). */
export function makeEventId(calendarId: string, externalId: string): string {
  return createHash('sha1').update(`${calendarId}\n${externalId}`).digest('hex').slice(0, 32)
}

function isCancelled(ev: ICAL.Event): boolean {
  const status = ev.component.getFirstPropertyValue('status')
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED'
}

function overlaps(start: string, end: string, windowStart: Date, windowEnd: Date): boolean {
  return start < windowEnd.toISOString() && end >= windowStart.toISOString().slice(0, 10)
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
  if (typeof tzid === 'string' && isFloating && isValidIanaZone(tzid)) {
    return zonedWallTimeToUtc(time, tzid).toISOString()
  }
  return time.toJSDate().toISOString()
}

const zoneValidity = new Map<string, boolean>()
function isValidIanaZone(tz: string): boolean {
  if (!zoneValidity.has(tz)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      zoneValidity.set(tz, true)
    } catch {
      zoneValidity.set(tz, false)
    }
  }
  return zoneValidity.get(tz)!
}

/** Interprets the wall-clock fields of `time` in the IANA zone `tz`. */
function zonedWallTimeToUtc(time: ICAL.Time, tz: string): Date {
  const asUtc = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
  // Two passes handle DST transitions correctly in nearly all real cases.
  let guess = asUtc - tzOffsetMs(asUtc, tz)
  guess = asUtc - tzOffsetMs(guess, tz)
  return new Date(guess)
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(utcMs))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - (utcMs - (utcMs % 1000))
}
