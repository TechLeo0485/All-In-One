import type { CalendarEvent } from '@shared/types'
import { formatInDisplayZone, parseDateString, todayString, zonedDateString } from './dates'

/** Mail providers whose domain says nothing about the company. */
const PERSONAL_MAIL = new Set([
  'gmail',
  'googlemail',
  'outlook',
  'hotmail',
  'live',
  'msn',
  'yahoo',
  'icloud',
  'me',
  'mac',
  'proton',
  'protonmail',
  'pm',
  'aol',
  'gmx',
  'mail',
  'zoho',
  'yandex',
  'fastmail',
  'tutanota',
  'hey'
])

/** Second-level labels of country domains ("acme.co.uk" -> "acme"). */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/**
 * The company behind an event, guessed from the organizer's email domain:
 * "sschutte@adrm-security.com" -> "ADRM Security". Null for personal mail
 * (gmail, proton, ...) and events without an organizer (local events).
 */
export function companyOf(event: CalendarEvent): string | null {
  const email = event.attendees.find((a) => a.isOrganizer)?.email ?? ''
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null
  const labels = domain.split('.').filter(Boolean)
  if (labels.length < 2) return null
  let name = labels[labels.length - 2]
  if (SECOND_LEVEL.has(name) && labels.length >= 3) name = labels[labels.length - 3]
  if (PERSONAL_MAIL.has(name)) return null
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => (isAcronymLike(word) ? word.toUpperCase() : capitalize(word)))
    .join(' ')
}

/** Short consonant-heavy words read as acronyms ("ibm", "adrm"); "acme" doesn't. */
function isAcronymLike(word: string): boolean {
  if (word.length > 4) return false
  const vowels = (word.match(/[aeiou]/g) ?? []).length
  return word.length <= 3 || vowels <= 1
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Start of the event as a time value (all-day dates at local midnight). */
export function startMs(event: CalendarEvent): number {
  return event.allDay ? parseDateString(event.startTime).getTime() : new Date(event.startTime).getTime()
}

/** "Wed, Oct 7 · 11:00 AM", or "Wed, Oct 7" for all-day events. */
export function formatCardDate(event: CalendarEvent): string {
  const day = { weekday: 'short', month: 'short', day: 'numeric' } as const
  if (event.allDay) return parseDateString(event.startTime).toLocaleDateString(undefined, day)
  return formatInDisplayZone(new Date(event.startTime), { ...day, hour: 'numeric', minute: '2-digit' })
}

/** Whole days from today to the event's day (negative = past), in the display zone. */
export function daysFromToday(event: CalendarEvent): number {
  const day = event.allDay ? event.startTime : zonedDateString(new Date(event.startTime))
  const ms = parseDateString(day).getTime() - parseDateString(todayString()).getTime()
  return Math.round(ms / 86_400_000)
}

/** "today", "yesterday", "5 days ago", "tomorrow", "in 3 days". */
export function formatDayAge(days: number): string {
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  if (days === 1) return 'tomorrow'
  return days < 0 ? `${-days} days ago` : `in ${days} days`
}
