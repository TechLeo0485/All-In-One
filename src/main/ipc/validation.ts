import type { AppSettings, CalendarSourceInput, LocalEventInput, RecurrenceRule, RecurrenceScope } from '@shared/types'
import { AUTO_SYNC_OPTIONS } from '@shared/sources'
import { isValidShortcut } from '@shared/shortcut'
import { MAX_STATUS_LABEL, MAX_STATUSES, normalizeStatuses, STATUS_ID_RE } from '@shared/eventStatus'

/**
 * The renderer is treated as untrusted: every IPC payload is validated here before
 * it reaches the database. Validators throw with a user-friendly message.
 */

const COLOR_RE = /^#[0-9a-f]{6}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT = 100_000

function fail(message: string): never {
  throw new Error(message)
}

export function str(value: unknown, field: string, { required = false, max = MAX_TEXT } = {}): string {
  if (typeof value !== 'string') fail(`${field} must be text`)
  const trimmed = value.trim()
  if (required && !trimmed) fail(`${field} is required`)
  if (trimmed.length > max) fail(`${field} is too long`)
  return trimmed
}

export function id(value: unknown, field = 'id'): string {
  return str(value, field, { required: true, max: 200 })
}

function color(value: unknown, field = 'Color'): string {
  const c = str(value, field, { required: true, max: 7 })
  if (!COLOR_RE.test(c)) fail(`${field} must be a hex color like #3b82f6`)
  return c.toLowerCase()
}

function feedUrl(value: unknown): string {
  const raw = str(value, 'Source URL', { required: true, max: 4000 })
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail('Source URL is not a valid URL')
  }
  // file: sources are additionally checked against the file-picker allowlist in the handler.
  if (!['https:', 'http:', 'webcal:', 'webcals:', 'file:'].includes(url.protocol)) {
    fail('Source URL must start with https://, http:// or webcal://')
  }
  return raw
}

/** Accepts an ISO datetime (timed) or YYYY-MM-DD (all-day). */
function timeValue(value: unknown, allDay: boolean, field: string): string {
  const v = str(value, field, { required: true, max: 40 })
  if (allDay) {
    if (!DATE_RE.test(v)) fail(`${field} must be a date`)
    return v
  }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) fail(`${field} is not a valid date/time`)
  return d.toISOString()
}

export function calendarInput(value: unknown): CalendarSourceInput {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    name: str(v.name, 'Name', { required: true, max: 200 }),
    color: color(v.color),
    sourceUrl: feedUrl(v.sourceUrl),
    enabled: v.enabled === undefined ? true : Boolean(v.enabled)
  }
}

export function partialCalendarInput(value: unknown): Partial<CalendarSourceInput> {
  const v = (value ?? {}) as Record<string, unknown>
  const out: Partial<CalendarSourceInput> = {}
  if (v.name !== undefined) out.name = str(v.name, 'Name', { required: true, max: 200 })
  if (v.color !== undefined) out.color = color(v.color)
  if (v.sourceUrl !== undefined) out.sourceUrl = feedUrl(v.sourceUrl)
  if (v.enabled !== undefined) out.enabled = Boolean(v.enabled)
  if (v.notify !== undefined) out.notify = Boolean(v.notify)
  return out
}

export function localEventInput(value: unknown): LocalEventInput {
  const v = (value ?? {}) as Record<string, unknown>
  const allDay = Boolean(v.allDay)
  const startTime = timeValue(v.startTime, allDay, 'Start')
  const endTime = timeValue(v.endTime, allDay, 'End')
  if (allDay ? endTime <= startTime : new Date(endTime) < new Date(startTime)) {
    fail('End must be after start')
  }

  let reminderMinutes: number | null = null
  if (v.reminderMinutes !== null && v.reminderMinutes !== undefined && v.reminderMinutes !== '') {
    const n = Number(v.reminderMinutes)
    if (!Number.isInteger(n) || n < 0 || n > 40_320) fail('Reminder must be between 0 minutes and 4 weeks')
    reminderMinutes = n
  }

  return {
    title: str(v.title, 'Title', { required: true, max: 500 }),
    description: str(v.description ?? '', 'Description'),
    location: str(v.location ?? '', 'Location', { max: 1000 }),
    // Empty = follow the default local event color from Settings.
    color: v.color === null || v.color === undefined || v.color === '' ? null : color(v.color),
    startTime,
    endTime,
    allDay,
    reminderMinutes,
    recurrence: recurrenceRule(v.recurrence, allDay ? startTime : null)
  }
}

/** null/undefined = does not repeat. `startDate` (all-day events) checks the end date. */
function recurrenceRule(value: unknown, startDate: string | null): RecurrenceRule | null {
  if (value === null || value === undefined) return null
  const v = value as Record<string, unknown>
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(String(v.freq))) fail('Invalid repeat frequency')
  const interval = Number(v.interval ?? 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) fail('Repeat interval must be between 1 and 999')
  const weekdays = Array.isArray(v.weekdays) ? [...new Set(v.weekdays.map(Number))] : []
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail('Invalid repeat weekdays')
  const monthlyBy = v.monthlyBy ?? 'day'
  if (!['day', 'weekday', 'lastWeekday'].includes(String(monthlyBy))) fail('Invalid monthly repeat')

  const end = (v.end ?? { type: 'never' }) as Record<string, unknown>
  let parsedEnd: RecurrenceRule['end']
  if (end.type === 'never') parsedEnd = { type: 'never' }
  else if (end.type === 'until') {
    const date = str(end.date, 'Repeat end date', { required: true, max: 10 })
    if (!DATE_RE.test(date)) fail('Repeat end date must be a date')
    if (startDate && date < startDate) fail('Repeat end date must be on or after the start')
    parsedEnd = { type: 'until', date }
  } else if (end.type === 'count') {
    const count = Number(end.count)
    if (!Number.isInteger(count) || count < 1 || count > 5000) fail('Number of repeats must be between 1 and 5000')
    parsedEnd = { type: 'count', count }
  } else fail('Invalid repeat end')

  return {
    freq: v.freq as RecurrenceRule['freq'],
    interval,
    weekdays: v.freq === 'weekly' ? weekdays : [],
    monthlyBy: v.freq === 'monthly' ? (monthlyBy as RecurrenceRule['monthlyBy']) : 'day',
    end: parsedEnd
  }
}

export function recurrenceScope(value: unknown): RecurrenceScope {
  if (value === undefined || value === null) return 'this'
  if (value !== 'this' && value !== 'following' && value !== 'all') fail('Invalid scope')
  return value
}

export function settingsPatch(value: unknown): Partial<AppSettings> {
  const v = (value ?? {}) as Record<string, unknown>
  const out: Partial<AppSettings> = {}
  if (v.globalShortcut !== undefined) {
    const shortcut = str(v.globalShortcut, 'Shortcut', { max: 60 })
    if (shortcut && !isValidShortcut(shortcut)) fail('Invalid shortcut')
    out.globalShortcut = shortcut
  }
  if (v.showLocalEvents !== undefined) out.showLocalEvents = Boolean(v.showLocalEvents)
  if (v.localEventColor !== undefined) out.localEventColor = color(v.localEventColor, 'Local event color')
  if (v.hiddenCalendarIds !== undefined) {
    if (!Array.isArray(v.hiddenCalendarIds) || v.hiddenCalendarIds.length > 1000) fail('Invalid hidden calendars')
    out.hiddenCalendarIds = v.hiddenCalendarIds.map((x) => id(x, 'calendar id'))
  }
  if (v.notificationsEnabled !== undefined) out.notificationsEnabled = Boolean(v.notificationsEnabled)
  if (v.defaultReminderMinutes !== undefined) {
    const n = Number(v.defaultReminderMinutes)
    if (!Number.isInteger(n) || n < -1 || n > 40_320) fail('Reminder must be off or between 0 minutes and 4 weeks')
    out.defaultReminderMinutes = n
  }
  if (v.allDayReminder !== undefined) {
    if (!['off', 'same-day', 'day-before'].includes(String(v.allDayReminder))) fail('Invalid all-day reminder')
    out.allDayReminder = v.allDayReminder as AppSettings['allDayReminder']
  }
  if (v.notificationSound !== undefined) out.notificationSound = Boolean(v.notificationSound)
  if (v.notificationsPausedUntil !== undefined) {
    const s = str(v.notificationsPausedUntil, 'Pause', { max: 40 })
    if (s && Number.isNaN(new Date(s).getTime())) fail('Invalid pause time')
    out.notificationsPausedUntil = s
  }
  if (v.closeToTray !== undefined) out.closeToTray = Boolean(v.closeToTray)
  if (v.launchAtStartup !== undefined) out.launchAtStartup = Boolean(v.launchAtStartup)
  if (v.autoSyncMinutes !== undefined) {
    const n = Number(v.autoSyncMinutes)
    if (!(AUTO_SYNC_OPTIONS as readonly number[]).includes(n)) fail('Invalid auto-sync interval')
    out.autoSyncMinutes = n
  }
  if (v.eventStatuses !== undefined) {
    if (!Array.isArray(v.eventStatuses) || v.eventStatuses.length > MAX_STATUSES) fail('Invalid event statuses')
    out.eventStatuses = normalizeStatuses(
      v.eventStatuses.map((item) => {
        const s = (item ?? {}) as Record<string, unknown>
        const sid = id(s.id, 'Status id')
        if (!STATUS_ID_RE.test(sid)) fail('Invalid status id')
        return {
          id: sid,
          label: str(s.label, 'Status name', { required: true, max: MAX_STATUS_LABEL }),
          color: color(s.color, 'Status color')
        }
      })
    )
  }
  return out
}

/** A status id picked on an event, or null to go back to automatic. */
/** ISO date/time (normalized to UTC), or null. */
export function optionalTime(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return timeValue(value, false, field)
}

export function eventStatusId(value: unknown): string | null {
  if (value === null) return null
  const sid = id(value, 'Status')
  if (!STATUS_ID_RE.test(sid)) fail('Invalid status')
  return sid
}

export function rangeBound(value: unknown, field: string): string {
  const v = str(value, field, { required: true, max: 40 })
  if (Number.isNaN(new Date(v).getTime())) fail(`${field} is not a valid date`)
  return v
}
