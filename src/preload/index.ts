import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipcChannels'
import type { CalendarApi, OpenEventRequest, ProtonAccount, SyncStatus } from '@shared/types'

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
    createLocal: (input) => ipcRenderer.invoke(IPC.eventsCreateLocal, input),
    updateLocal: (id, input) => ipcRenderer.invoke(IPC.eventsUpdateLocal, id, input),
    removeLocal: (id) => ipcRenderer.invoke(IPC.eventsRemoveLocal, id)
  },
  notes: {
    get: (eventId) => ipcRenderer.invoke(IPC.notesGet, eventId),
    save: (eventId, content) => ipcRenderer.invoke(IPC.notesSave, eventId, content),
    remove: (eventId) => ipcRenderer.invoke(IPC.notesRemove, eventId)
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
    info: () => ipcRenderer.invoke(IPC.appInfo)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
