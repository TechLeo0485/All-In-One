import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipcChannels'
import type { CalendarApi, OpenEventRequest, ProtonAccount, SyncStatus, UpdateStatus } from '@shared/types'

/**
 * The only bridge between the sandboxed renderer and the main process.
 * We expose specific functions (never ipcRenderer itself) so the renderer can
 * only call the channels listed here.
 */
const api: CalendarApi = {
  calendars: {
    list: () => ipcRenderer.invoke(IPC.calendarsList),
    create: (input) => ipcRenderer.invoke(IPC.calendarsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.calendarsUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.calendarsRemove, id),
    pickIcsFile: () => ipcRenderer.invoke(IPC.calendarsPickIcsFile)
  },
  events: {
    listInRange: (start, end) => ipcRenderer.invoke(IPC.eventsListInRange, start, end),
    get: (id) => ipcRenderer.invoke(IPC.eventsGet, id),
    search: (query) => ipcRenderer.invoke(IPC.eventsSearch, query),
    createLocal: (input) => ipcRenderer.invoke(IPC.eventsCreateLocal, input),
    updateLocal: (id, input, scope) => ipcRenderer.invoke(IPC.eventsUpdateLocal, id, input, scope),
    removeLocal: (id, scope) => ipcRenderer.invoke(IPC.eventsRemoveLocal, id, scope),
    setStatus: (id, status) => ipcRenderer.invoke(IPC.eventsSetStatus, id, status),
    setImportant: (id, important) => ipcRenderer.invoke(IPC.eventsSetImportant, id, important),
    setFollowUpReminder: (id, remindAt) => ipcRenderer.invoke(IPC.eventsSetFollowUpReminder, id, remindAt),
    listWithStatus: () => ipcRenderer.invoke(IPC.eventsListWithStatus),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.eventsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.eventsChanged, listener)
    }
  },
  notes: {
    get: (eventId) => ipcRenderer.invoke(IPC.notesGet, eventId),
    save: (eventId, content) => ipcRenderer.invoke(IPC.notesSave, eventId, content),
    remove: (eventId) => ipcRenderer.invoke(IPC.notesRemove, eventId),
    previews: (eventIds) => ipcRenderer.invoke(IPC.notesPreviews, eventIds),
    addImage: (data, mimeType) => ipcRenderer.invoke(IPC.notesAddImage, data, mimeType)
  },
  sync: {
    runAll: () => ipcRenderer.invoke(IPC.syncRunAll),
    runOne: (calendarId) => ipcRenderer.invoke(IPC.syncRunOne, calendarId),
    status: () => ipcRenderer.invoke(IPC.syncStatus),
    onStatusChange: (callback) => {
      const listener = (_event: IpcRendererEvent, status: SyncStatus): void => callback(status)
      ipcRenderer.on(IPC.syncStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.syncStatusChanged, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    suspendShortcut: (suspended) => ipcRenderer.invoke(IPC.appSuspendShortcut, suspended),
    whatsNew: () => ipcRenderer.invoke(IPC.appWhatsNew),
    whatsNewSeen: () => ipcRenderer.invoke(IPC.appWhatsNewSeen)
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    skip: () => ipcRenderer.invoke(IPC.updatesSkip),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onStatusChange: (callback) => {
      const listener = (_event: IpcRendererEvent, status: UpdateStatus): void => callback(status)
      ipcRenderer.on(IPC.updatesStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.updatesStatusChanged, listener)
    }
  },
  notifications: {
    test: () => ipcRenderer.invoke(IPC.notificationsTest),
    onOpenEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, request: OpenEventRequest): void => callback(request)
      ipcRenderer.on(IPC.openEvent, listener)
      return () => ipcRenderer.removeListener(IPC.openEvent, listener)
    }
  },
  proton: {
    listAccounts: () => ipcRenderer.invoke(IPC.protonListAccounts),
    addAccount: (label) => ipcRenderer.invoke(IPC.protonAddAccount, label),
    updateAccount: (id, patch) => ipcRenderer.invoke(IPC.protonUpdateAccount, id, patch),
    removeAccount: (id) => ipcRenderer.invoke(IPC.protonRemoveAccount, id),
    openLogin: (id) => ipcRenderer.invoke(IPC.protonOpenLogin, id),
    openProton: (id) => ipcRenderer.invoke(IPC.protonOpenProton, id),
    syncAccount: (id) => ipcRenderer.invoke(IPC.protonSyncAccount, id),
    syncAll: () => ipcRenderer.invoke(IPC.protonSyncAll),
    onAccountsChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, accounts: ProtonAccount[]): void => callback(accounts)
      ipcRenderer.on(IPC.protonAccountsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.protonAccountsChanged, listener)
    }
  },
  caller: {
    status: () => ipcRenderer.invoke(IPC.callerStatus),
    signIn: (serverUrl, email, password) => ipcRenderer.invoke(IPC.callerSignIn, serverUrl, email, password),
    signOut: () => ipcRenderer.invoke(IPC.callerSignOut),
    selectWorkspace: (slug) => ipcRenderer.invoke(IPC.callerSelectWorkspace, slug),
    listShares: () => ipcRenderer.invoke(IPC.callerListShares),
    share: (localCalendarId, profileId) => ipcRenderer.invoke(IPC.callerShare, localCalendarId, profileId),
    unshare: (localCalendarId) => ipcRenderer.invoke(IPC.callerUnshare, localCalendarId),
    syncShared: () => ipcRenderer.invoke(IPC.callerSyncShared),
    interviews: () => ipcRenderer.invoke(IPC.callerInterviews),
    eventShare: (eventId) => ipcRenderer.invoke(IPC.callerEventShare, eventId),
    shareEvent: (eventId, profileId) => ipcRenderer.invoke(IPC.callerShareEvent, eventId, profileId),
    tags: () => ipcRenderer.invoke(IPC.callerTags),
    downloadResume: (interviewId) => ipcRenderer.invoke(IPC.callerDownloadResume, interviewId),
    uploadResume: (interviewId) => ipcRenderer.invoke(IPC.callerUploadResume, interviewId),
    shareLink: (interviewId, url) => ipcRenderer.invoke(IPC.callerShareLink, interviewId, url),
    setColor: (calendarId, color) => ipcRenderer.invoke(IPC.callerSetColor, calendarId, color),
    candidates: (interviewId) => ipcRenderer.invoke(IPC.callerCandidates, interviewId),
    assign: (interviewId, callerId, force) => ipcRenderer.invoke(IPC.callerAssign, interviewId, callerId, force),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.callerChanged, listener)
      return () => ipcRenderer.removeListener(IPC.callerChanged, listener)
    }
  },
  connections: {
    status: () => ipcRenderer.invoke(IPC.connectionsStatus),
    connect: (address, key, name) => ipcRenderer.invoke(IPC.connectionsConnect, address, key, name),
    disconnect: (id) => ipcRenderer.invoke(IPC.connectionsDisconnect, id),
    refresh: (id) => ipcRenderer.invoke(IPC.connectionsRefresh, id),
    sync: (id) => ipcRenderer.invoke(IPC.connectionsSync, id),
    setListen: (id, on) => ipcRenderer.invoke(IPC.connectionsSetListen, id, on),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.connectionsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.connectionsChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
