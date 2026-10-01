import { create } from 'zustand'
import type {
  AppSettings,
  CalendarEvent,
  CalendarSource,
  CalendarSourceInput,
  LocalEventInput,
  OpenEventRequest,
  ProtonAccount,
  SyncStatus
} from '@shared/types'
import { errorMessage } from '../utils/errors'

export type View = 'calendar' | 'accounts' | 'calendars' | 'settings'

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
  saveLocalEvent(input: LocalEventInput): Promise<boolean>
  deleteLocalEvent(id: string): Promise<void>
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
    syncStatus: { running: false, lastRunAt: null, results: [] },
    selectedEventId: null,
    focusDate: null,
    eventsVersion: 0,
    eventEditor: null,
    toasts: [],

    async init() {
      const [calendars, settings, syncStatus, protonAccounts] = await Promise.all([
        window.api.calendars.list(),
        window.api.settings.get(),
        window.api.sync.status(),
        window.api.proton.listAccounts()
      ])
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
      if (settings) set({ settings })
    },

    openEventEditor: (state) => set({ eventEditor: state }),
    closeEventEditor: () => set({ eventEditor: null }),

    async saveLocalEvent(input) {
      const editor = get().eventEditor
      const saved = await attempt(() =>
        editor?.mode === 'edit'
          ? window.api.events.updateLocal(editor.event.id, input)
          : window.api.events.createLocal(input)
      )
      if (!saved) return false
      set({ eventEditor: null, selectedEventId: saved.id })
      get().refreshEvents()
      return true
    },

    async deleteLocalEvent(id) {
      const ok = await attempt(() => window.api.events.removeLocal(id).then(() => true))
      if (!ok) return
      set((s) => ({ selectedEventId: s.selectedEventId === id ? null : s.selectedEventId }))
      get().refreshEvents()
    }
  }
})
