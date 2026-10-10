import { Notification } from 'electron'
import type { AppSettings, CalendarEvent, OpenEventRequest } from '@shared/types'
import { calendarRepository } from '../database/calendarRepository'
import { eventRepository } from '../database/eventRepository'
import { settingsRepository } from '../database/settingsRepository'
import { createNotification } from './windowsIdentity'
import { timeZoneOption } from '@shared/timezone'

const CHECK_INTERVAL_MS = 15_000 // reminders are at most ~15 s late
/** Reminders that became due while the app was closed are still shown if they are this recent. */
const LATE_GRACE_MS = 10 * 60_000
/** How long to remember shown reminders (so a restart doesn't repeat them). */
const FIRED_RETENTION_MS = 3 * 86_400_000
const FIRED_STATE_KEY = 'reminders.fired'

/** "How did it go?" is asked this long after an event without a status ends. */
const STATUS_PROMPT_DELAY_MS = 5 * 60_000
/** A prompt that fell due while the app was closed is still shown this long after. */
const STATUS_PROMPT_GRACE_MS = 60 * 60_000
/** At most this many prompts at once (e.g. after starting the app); the details panel still asks for the rest. */
const MAX_PROMPTS_PER_CHECK = 3
/** Windows shows up to five buttons; the first statuses from Settings get one. */
const MAX_PROMPT_BUTTONS = 3

/** All-day reminders fire relative to local midnight of the event's first day. */
const ALL_DAY_OFFSET_MS: Record<Exclude<AppSettings['allDayReminder'], 'off'>, number> = {
  'same-day': 9 * 3_600_000, // 09:00 on the day
  'day-before': -6 * 3_600_000 // 18:00 the evening before
}

interface DueReminder {
  event: CalendarEvent
  dueAt: number
  start: number
  /** Minutes before start, for the text ("In 10 minutes"); null for all-day */
  minutesBefore: number | null
}

export interface UpcomingEvent {
  event: CalendarEvent
  start: number
}

/**
 * Desktop reminders, checked every 15 s in the main process (so they keep working
 * while the window is hidden in the tray).
 *
 *  - Local events use their own reminder setting.
 *  - Calendar (Proton / file / link) events use the default reminder from Settings,
 *    for calendars that are enabled and have notifications switched on.
 *  - Respects the master switch, the pause ("Pause notifications") and sound setting.
 *
 * Polling (instead of one timer per event) is robust against edits, deletions,
 * syncs, sleep/resume and clock changes. Shown reminders are persisted so they
 * aren't repeated after a restart.
 */
class ReminderService {
  private timer: NodeJS.Timeout | null = null
  private fired = new Map<string, number>() // key -> dueAt
  private onOpen: ((request: OpenEventRequest) => void) | null = null
  private onTick: (() => void) | null = null
  private onStatusPicked: ((eventId: string, statusId: string) => void) | null = null

  /** A status button was pressed on a "How did it go?" notification. */
  setStatusPickedHandler(handler: (eventId: string, statusId: string) => void): void {
    this.onStatusPicked = handler
  }

  start(onOpen: (request: OpenEventRequest) => void, onTick?: () => void): void {
    this.onOpen = onOpen
    this.onTick = onTick ?? null
    this.fired = new Map(Object.entries(settingsRepository.getInternal<Record<string, number>>(FIRED_STATE_KEY, {})))
    this.stop()
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Re-evaluates right away (e.g. after settings or events changed). */
  refresh(): void {
    if (this.timer) this.check()
  }

  /** Shows a sample notification so the user can verify Windows settings. */
  showTest(): void {
    const settings = settingsRepository.get()
    this.show(
      'Test reminder',
      'Notifications are working. You will be reminded before your events.',
      settings.notificationSound,
      null
    )
  }

  /** Next upcoming event (for the tray), ignoring hidden/disabled calendars. */
  nextEvent(withinMs = 24 * 3_600_000): UpcomingEvent | null {
    const now = Date.now()
    const settings = settingsRepository.get()
    const calendars = new Map(calendarRepository.list().map((c) => [c.id, c]))
    const hidden = new Set(settings.hiddenCalendarIds)
    const events = eventRepository.listInRange(new Date(now - 86_400_000).toISOString(), new Date(now + withinMs).toISOString())
    let best: UpcomingEvent | null = null
    for (const event of events) {
      if (event.isLocalEvent ? !settings.showLocalEvents : !calendars.get(event.calendarId ?? '')?.enabled) continue
      if (event.calendarId && hidden.has(event.calendarId)) continue
      if (event.allDay) continue // the tray shows timed events only
      const start = parseStart(event)
      if (start < now || start > now + withinMs) continue
      if (!best || start < best.start) best = { event, start }
    }
    return best
  }

  private check(): void {
    try {
      this.onTick?.()
      if (!Notification.isSupported()) return
      const settings = settingsRepository.get()
      if (!settings.notificationsEnabled) return
      const now = Date.now()
      if (settings.notificationsPausedUntil && new Date(settings.notificationsPausedUntil).getTime() > now) return

      let changed = false
      for (const due of this.collectDue(settings, now)) {
        const key = `${due.event.id}|${due.event.startTime}|${due.dueAt}`
        if (due.dueAt > now || now - due.dueAt > LATE_GRACE_MS || this.fired.has(key)) continue
        this.fired.set(key, due.dueAt)
        changed = true
        this.show(due.event.title, describe(due), settings.notificationSound, {
          eventId: due.event.id,
          startTime: due.event.startTime
        })
      }

      this.fireFollowUps(settings, now)
      if (this.fireStatusPrompts(settings, now)) changed = true

      for (const [key, dueAt] of this.fired) {
        if (now - dueAt > FIRED_RETENTION_MS) {
          this.fired.delete(key)
          changed = true
        }
      }
      if (changed) settingsRepository.setInternal(FIRED_STATE_KEY, Object.fromEntries(this.fired))
    } catch (err) {
      // Never let a bad row or a closing database kill the timer.
      console.error('[reminders] check failed:', err)
    }
  }

  /**
   * Follow-up reminders set on events marked Follow-Up. Unlike event reminders they
   * have no lateness limit: one that fell due while the app was closed (or paused)
   * is shown as soon as possible. Each is shown once (remind_fired in the database).
   */
  private fireFollowUps(settings: AppSettings, now: number): void {
    for (const { eventId } of eventRepository.listDueFollowUps(new Date(now).toISOString())) {
      eventRepository.markFollowUpReminded(eventId)
      const event = eventRepository.get(eventId)
      if (!event) continue // the event left its calendar; nothing to point at
      const start = new Date(parseStart(event))
      const when = event.allDay
        ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        : start.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            ...timeZoneOption(settings.primaryTimeZone)
          })
      this.show(`Follow up: ${event.title}`, `Marked Follow-Up · event on ${when}`, settings.notificationSound, {
        eventId: event.id,
        startTime: event.startTime
      })
    }
  }

  /**
   * Events that ended between `since` and `until` and have no status yet, that the
   * "Ask how it went" setting covers: timed events (not all-day) of calendars with
   * notifications on, or local events; with 'guests' only those with a guest list.
   */
  private listNeedingStatus(settings: AppSettings, since: number, until: number): CalendarEvent[] {
    const notifyCalendars = new Set(
      calendarRepository
        .list()
        .filter((c) => c.enabled && c.notify)
        .map((c) => c.id)
    )
    const untilIso = new Date(until).toISOString()
    const sinceIso = new Date(since).toISOString()
    return eventRepository
      .listInRange(sinceIso, untilIso)
      .filter(
        (e) =>
          !e.allDay &&
          e.status === null &&
          e.endTime >= sinceIso &&
          e.endTime <= untilIso &&
          (e.isLocalEvent || notifyCalendars.has(e.calendarId ?? '')) &&
          (settings.statusPrompt === 'all' || e.attendees.length > 0)
      )
  }

  /** "How did it go?" 5 minutes after an event without a status ends. True if any was shown. */
  private fireStatusPrompts(settings: AppSettings, now: number): boolean {
    if (settings.statusPrompt === 'off' || settings.eventStatuses.length === 0) return false
    const due = this.listNeedingStatus(settings, now - STATUS_PROMPT_DELAY_MS - STATUS_PROMPT_GRACE_MS, now - STATUS_PROMPT_DELAY_MS)
    let shown = 0
    for (const event of due) {
      const dueAt = new Date(event.endTime).getTime() + STATUS_PROMPT_DELAY_MS
      const key = `status|${event.id}|${event.endTime}`
      if (this.fired.has(key)) continue
      // Remembered even when over the limit, so they don't pop up one by one later.
      this.fired.set(key, dueAt)
      if (shown++ < MAX_PROMPTS_PER_CHECK) this.showStatusPrompt(event, settings)
    }
    return shown > 0
  }

  private showStatusPrompt(event: CalendarEvent, settings: AppSettings): void {
    const choices = settings.eventStatuses.slice(0, MAX_PROMPT_BUTTONS)
    const ended = new Date(event.endTime).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      ...timeZoneOption(settings.primaryTimeZone)
    })
    const notification = createNotification({
      title: `How did "${event.title}" go?`,
      body: `Ended at ${ended}. Pick a status, or click to open the event.`,
      silent: !settings.notificationSound,
      actions: choices.map((s) => ({ type: 'button' as const, text: s.label }))
    })
    const open: OpenEventRequest = { eventId: event.id, startTime: event.startTime }
    notification.on('click', () => this.onOpen?.(open))
    notification.on('action', (details, legacyIndex) => {
      const status = choices[details?.actionIndex ?? legacyIndex]
      if (status) this.onStatusPicked?.(event.id, status.id)
    })
    notification.show()
  }

  private collectDue(settings: AppSettings, now: number): DueReminder[] {
    const out: DueReminder[] = []

    // Local events: their own reminder (independent of the default).
    // Reminders are at most 4 weeks ahead; pad a day for all-day dates (stored as YYYY-MM-DD).
    const localFrom = new Date(now - LATE_GRACE_MS - 2 * 86_400_000).toISOString()
    const localTo = new Date(now + 30 * 86_400_000).toISOString()
    for (const event of eventRepository.listLocalWithReminders(localFrom, localTo)) {
      const minutes = event.reminderMinutes ?? 0
      const start = parseStart(event)
      out.push({ event, start, dueAt: start - minutes * 60_000, minutesBefore: event.allDay ? null : minutes })
    }

    // Calendar events: default reminder, per-calendar opt-out.
    const timedLead = settings.defaultReminderMinutes
    const allDayOffset = settings.allDayReminder === 'off' ? null : ALL_DAY_OFFSET_MS[settings.allDayReminder]
    if (timedLead < 0 && allDayOffset === null) return out

    const notifyCalendars = new Set(
      calendarRepository
        .list()
        .filter((c) => c.enabled && c.notify)
        .map((c) => c.id)
    )
    if (notifyCalendars.size === 0) return out

    // Look ahead far enough for the longest lead time (+1 day for all-day events).
    const lookAheadMs = Math.max(timedLead, 0) * 60_000 + 2 * 86_400_000
    const from = new Date(now - LATE_GRACE_MS - 86_400_000).toISOString()
    const to = new Date(now + lookAheadMs).toISOString()
    for (const event of eventRepository.listInRange(from, to)) {
      if (event.isLocalEvent || !notifyCalendars.has(event.calendarId ?? '')) continue
      const start = parseStart(event)
      if (event.allDay) {
        if (allDayOffset !== null) out.push({ event, start, dueAt: start + allDayOffset, minutesBefore: null })
      } else if (timedLead >= 0) {
        out.push({ event, start, dueAt: start - timedLead * 60_000, minutesBefore: timedLead })
      }
    }
    return out
  }

  private show(title: string, body: string, sound: boolean, open: OpenEventRequest | null): void {
    const notification = createNotification({ title, body, silent: !sound })
    if (open) notification.on('click', () => this.onOpen?.(open))
    notification.show()
  }
}

/** All-day dates are interpreted as local midnight. */
function parseStart(event: CalendarEvent): number {
  if (event.allDay) {
    const [y, m, d] = event.startTime.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  return new Date(event.startTime).getTime()
}

function describe(due: DueReminder): string {
  const { event, start, minutesBefore } = due
  const date = new Date(start)
  const parts: string[] = []
  if (event.allDay) {
    parts.push(`All day · ${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`)
  } else {
    const format = { hour: 'numeric', minute: '2-digit', ...timeZoneOption(settingsRepository.get().primaryTimeZone) } as const
    const time = date.toLocaleTimeString(undefined, format)
    const end = new Date(event.endTime).toLocaleTimeString(undefined, format)
    const lead = minutesBefore === null || minutesBefore === 0 ? 'Starting now' : `In ${formatDuration(minutesBefore)}`
    parts.push(`${lead} · ${time} – ${end}`)
  }
  if (event.location) parts.push(event.location)
  return parts.join('\n')
}

function formatDuration(minutes: number): string {
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day')
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour')
  return plural(minutes, 'minute')
}

export const reminderService = new ReminderService()
