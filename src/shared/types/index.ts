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
  /**
   * The account's own address, taken from the login page or typed in; it tells which
   * guest is the user, for their RSVP in this account's calendars. '' = not known.
   */
  email: string
  status: ProtonAccountStatus
  lastExportAt: string | null
  lastError: string | null
  createdAt: string
}

/** Editable fields of a Proton account; email '' clears it. */
export interface ProtonAccountPatch {
  label?: string
  email?: string
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
  /**
   * The calendar owner's own RSVP, when they are a guest (not the organizer); the
   * calendar draws accepted, maybe, not answered and declined events differently.
   */
  myResponse: AttendeeStatus | null
  /** Id of the status picked by the user (see AppSettings.eventStatuses); null = none. */
  status: string | null
  /** Follow-up reminder time (ISO UTC) while the status is Follow-Up; null = none */
  followUpAt: string | null
  /** The follow-up reminder has been shown */
  followUpReminded: boolean
  /** Marked Important by the user (e.g. a final round); drawn with a yellow outline */
  important: boolean
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
 * A status from Settings, picked per event. Events with a status get a stripe in its color on their left edge.
 */
export interface EventStatusDef {
  id: string
  label: string
  color: string
  /** Shown as a column on the Pipeline page */
  pinned: boolean
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
  /** Calendars of the current run still waiting their turn (Google links are fetched slowly) */
  queuedIds: string[]
  /** The calendar that is fetched next and when, while the run pauses between requests */
  nextFetch: { calendarId: string; at: string } | null
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
  /** After which events ending without a status the app asks how they went (5 min after the end) */
  statusPrompt: StatusPromptMode

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
  /** Outline color of events marked Important (CalendarEvent.important) */
  importantColor: string

  /* ----- appearance ----- */
  /** Dark or light colors for the whole app */
  theme: ThemeMode

  /* ----- calendar view ----- */
  /** Height of one hour in Week/Day views, px (MIN_HOUR_HEIGHT..MAX_HOUR_HEIGHT) */
  hourHeight: number

  /* ----- time zone ----- */
  /** IANA zone the calendar and event times are shown in; '' = the computer's zone */
  primaryTimeZone: string
  /** Short name shown above the primary time column ("Home"); '' = the GMT offset */
  primaryTimeZoneLabel: string
  /** Week/Day views show a second time column for `secondaryTimeZone` */
  showSecondaryTimeZone: boolean
  /** IANA zone of the second column; '' = not picked yet */
  secondaryTimeZone: string
  secondaryTimeZoneLabel: string
}

/** 'guests' = only events with a guest list (meetings, interviews), 'all' = every timed event */
export type StatusPromptMode = 'guests' | 'all' | 'off'

/** 'same-day' = 09:00 on the day, 'day-before' = 18:00 the evening before */
/** Colors of the whole app */
export type ThemeMode = 'dark' | 'light'

export type AllDayReminder = 'off' | 'same-day' | 'day-before'

export interface AppInfo {
  name: string
  version: string
  /** Where the database, Proton logins and exports are stored */
  dataFolder: string
}

/** First launches after an update, until the user closed the "What's new" popup. */
export interface WhatsNew {
  /** Version used before; null when it wasn't recorded (updated from 1.0.6 or older). */
  from: string | null
  to: string
}

/**
 * Auto-update state (installed app only; updates come from GitHub Releases).
 * 'unsupported' – development build, updates are disabled
 * 'available'   – a new version exists; nothing is downloaded until the user asks
 * 'ready'       – downloaded; the app restarts into it right away
 */
export type UpdateState = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The new version, once one is found */
  version: string | null
  /** Download progress 0–100 */
  percent: number | null
  error: string | null
  /** The user skipped this version: no popup until a manual check */
  skipped: boolean
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
    setImportant(id: string, important: boolean): Promise<void>
    /** Reminder for an event marked Follow-Up (ISO time), or null to remove it. */
    setFollowUpReminder(id: string, remindAt: string | null): Promise<void>
    /** Every event that has a status, any date (Pipeline page). */
    listWithStatus(): Promise<CalendarEvent[]>
    /** Events changed in the main process (e.g. a status picked in a notification). */
    onChanged(callback: () => void): () => void
  }
  notes: {
    get(eventId: string): Promise<Note | null>
    save(eventId: string, content: string): Promise<Note>
    remove(eventId: string): Promise<void>
    /** First lines of the notes of these events, by event id (events without notes are left out). */
    previews(eventIds: string[]): Promise<Record<string, string>>
    /** Stores an image for a note; returns its id, to put in the note with noteImageMarkdown(). */
    addImage(data: Uint8Array, mimeType: string): Promise<string>
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
    /** Set right after an update, so the window shows the new release notes once. */
    whatsNew(): Promise<WhatsNew | null>
    whatsNewSeen(): Promise<void>
  }
  updates: {
    status(): Promise<UpdateStatus>
    /** Checks GitHub now (nothing is downloaded; a skipped version is offered again). */
    check(): Promise<UpdateStatus>
    /** Downloads the available update, then restarts into it. */
    download(): Promise<void>
    /** Don't offer the available version again (until a manual check). */
    skip(): Promise<void>
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
    /** A changed email re-reads the account's calendars (no Proton download). */
    updateAccount(id: string, patch: ProtonAccountPatch): Promise<ProtonAccount>
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
  caller: {
    status(): Promise<CallerStatus>
    signIn(serverUrl: string, email: string, password: string): Promise<CallerStatus>
    signOut(): Promise<CallerStatus>
    selectWorkspace(slug: string): Promise<CallerStatus>
    /** This app's calendars with what each shares in the chosen workspace, and the profiles it can share to. */
    listShares(): Promise<CallerShares>
    /** Shares a calendar with a profile; it is uploaded right away and on every later sync. */
    share(localCalendarId: string, profileId: string): Promise<CallerShares>
    /** Stops sharing (upcoming interviews nobody worked on are removed in the workspace). */
    unshare(localCalendarId: string): Promise<CallerShares>
    /** Syncs every shared calendar now (Proton accounts are exported first); each upload follows. */
    syncShared(): Promise<CallerSyncResult[]>
    /** Workspace interviews the member may see, from yesterday to two weeks ahead. */
    interviews(): Promise<CallerInterview[]>
    /** Whether one event is shared on its own, and the profiles it can be shared with. */
    eventShare(eventId: string): Promise<CallerEventShare>
    /** Caller tags of the events that are Teamwork interviews. */
    tags(): Promise<Record<string, CallerTag>>
    /** Saves the interview's resume where the member picks; the saved path, or null when cancelled. */
    downloadResume(interviewId: string): Promise<string | null>
    /** Shares one link on the Teamwork interview for everyone on it, or removes it (null). */
    shareLink(interviewId: string, url: string | null): Promise<void>
    /** Changes the Teamwork color of a caller's (or the Unassigned) Teamwork calendar, for everyone. */
    setColor(calendarId: string, color: string): Promise<void>
    /** Picks a PDF or Word file and makes it the interview's resume on Teamwork; its name, or null when cancelled. */
    uploadResume(interviewId: string): Promise<string | null>
    /** The callers to choose from for an interview, the recommended one first. */
    candidates(interviewId: string): Promise<CallerCandidate[]>
    /** Gives the interview to a caller (null: nobody). `force` moves a locked later round (admin). */
    assign(interviewId: string, callerId: string | null, force: boolean): Promise<CallerAssignResult>
    /** Shares one event with a profile without sharing its calendar (null: stop sharing it). */
    shareEvent(eventId: string, profileId: string | null): Promise<CallerEventShare>
    /** The Teamwork calendar or interview details changed (live update from the workspace). */
    onChanged(callback: () => void): () => void
  }
  connections: {
    status(): Promise<ConnectionsStatus>
    /** Pairs this app with a platform's calendar connection address, using an API key made there. */
    connect(address: string, key: string, name: string): Promise<ConnectionsStatus>
    disconnect(id: string): Promise<ConnectionsStatus>
    /** Asks the platform again which calendars it wants. */
    refresh(id: string): Promise<ConnectionsStatus>
    /** Syncs the calendars the platform wants now (Proton accounts are exported first); each is sent as it arrives. */
    sync(id: string): Promise<ConnectionSyncResult[]>
    /** A calendar was sent, or what a platform wants changed. */
    onChanged(callback: () => void): () => void
  }
}

/* ---------- Calendar connections (any platform that speaks the protocol) ---------- */

/** One of this app's calendars, as it stands with one platform. */
export interface ConnectionCalendar {
  id: string
  name: string
  color: string
  /** What the platform wants it for (a profile's name there); null = not sent. */
  wantedFor: string | null
  lastSentAt: string | null
  eventCount: number | null
  error: string | null
}

export interface ConnectionStatus {
  id: string
  name: string
  /** The platform's host, shown instead of the full address. */
  host: string
  /** The account on the platform the API key belongs to, when the platform says. */
  account: string
  lastCheckedAt: string | null
  lastError: string | null
  /** This app's calendars by Proton account (then links and files), as the platform is told. */
  groups: { id: string; name: string; calendars: ConnectionCalendar[] }[]
}

export interface ConnectionsStatus {
  /** What platforms call this app. */
  clientName: string
  connections: ConnectionStatus[]
}

export interface ConnectionSyncResult {
  name: string
  ok: boolean
  message: string
}

/* ---------- Caller server (interviews of the Caller project) ---------- */

export interface CallerWorkspace {
  slug: string
  name: string
  /** Owners and the admin share calendars with any profile; others with the profiles they work. */
  canShareAny: boolean
  /** May change callers' and the Unassigned color on Teamwork (members or calendar management). */
  canSetColors?: boolean
}

export interface CallerStatus {
  signedIn: boolean
  /** Address of the Caller website, e.g. https://caller.example.com */
  serverUrl: string
  email: string
  userName: string
  workspaces: CallerWorkspace[]
  workspaceSlug: string | null
  lastSyncAt: string | null
}

/** One of this app's calendars, and what it shares in the chosen workspace. */
export interface CallerShareRow {
  localCalendarId: string
  name: string
  color: string
  /** Where the calendar comes from: "Proton · Work", a web host, or "File". */
  source: string
  /** Why it can't be shared (it is the Teamwork calendar, or a Teamwork feed), or null. */
  blocked: string | null
  share: {
    connectionId: string
    profileId: string
    profileName: string
    lastUploadAt: string | null
    lastError: string | null
    eventCount: number | null
  } | null
}

export interface CallerProfile {
  id: string
  fullName: string
}

export interface CallerShares {
  calendars: CallerShareRow[]
  /** Profiles the member may share to in the chosen workspace. */
  profiles: CallerProfile[]
  /** Single events shared without their calendar, per profile. */
  picks: CallerPick[]
}

/** Events shared one by one with a profile (sent as one "picked interviews" calendar). */
export interface CallerPick {
  profileId: string
  profileName: string
  events: Array<{ id: string; title: string; startTime: string; missing: boolean }>
  lastUploadAt: string | null
  lastError: string | null
}

/** One event's sharing state in the chosen workspace. */
export interface CallerEventShare {
  signedIn: boolean
  workspaceName: string | null
  profiles: CallerProfile[]
  /** The profile this event is shared with on its own, if any. */
  profileId: string | null
  /** Its whole calendar is already shared (then it's on Teamwork already). */
  calendarSharedWith: string | null
  /** The event is on the Teamwork calendar (it came from the workspace). */
  fromTeamwork: boolean
  /** The workspace's interview behind this event: "Acme – Engineer · Round 2 · Caller: Ann". */
  teamwork: { label: string; url: string; interview: TeamworkInterview | null } | null
  error: string | null
}

/** Who takes a Teamwork interview, as its calendar event shows it. */
export interface TeamworkCaller {
  name: string
  level: number | null
  color: string
  /** The signed-in member takes it. */
  mine: boolean
}

/** A Teamwork interview's people and resume, for the details card. */
export interface TeamworkInterview {
  id: string
  company: string | null
  role: string | null
  /** "Round 2 of 3" */
  round: string | null
  /** A later round stays with the earlier round's caller. */
  locked: boolean
  profile: string | null
  bidders: string[]
  caller: TeamworkCaller | null
  resume: { filename: string; size: number } | null
  /** One link shared on the interview (job post, doc, anything). */
  link: { url: string; site: string; sharedBy: string | null } | null
  /** The member may upload the resume and share the link (owners, the admin, the profile's bidders). */
  canUploadResume: boolean
  /** The member may choose the caller (Teamwork's "assign interviews" permission). */
  canAssign: boolean
  callerId: string | null
}

/** A caller to choose from when assigning an interview, as Teamwork recommends them. */
export interface CallerCandidate {
  userId: string
  name: string
  level: number | null
  /** free: can take it; busy: has another interview then; unavailable: outside their hours. */
  status: 'free' | 'busy' | 'unavailable'
  /** Interviews in the 30 days before and after. */
  interviewCount: number
  recommended: boolean
}

/** Assigning a caller: done, or a locked later round the member may still move after confirming. */
export type CallerAssignResult = { ok: true } | { ok: false; locked: string }

/** The caller tag on a calendar event that is a Teamwork interview (local event id → tag). */
export interface CallerTag {
  caller: TeamworkCaller | null
  round: number | null
  locked: boolean
}

/** A workspace interview, as the member's role and permissions let them see it. */
export interface CallerInterview {
  id: string
  title: string
  start: string
  end: string
  company: string | null
  role: string | null
  /** "Round 2 of 3" */
  round: string | null
  profile: string | null
  caller: string | null
  cancelled: boolean
  meetingUrl: string | null
  /** The interview on the Caller website. */
  url: string
}

export interface CallerSyncResult {
  name: string
  ok: boolean
  message: string
}
