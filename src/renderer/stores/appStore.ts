import { create } from 'zustand'
import type {
  AppSettings,
  CalendarEvent,
  CalendarSource,
  CalendarSourceInput,
  LocalEventInput,
  OpenEventRequest,
  ProtonAccount,
  RecurrenceScope,
  SyncStatus
} from '@shared/types'
import { setDisplayTimeZone } from '../utils/dates'
import { errorMessage } from '../utils/errors'

export type View = 'calendar' | 'calendars' | 'settings'

/** What the local-event dialog is doing, if open. */
export type EventEditorState =
  | { mode: 'create'; defaults: Partial<LocalEventInput> }
  | { mode: 'edit'; event: CalendarEvent }
  | null

/**
 * In-app confirmation dialog. We don't use window.confirm(): on Windows, Electron
 * doesn't give keyboard focus back to the page after a native dialog, so text
 * inputs stop accepting typing until the window is re-focused.
 */
export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

/** In-app dialog with a list of options (radio buttons), e.g. "This event / All events". */
export interface ChoiceOptions {
  title: string
  choices: { value: string; label: string }[]
  confirmLabel?: string
  danger?: boolean
}

export interface ChoiceRequest extends ChoiceOptions {
  resolve: (value: string | null) => void
}

/** Events of one calendar in the period the calendar shows. */
export interface EventCounts {
  total: number
  /** Already ended */
  done: number
  /** Still to come (or in progress) */
  scheduled: number
}

/** Key of local events in PeriodStats.counts (the others are calendar ids). */
export const LOCAL_EVENTS_KEY = 'local'

/** Counts for the week/month/day the calendar shows, per calendar. */
export interface PeriodStats {
  /** e.g. "Week · Oct 4 – 10, 2026" */
  label: string
  counts: Record<string, EventCounts>
}

export interface Toast {
  id: number
  kind: 'error' | 'info'
  message: string
}

/**
 * Global UI state. Persistent data lives in SQLite (main process); this store only
 * caches what the UI needs and wraps the IPC calls so components stay simple.
 * Events themselves are not stored here: FullCalendar requests them per visible
 * range, and `eventsVersion` is bumped to tell it to refetch.
 */
interface AppState {
  ready: boolean
  view: View
  calendars: CalendarSource[]
  protonAccounts: ProtonAccount[]
  settings: AppSettings | null
  syncStatus: SyncStatus
  selectedEventId: string | null
  /** Date the calendar should navigate to (set when opening an event from a reminder) */
  focusDate: { date: string; seq: number } | null
  eventsVersion: number
  /** Set by the calendar page for the sidebar; null while another page is open. */
  periodStats: PeriodStats | null
  eventEditor: EventEditorState
  toasts: Toast[]

  init(): Promise<void>
  setView(view: View): void
  selectEvent(id: string | null): void
  /** Reminder or tray click: show the calendar, jump to the date and select the event. */
  openEvent(request: OpenEventRequest): void
  refreshEvents(): void
  notify(message: string, kind?: Toast['kind']): void
  confirmRequest: ConfirmRequest | null
  /** Shows the in-app confirmation dialog; resolves true if the user confirms. */
  askConfirm(options: ConfirmOptions): Promise<boolean>
  resolveConfirm(confirmed: boolean): void
  choiceRequest: ChoiceRequest | null
  /** Shows the in-app choice dialog; resolves the picked value, or null if cancelled. */
  askChoice(options: ChoiceOptions): Promise<string | null>
  resolveChoice(value: string | null): void
  /**
   * For a date of a repeating event: asks which dates an edit/delete applies to.
   * `allowThis` = false when the change can't apply to one date (a new repeat rule).
   */
  askRecurrenceScope(action: 'edit' | 'delete', allowThis?: boolean): Promise<RecurrenceScope | null>
  dismissToast(id: number): void

  loadCalendars(): Promise<void>
  setProtonAccounts(accounts: ProtonAccount[]): void
  addProtonAccount(label: string): Promise<boolean>
  updateProtonAccount(id: string, patch: { label?: string }): Promise<boolean>
  removeProtonAccount(id: string): Promise<void>
  protonAction(action: 'openLogin' | 'openProton' | 'syncAccount', id: string): Promise<void>
  syncAllProtonAccounts(): Promise<void>
  createCalendar(input: CalendarSourceInput): Promise<boolean>
  updateCalendar(id: string, input: Partial<CalendarSourceInput>): Promise<boolean>
  removeCalendar(id: string): Promise<void>
  toggleCalendarVisibility(id: string): Promise<void>
  /** Native file picker for an exported .ics file; resolves to a file: URL or null. */
  pickIcsFile(): Promise<string | null>

  syncAll(): Promise<void>
  syncOne(id: string): Promise<void>
  applySyncStatus(status: SyncStatus): void

  updateSettings(patch: Partial<AppSettings>): Promise<void>

  openEventEditor(state: Exclude<EventEditorState, null>): void
  closeEventEditor(): void
  /** `scope`: which dates of a repeating event the edit applies to. */
  saveLocalEvent(input: LocalEventInput, scope?: RecurrenceScope): Promise<boolean>
  deleteLocalEvent(id: string, scope?: RecurrenceScope): Promise<void>
  /** A status id from Settings, or null to clear the status. */
  setEventStatus(id: string, statusId: string | null): Promise<void>
  /** Follow-up reminder (ISO time) for an event marked Follow-Up; null removes it. */
  setFollowUpReminder(id: string, remindAt: string | null): Promise<void>
}

let toastSeq = 0

export const useAppStore = create<AppState>((set, get) => {
  /** Runs an IPC call, turning failures into a toast instead of an unhandled rejection. */
  async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn()
    } catch (err) {
      get().notify(errorMessage(err), 'error')
      return undefined
    }
  }

  return {
    ready: false,
    view: 'calendar',
    calendars: [],
    protonAccounts: [],
    settings: null,
    syncStatus: { running: false, syncingIds: [], lastRunAt: null, results: [] },
    selectedEventId: null,
    focusDate: null,
    eventsVersion: 0,
    periodStats: null,
    eventEditor: null,
    toasts: [],

    async init() {
      const [calendars, settings, syncStatus, protonAccounts] = await Promise.all([
        window.api.calendars.list(),
        window.api.settings.get(),
        window.api.sync.status(),
        window.api.proton.listAccounts()
      ])
      setDisplayTimeZone(settings.primaryTimeZone)
      set({ calendars, settings, syncStatus, protonAccounts, ready: true })
    },

    setView: (view) => set({ view }),
    selectEvent: (id) => set({ selectedEventId: id }),
    openEvent: (request) =>
      set((s) => ({
        view: 'calendar',
        selectedEventId: request.eventId,
        focusDate: { date: request.startTime, seq: (s.focusDate?.seq ?? 0) + 1 }
      })),
    refreshEvents: () => set((s) => ({ eventsVersion: s.eventsVersion + 1 })),

    notify(message, kind = 'info') {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    confirmRequest: null,
    askConfirm(options) {
      // A newer request replaces (and cancels) one that is still open.
      get().confirmRequest?.resolve(false)
      return new Promise<boolean>((resolve) => set({ confirmRequest: { ...options, resolve } }))
    },
    resolveConfirm(confirmed) {
      const request = get().confirmRequest
      set({ confirmRequest: null })
      request?.resolve(confirmed)
    },

    choiceRequest: null,
    askChoice(options) {
      get().choiceRequest?.resolve(null)
      return new Promise<string | null>((resolve) => set({ choiceRequest: { ...options, resolve } }))
    },
    resolveChoice(value) {
      const request = get().choiceRequest
      set({ choiceRequest: null })
      request?.resolve(value)
    },
    async askRecurrenceScope(action, allowThis = true) {
      const choices = [
        ...(allowThis ? [{ value: 'this', label: 'This event' }] : []),
        { value: 'following', label: 'This and following events' },
        { value: 'all', label: 'All events' }
      ]
      const value = await get().askChoice({
        title: action === 'edit' ? 'Edit recurring event' : 'Delete recurring event',
        choices,
        confirmLabel: action === 'edit' ? 'Save' : 'Delete',
        danger: action === 'delete'
      })
      return value as RecurrenceScope | null
    },

    async loadCalendars() {
      const calendars = await attempt(() => window.api.calendars.list())
      if (calendars) set({ calendars })
    },

    async createCalendar(input) {
      const created = await attempt(() => window.api.calendars.create(input))
      if (!created) return false
      set((s) => ({ calendars: [...s.calendars, created] }))
      return true
    },

    async updateCalendar(id, input) {
      const updated = await attempt(() => window.api.calendars.update(id, input))
      if (!updated) return false
      // CalendarPage refetches by itself when color / enabled state change.
      set((s) => ({ calendars: s.calendars.map((c) => (c.id === id ? updated : c)) }))
      return true
    },

    async removeCalendar(id) {
      const ok = await attempt(() => window.api.calendars.remove(id).then(() => true))
      if (!ok) return
      set((s) => ({ calendars: s.calendars.filter((c) => c.id !== id), selectedEventId: null }))
      get().refreshEvents()
    },

    async toggleCalendarVisibility(id) {
      const hidden = get().settings?.hiddenCalendarIds ?? []
      const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
      await get().updateSettings({ hiddenCalendarIds: next })
    },

    setProtonAccounts(accounts) {
      const before = get().protonAccounts
      set({ protonAccounts: accounts })
      // An export just finished: calendars may have been created or relinked.
      const finished = accounts.some((a) => a.status !== 'syncing' && before.find((b) => b.id === a.id)?.status === 'syncing')
      if (finished) void get().loadCalendars()
    },

    async addProtonAccount(label) {
      const account = await attempt(() => window.api.proton.addAccount(label))
      if (!account) return false
      set((s) => ({ protonAccounts: [...s.protonAccounts.filter((a) => a.id !== account.id), account] }))
      return true
    },

    async updateProtonAccount(id, patch) {
      const account = await attempt(() => window.api.proton.updateAccount(id, patch))
      if (!account) return false
      set((s) => ({ protonAccounts: s.protonAccounts.map((a) => (a.id === id ? account : a)) }))
      return true
    },

    async removeProtonAccount(id) {
      const ok = await attempt(() => window.api.proton.removeAccount(id).then(() => true))
      if (!ok) return
      set((s) => ({ protonAccounts: s.protonAccounts.filter((a) => a.id !== id), selectedEventId: null }))
      await get().loadCalendars()
      get().refreshEvents()
    },

    async protonAction(action, id) {
      await attempt(() => window.api.proton[action](id))
    },

    async syncAllProtonAccounts() {
      await attempt(() => window.api.proton.syncAll())
    },

    async pickIcsFile() {
      return (await attempt(() => window.api.calendars.pickIcsFile())) ?? null
    },

    async syncAll() {
      await attempt(() => window.api.sync.runAll())
    },

    async syncOne(id) {
      await attempt(() => window.api.sync.runOne(id))
    },

    /** Called for every status push from the main process. */
    applySyncStatus(status) {
      const wasRunning = get().syncStatus.running
      set({ syncStatus: status })
      if (wasRunning && !status.running) {
        // A run just finished: reload calendars (last sync / error) and events.
        void get().loadCalendars()
        get().refreshEvents()
      }
    },

    async updateSettings(patch) {
      // CalendarPage refetches by itself when visibility / local event options change.
      const settings = await attempt(() => window.api.settings.update(patch))
      if (!settings) return
      // Before set(): components re-render with the new zone already in place.
      setDisplayTimeZone(settings.primaryTimeZone)
      set({ settings })
    },

    openEventEditor: (state) => set({ eventEditor: state }),
    closeEventEditor: () => set({ eventEditor: null }),

    async saveLocalEvent(input, scope) {
      const editor = get().eventEditor
      const saved = await attempt(() =>
        editor?.mode === 'edit'
          ? window.api.events.updateLocal(editor.event.id, input, scope)
          : window.api.events.createLocal(input)
      )
      if (!saved) return false
      set({ eventEditor: null, selectedEventId: saved.id })
      get().refreshEvents()
      return true
    },

    async deleteLocalEvent(id, scope) {
      const ok = await attempt(() => window.api.events.removeLocal(id, scope).then(() => true))
      if (!ok) return
      // Deleting a date of a series removes other dates too; the selection only matters for this one.
      set((s) => ({ selectedEventId: s.selectedEventId === id ? null : s.selectedEventId }))
      get().refreshEvents()
    },

    async setEventStatus(id, statusId) {
      const ok = await attempt(() => window.api.events.setStatus(id, statusId).then(() => true))
      if (ok) get().refreshEvents()
    },

    async setFollowUpReminder(id, remindAt) {
      const ok = await attempt(() => window.api.events.setFollowUpReminder(id, remindAt).then(() => true))
      if (ok) get().refreshEvents()
    }
  }
})
