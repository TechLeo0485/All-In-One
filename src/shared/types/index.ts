/**
 * Types shared between the main process, the preload bridge and the renderer.
 * This file must stay free of runtime imports so it can be used by every layer.
 *
 * Date convention:
 *  - Timed events use full ISO-8601 UTC strings ("2026-10-01T09:00:00.000Z").
 *  - All-day events use plain dates ("2026-10-01"); the end date is exclusive
 *    (same convention as iCalendar DTEND and FullCalendar).
 */

export interface CalendarSource {
  id: string
  name: string
  color: string
  sourceUrl: string
  enabled: boolean
  createdAt: string
  lastSyncedAt: string | null
  lastSyncError: string | null
  /** Set when the calendar is managed by a connected Proton account (auto-export). */
  accountId: string | null
  /** Calendar name inside Proton (used to match exports to this calendar). */
  protonCalendarName: string | null
  /** Whether events of this calendar trigger desktop reminders */
  notify: boolean
}

/**
 * 'new'            – added, not logged in yet
 * 'ready'          – logged in, not synced yet (syncing only happens on request)
 * 'ok'             – last export succeeded
 * 'syncing'        – export running right now (transient, not persisted)
 * 'login-required' – Proton session expired; user must log in again
 * 'error'          – last export failed for another reason (see lastError)
 */
export type ProtonAccountStatus = 'new' | 'ready' | 'ok' | 'syncing' | 'login-required' | 'error'

/**
 * A Proton account connected through an embedded, per-account browser session.
 * Calendars are only downloaded when the user asks (no background schedule).
 */
export interface ProtonAccount {
  id: string
  label: string
  status: ProtonAccountStatus
  lastExportAt: string | null
  lastError: string | null
  createdAt: string
}

export interface CalendarSourceInput {
  name: string
  color: string
  sourceUrl: string
  enabled: boolean
  /** Desktop reminders for this calendar's events (default true) */
  notify?: boolean
}

export interface CalendarEvent {
  id: string
  /** null for local events */
  calendarId: string | null
  /** UID (plus recurrence id for recurring instances) from the ICS feed */
  externalId: string | null
  title: string
  description: string
  startTime: string
  endTime: string
  allDay: boolean
  location: string
  isLocalEvent: boolean
  /** Local events only; null = the default color from Settings. Synced events take the calendar color */
  color: string | null
  /** Minutes before start to show a notification (local events only) */
  reminderMinutes: number | null
  /** Organizer and guests from the feed (ORGANIZER / ATTENDEE); empty for local events */
  attendees: EventAttendee[]
  /** Id of the status picked by the user (see AppSettings.eventStatuses); null = none. */
  status: string | null
  /** Local events only: the repeating series this date belongs to (null = single event) */
  seriesId: string | null
  /** Repeat rule of the series (local events only) */
  recurrence: RecurrenceRule | null
  createdAt: string
}

/**
 * Repeat rule of a local event, like Google Calendar's "Custom recurrence".
 * Dates are generated in local time from the series' first start.
 */
export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  /** Every N days/weeks/months/years (1 = every) */
  interval: number
  /** Weekly only: days of the week, 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  /**
   * Monthly only: 'day' = same day of the month (e.g. the 15th), 'weekday' = same
   * nth weekday (e.g. third Tuesday), 'lastWeekday' = last such weekday of the month.
   */
  monthlyBy: 'day' | 'weekday' | 'lastWeekday'
  end: RecurrenceEnd
}

/** 'until' date is inclusive (YYYY-MM-DD); 'count' includes the first date. */
export type RecurrenceEnd = { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number }

/** Which dates of a repeating event an edit or delete applies to. */
export type RecurrenceScope = 'this' | 'following' | 'all'

/**
 * A status from Settings, picked per event. Events with a status are outlined in its color.
 */
export interface EventStatusDef {
  id: string
  label: string
  color: string
}

/** RSVP state from the iCalendar PARTSTAT parameter. */
export type AttendeeStatus = 'accepted' | 'declined' | 'tentative' | 'needs-action'

export interface EventAttendee {
  /** Display name (CN); empty if the feed only has an email address */
  name: string
  email: string
  status: AttendeeStatus
  isOrganizer: boolean
  /** ROLE=OPT-PARTICIPANT */
  optional: boolean
}

/** Where a search matched, in the order results describe it. */
export type SearchMatchField = 'title' | 'location' | 'guests' | 'description' | 'notes' | 'calendar'

export interface EventSearchResult {
  /** For recurring events: the next matching date (or the latest past one) */
  event: CalendarEvent
  calendarName: string | null
  matchedIn: SearchMatchField
  /** Text around the match ('' when it matched the title) */
  snippet: string
  /** How many dates of this recurring event match (1 for single events) */
  occurrences: number
}

export interface LocalEventInput {
  title: string
  description: string
  startTime: string
  endTime: string
  allDay: boolean
  location: string
  /** null = follow the default local event color from Settings */
  color: string | null
  reminderMinutes: number | null
  /** null = does not repeat */
  recurrence: RecurrenceRule | null
}

export interface Note {
  id: string
  eventId: string
  content: string
  updatedAt: string
}

export interface CalendarSyncResult {
  calendarId: string
  ok: boolean
  eventCount: number
  error?: string
  /** For local file sources: when the .ics file was last written (i.e. exported) */
  sourceModifiedAt?: string
}

export interface SyncStatus {
  running: boolean
  /** Calendars being fetched right now (only these show a spinner) */
  syncingIds: string[]
  lastRunAt: string | null
  results: CalendarSyncResult[]
}

/**
 * Note: Proton calendars are never fetched automatically; they update only when the
 * user clicks a refresh / sync button. `autoSyncMinutes` applies to other web links
 * (Google etc., see isAutoSyncSource).
 */
export interface AppSettings {
  showLocalEvents: boolean
  localEventColor: string
  /** Calendars hidden from the view via the sidebar (still synced on refresh) */
  hiddenCalendarIds: string[]

  /* ----- desktop notifications ----- */
  /** Master switch for all reminders */
  notificationsEnabled: boolean
  /** Minutes before a timed calendar (non-local) event to notify; -1 = off */
  defaultReminderMinutes: number
  /** Reminder for all-day calendar events */
  allDayReminder: AllDayReminder
  notificationSound: boolean
  /** ISO time until which reminders are paused; '' = not paused */
  notificationsPausedUntil: string

  /* ----- app behaviour ----- */
  /** Closing the window keeps the app running in the system tray */
  closeToTray: boolean
  /** Start with Windows, hidden in the tray */
  launchAtStartup: boolean
  /** System-wide shortcut that shows/hides the window (Electron accelerator, e.g. "Alt+Shift+C"); '' = off */
  globalShortcut: string

  /* ----- sync ----- */
  /** Refresh non-Proton link calendars every N minutes (and at startup); 0 = off */
  autoSyncMinutes: number

  /* ----- event status ----- */
  /** Event statuses, in the order they are offered */
  eventStatuses: EventStatusDef[]
}

/** 'same-day' = 09:00 on the day, 'day-before' = 18:00 the evening before */
export type AllDayReminder = 'off' | 'same-day' | 'day-before'

export interface AppInfo {
  name: string
  version: string
  /** Where the database, Proton logins and exports are stored */
  dataFolder: string
}

/**
 * Auto-update state (installed app only; updates come from GitHub Releases).
 * 'unsupported' – development build, updates are disabled
 * 'ready'       – downloaded; installs on restart (or whenever the app quits)
 */
export type UpdateState = 'unsupported' | 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The new version, while downloading or ready */
  version: string | null
  /** Download progress 0–100 */
  percent: number | null
  error: string | null
}

/** Sent to the renderer when the user clicks a reminder (or the tray's next event). */
export interface OpenEventRequest {
  eventId: string
  /** Start of the event, so the calendar can navigate to it */
  startTime: string
}

/**
 * The API exposed to the renderer as `window.api` by the preload script.
 * Every method maps to a single IPC channel; the renderer never touches Node APIs.
 */
export interface CalendarApi {
  calendars: {
    list(): Promise<CalendarSource[]>
    create(input: CalendarSourceInput): Promise<CalendarSource>
    update(id: string, input: Partial<CalendarSourceInput>): Promise<CalendarSource>
    remove(id: string): Promise<void>
    /**
     * Opens a native file picker for an exported .ics file. Returns a file: URL to
     * use as `sourceUrl`, or null if cancelled.
     */
    pickIcsFile(): Promise<string | null>
  }
  events: {
    listInRange(start: string, end: string): Promise<CalendarEvent[]>
    get(id: string): Promise<CalendarEvent | null>
    /** Searches title, description, location, guests, notes and calendar name together. */
    search(query: string): Promise<EventSearchResult[]>
    createLocal(input: LocalEventInput): Promise<CalendarEvent>
    /** `scope` only matters for dates of a repeating event (default 'this'). */
    updateLocal(id: string, input: LocalEventInput, scope?: RecurrenceScope): Promise<CalendarEvent>
    removeLocal(id: string, scope?: RecurrenceScope): Promise<void>
    /** null = no status. */
    setStatus(id: string, statusId: string | null): Promise<void>
  }
  notes: {
    get(eventId: string): Promise<Note | null>
    save(eventId: string, content: string): Promise<Note>
    remove(eventId: string): Promise<void>
  }
  sync: {
    runAll(): Promise<SyncStatus>
    runOne(calendarId: string): Promise<SyncStatus>
    status(): Promise<SyncStatus>
    /** Subscribe to sync status changes. Returns an unsubscribe function. */
    onStatusChange(callback: (status: SyncStatus) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  app: {
    info(): Promise<AppInfo>
    /** Pauses the show/hide shortcut while Settings records a new one (so pressing it doesn't hide the window). */
    suspendShortcut(suspended: boolean): Promise<void>
  }
  updates: {
    status(): Promise<UpdateStatus>
    /** Checks GitHub now (an available update downloads automatically). */
    check(): Promise<UpdateStatus>
    /** Restarts the app and installs the downloaded update. */
    install(): Promise<void>
    onStatusChange(callback: (status: UpdateStatus) => void): () => void
  }
  notifications: {
    /** Shows a sample reminder so the user can check Windows notification settings. */
    test(): Promise<void>
    /** Fired when a reminder (or the tray's "next event") asks to open an event. */
    onOpenEvent(callback: (request: OpenEventRequest) => void): () => void
  }
  proton: {
    listAccounts(): Promise<ProtonAccount[]>
    /** Creates the account and opens its login window. */
    addAccount(label: string): Promise<ProtonAccount>
    updateAccount(id: string, patch: { label?: string }): Promise<ProtonAccount>
    /** Removes the account, its calendars/notes, and clears its saved login. */
    removeAccount(id: string): Promise<void>
    /** Login window; closes itself after a successful login (no automatic download). */
    openLogin(id: string): Promise<void>
    /** Regular Proton window for this account; manual "Download ICS" files are captured. */
    openProton(id: string): Promise<void>
    syncAccount(id: string): Promise<void>
    syncAll(): Promise<void>
    onAccountsChanged(callback: (accounts: ProtonAccount[]) => void): () => void
  }
}
