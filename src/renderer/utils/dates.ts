import type { CalendarEvent } from '@shared/types'
import { systemTimeZone, wallFields, zonedWallTimeToUtc, zoneFormatter } from '@shared/timezone'

/**
 * Date helpers for converting between stored values (ISO UTC or YYYY-MM-DD) and
 * form inputs / labels.
 *
 * Event times are shown in the display timezone (Settings → Time zone → primary),
 * which defaults to the computer's zone. Dates that stand for a calendar day
 * (DatePicker cells, parseDateString results) stay plain local-midnight Dates.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

/** Formatter of the display zone; null = the computer's zone (plain Date getters). */
let displayFmt: Intl.DateTimeFormat | null = null
let displayZone = ''

/** Called by the store whenever settings load or change; '' = the computer's zone. */
export function setDisplayTimeZone(tz: string): void {
  const fmt = tz && tz !== systemTimeZone() ? zoneFormatter(tz) : null
  displayFmt = fmt
  displayZone = fmt ? tz : ''
}

/** The zone event times are shown in, as an IANA name. */
export function displayTimeZone(): string {
  return displayZone || systemTimeZone()
}

/** Intl options that make a formatter use the display zone. */
function zoneOption(): { timeZone?: string } {
  return displayZone ? { timeZone: displayZone } : {}
}

/** [year, month0, day, hour, minute] of an instant in the display zone. */
function wall(date: Date): number[] {
  if (!displayFmt) return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]
  return wallFields(date.getTime(), displayFmt)
}

/** Local calendar date of a Date object as YYYY-MM-DD (for calendar-day Dates). */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Date of an instant in the display zone as YYYY-MM-DD. */
export function zonedDateString(date: Date): string {
  const [y, mo, d] = wall(date)
  return `${y}-${pad(mo + 1)}-${pad(d)}`
}

/** Today in the display zone as YYYY-MM-DD. */
export function todayString(): string {
  return zonedDateString(new Date())
}

/** Instant -> value for <input type="datetime-local"> (display zone). */
export function toLocalInputValue(date: Date): string {
  const [, , , h, mi] = wall(date)
  return `${zonedDateString(date)}T${pad(h)}:${pad(mi)}`
}

/** <input type="datetime-local"> value (display zone) -> ISO UTC string. */
export function fromLocalInputValue(value: string): string {
  if (!displayFmt) return new Date(value).toISOString()
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number)
  return new Date(zonedWallTimeToUtc(displayFmt, y, mo - 1, d, h, mi)).toISOString()
}

/** Parses YYYY-MM-DD as local midnight (new Date('YYYY-MM-DD') would be UTC). */
export function parseDateString(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(dateString: string, days: number): string {
  const d = parseDateString(dateString)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

const DATE_OPTIONS = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } as const
const dayFmt = new Intl.DateTimeFormat(undefined, DATE_OPTIONS)

/** Formatters in the display zone, rebuilt only when the zone changes. */
let zonedFmts: { zone: string; date: Intl.DateTimeFormat; time: Intl.DateTimeFormat } | null = null
function eventFormatters(): { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat } {
  if (zonedFmts?.zone !== displayZone) {
    zonedFmts = {
      zone: displayZone,
      date: new Intl.DateTimeFormat(undefined, { ...DATE_OPTIONS, ...zoneOption() }),
      time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', ...zoneOption() })
    }
  }
  return zonedFmts
}

/** Formats an instant in the display zone (e.g. follow-up reminder times). */
export function formatInDisplayZone(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleString(undefined, { ...options, ...zoneOption() })
}

/** Human friendly description of when an event happens. */
export function formatEventWhen(event: CalendarEvent): string {
  if (event.allDay) {
    const dateFmt = dayFmt
    const start = parseDateString(event.startTime)
    const lastDay = parseDateString(addDays(event.endTime, -1))
    if (lastDay <= start) return `${dateFmt.format(start)} · All day`
    return `${dateFmt.format(start)} – ${dateFmt.format(lastDay)} · All day`
  }
  const { date: dateFmt, time: timeFmt } = eventFormatters()
  const start = new Date(event.startTime)
  const end = new Date(event.endTime)
  if (zonedDateString(start) === zonedDateString(end)) {
    return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)}`
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${dateFmt.format(end)} ${timeFmt.format(end)}`
}

/** "just now", "5 min ago", "3 h ago", "2 days ago": for ages that may run to days. */
export function formatAge(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  if (diff < 86_400_000) return formatRelative(iso)
  const days = Math.floor(diff / 86_400_000)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`
  return new Date(iso).toLocaleString()
}

/** Reminder choices offered in the UI (minutes before the start). */
export const REMINDER_MINUTES = [0, 5, 10, 15, 30, 60, 1440]

/** "15 minutes before", "1 hour before", "1 day before", "At start time" */
export function formatReminder(minutes: number): string {
  if (minutes === 0) return 'At start time'
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, 'day')} before`
  if (minutes % 60 === 0) return `${plural(minutes / 60, 'hour')} before`
  return `${plural(minutes, 'minute')} before`
}
