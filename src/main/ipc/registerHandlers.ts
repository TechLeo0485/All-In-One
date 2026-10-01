import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { APP_NAME } from '@shared/brand'
import { IPC } from '@shared/ipcChannels'
import type { AppSettings } from '@shared/types'
import { calendarRepository } from '../database/calendarRepository'
import { eventRepository } from '../database/eventRepository'
import { noteRepository } from '../database/noteRepository'
import { settingsRepository } from '../database/settingsRepository'
import { isFileSource } from '@shared/sources'
import { fileSourceService } from '../services/fileSourceService'
import { protonAccountService } from '../services/proton/protonAccountService'
import { reminderService } from '../services/reminderService'
import { syncService } from '../sync/syncService'
import * as v from './validation'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * Registers all `ipcMain.handle` endpoints. Handlers are thin: validate input,
 * call a repository/service, return plain serializable data.
 */
/** Main-process side effects the handlers trigger (wired up in index.ts). */
export interface HandlerHooks {
  onSettingsChanged(patch: Partial<AppSettings>, settings: AppSettings): void
  /** Local events or calendar notification switches changed: re-check reminders. */
  onEventsChanged(): void
}

export function registerIpcHandlers(hooks: HandlerHooks): void {
  const handle = (channel: string, handler: Handler): void => {
    ipcMain.handle(channel, handler)
  }
  const withEventsChanged = <T>(result: T): T => {
    hooks.onEventsChanged()
    return result
  }

  /** Local files may only be used if they were chosen in the native dialog. */
  const assertFileAllowed = (sourceUrl: string | undefined, currentUrl?: string): void => {
    if (sourceUrl && isFileSource(sourceUrl) && !fileSourceService.isAllowed(sourceUrl, currentUrl)) {
      throw new Error('Please choose the file with the "Choose file" button')
    }
  }

  // Calendars
  handle(IPC.calendarsList, () => calendarRepository.list())
  handle(IPC.calendarsCreate, (_e, input) => {
    const parsed = v.calendarInput(input)
    assertFileAllowed(parsed.sourceUrl)
    const calendar = calendarRepository.create(parsed)
    // Fetch the new feed right away; the UI is notified through status events.
    if (calendar.enabled) void syncService.syncOne(calendar.id)
    return calendar
  })
  handle(IPC.calendarsUpdate, (_e, id, input) => {
    const before = calendarRepository.get(v.id(id))
    const patch = v.partialCalendarInput(input)
    assertFileAllowed(patch.sourceUrl, before?.sourceUrl)
    if (before?.accountId && patch.sourceUrl !== undefined && patch.sourceUrl !== before.sourceUrl) {
      throw new Error('The source of a Proton account calendar is managed automatically')
    }
    const calendar = calendarRepository.update(v.id(id), patch)
    const urlChanged = before && patch.sourceUrl !== undefined && patch.sourceUrl !== before.sourceUrl
    // Choosing a new source (e.g. "Update from file") is an explicit request to read it.
    if (calendar.enabled && urlChanged) void syncService.syncOne(calendar.id)
    return withEventsChanged(calendar) // enabled / notify affect reminders
  })
  handle(IPC.calendarsRemove, (_e, id) => {
    calendarRepository.remove(v.id(id))
    settingsRepository.pruneHiddenCalendars(calendarRepository.list().map((c) => c.id))
    hooks.onEventsChanged()
  })
  handle(IPC.calendarsPickIcsFile, (e) => fileSourceService.pickFile(BrowserWindow.fromWebContents(e.sender)))

  // Events
  handle(IPC.eventsListInRange, (_e, start, end) =>
    eventRepository.listInRange(v.rangeBound(start, 'start'), v.rangeBound(end, 'end'))
  )
  handle(IPC.eventsGet, (_e, id) => eventRepository.get(v.id(id)))
  handle(IPC.eventsCreateLocal, (_e, input) => withEventsChanged(eventRepository.createLocal(v.localEventInput(input))))
  handle(IPC.eventsUpdateLocal, (_e, id, input) =>
    withEventsChanged(eventRepository.updateLocal(v.id(id), v.localEventInput(input)))
  )
  handle(IPC.eventsRemoveLocal, (_e, id) => withEventsChanged(eventRepository.removeLocal(v.id(id))))

  // Notes
  handle(IPC.notesGet, (_e, eventId) => noteRepository.getForEvent(v.id(eventId, 'eventId')))
  handle(IPC.notesSave, (_e, eventId, content) => {
    const eid = v.id(eventId, 'eventId')
    if (!eventRepository.get(eid)) throw new Error('Event not found')
    // Keep whitespace as typed: markdown is sensitive to it.
    if (typeof content !== 'string' || content.length > 1_000_000) throw new Error('Invalid note content')
    return noteRepository.save(eid, content)
  })
  handle(IPC.notesRemove, (_e, eventId) => noteRepository.remove(v.id(eventId, 'eventId')))

  // Sync
  handle(IPC.syncRunAll, () => syncService.syncAll())
  handle(IPC.syncRunOne, (_e, id) => syncService.syncOne(v.id(id)))
  handle(IPC.syncStatus, () => syncService.getStatus())

  // Settings
  handle(IPC.settingsGet, () => settingsRepository.get())
  handle(IPC.settingsUpdate, (_e, patch) => {
    const parsed = v.settingsPatch(patch)
    const settings = settingsRepository.update(parsed)
    hooks.onSettingsChanged(parsed, settings)
    return settings
  })

  // App
  handle(IPC.appInfo, () => ({ name: APP_NAME, version: app.getVersion(), dataFolder: app.getPath('userData') }))

  // Notifications
  handle(IPC.notificationsTest, () => reminderService.showTest())

  // Proton accounts
  const accountLabel = (value: unknown): string => v.str(value, 'Account name', { required: true, max: 100 })
  handle(IPC.protonListAccounts, () => protonAccountService.list())
  handle(IPC.protonAddAccount, (_e, label) => protonAccountService.add(accountLabel(label)))
  handle(IPC.protonUpdateAccount, (_e, id, patch) => {
    const p = (patch ?? {}) as Record<string, unknown>
    return protonAccountService.update(v.id(id), {
      label: p.label === undefined ? undefined : accountLabel(p.label)
    })
  })
  handle(IPC.protonRemoveAccount, async (_e, id) => {
    await protonAccountService.remove(v.id(id))
    settingsRepository.pruneHiddenCalendars(calendarRepository.list().map((c) => c.id))
  })
  handle(IPC.protonOpenLogin, (_e, id) => protonAccountService.openLogin(v.id(id)))
  handle(IPC.protonOpenProton, (_e, id) => protonAccountService.openProton(v.id(id)))
  // Don't make the renderer wait for a multi-minute export; progress arrives via push events.
  handle(IPC.protonSyncAccount, (_e, id) => void protonAccountService.sync(v.id(id)))
  handle(IPC.protonSyncAll, () => void protonAccountService.syncAll())
}
