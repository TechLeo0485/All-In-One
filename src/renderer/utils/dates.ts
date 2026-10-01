import type { CalendarEvent } from '@shared/types'

/**
 * Date helpers for converting between stored values (ISO UTC or YYYY-MM-DD) and
 * the browser's local-time form inputs.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date of a Date object as YYYY-MM-DD. */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** ISO string -> value for <input type="datetime-local"> (local time). */
export function toLocalInputValue(date: Date): string {
  return `${toDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** <input type="datetime-local"> value -> ISO UTC string. */
export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
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

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** Human friendly description of when an event happens. */
export function formatEventWhen(event: CalendarEvent): string {
  if (event.allDay) {
    const start = parseDateString(event.startTime)
    const lastDay = parseDateString(addDays(event.endTime, -1))
    if (lastDay <= start) return `${dateFmt.format(start)} · All day`
    return `${dateFmt.format(start)} – ${dateFmt.format(lastDay)} · All day`
  }
  const start = new Date(event.startTime)
  const end = new Date(event.endTime)
  if (toDateString(start) === toDateString(end)) {
    return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)}`
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${dateFmt.format(end)} ${timeFmt.format(end)}`
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`
  return new Date(iso).toLocaleString()
}

/** "15 minutes before", "1 hour before", "1 day before", "At start time" */
export function formatReminder(minutes: number): string {
  if (minutes === 0) return 'At start time'
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, 'day')} before`
  if (minutes % 60 === 0) return `${plural(minutes / 60, 'hour')} before`
  return `${plural(minutes, 'minute')} before`
}
