import { app, BrowserWindow, dialog, nativeTheme, Notification, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '@shared/brand'
import { IPC } from '@shared/ipcChannels'
import type { AppSettings, OpenEventRequest } from '@shared/types'
import { setUpDataFolder } from './dataFolder'
import { calendarRepository } from './database/calendarRepository'
import { closeDb, getDb } from './database/connection'
import { DatabaseUpgradeError } from './database/migrations'
import { settingsRepository } from './database/settingsRepository'
import { protonAccountService } from './services/proton/protonAccountService'
import { registerIpcHandlers } from './ipc/registerHandlers'
import { syncService } from './sync/syncService'
import { reminderService } from './services/reminderService'
import { autoSyncService } from './services/autoSyncService'
import { trayService } from './services/trayService'
import { updateService } from './services/updateService'
import { appIconFile, createNotification, registerWindowsIdentity } from './services/windowsIdentity'

/** Passed by the "Start with Windows" login item: start in the tray, no window. */
const START_HIDDEN_FLAG = '--hidden'

app.setName(APP_NAME)
// %APPDATA%\All-In-One for dev and the installed app; moves data from the pre-rename
// folder on first start. Must run before the app is ready.
const dataMigration = setUpDataFolder()

let mainWindow: BrowserWindow | null = null
/** True once the user chose Quit (tray menu, or close with close-to-tray off). */
let quitting = false
let trayHintShown = false
/** Version we already showed the "update ready" notification for. */
let updateNotifiedVersion: string | null = null

function createWindow(showOnReady: boolean): BrowserWindow {
  // Dark UI: also makes the Windows title bar dark.
  nativeTheme.themeSource = 'dark'
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    icon: appIconFile(),
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    // Our own title bar (TitleBar.tsx) without the app icon, so there is no icon to
    // open the Windows system menu (Restore/Move/Size/...). Windows still draws the
    // minimize/maximize/close buttons. Height must match TITLE_BAR_HEIGHT there.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f172a', symbolColor: '#cbd5e1', height: 32 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security: the renderer gets no Node access. Everything goes through the
      // narrow, typed API exposed by the preload script via contextBridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (showOnReady) win.once('ready-to-show', () => win.show())
  // Right-clicking the title bar would still open the system menu.
  win.on('system-context-menu', (event) => event.preventDefault())

  // Links (e.g. inside meeting notes or event descriptions) open in the system
  // browser; the app window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Creates the main window and keeps `mainWindow` in sync with its lifetime. */
function openMainWindow(show = true): BrowserWindow {
  const win = createWindow(show)
  mainWindow = win

  // Close button: hide to the tray (reminders keep working) unless the user is quitting.
  win.on('close', (event) => {
    if (quitting || !settingsRepository.get().closeToTray) return
    event.preventDefault()
    win.hide()
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true
      createNotification({
        title: `${APP_NAME} is still running`,
        body: 'It stays in the system tray so you get event reminders. Right-click the tray icon to quit.',
        silent: true
      }).show()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // Window really closed (quit or close-to-tray off): end the process, which also
    // stops hidden Proton export windows.
    if (process.platform !== 'darwin') quitApp()
  })
  return win
}

/** Sends to the renderer only while the main window is alive. */
function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function showWindow(): BrowserWindow | null {
  if (!app.isReady()) return null
  if (!mainWindow || mainWindow.isDestroyed()) openMainWindow()
  const win = mainWindow!
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/** From a reminder click or the tray's "Next" item: show the window on that event. */
function openEvent(request: OpenEventRequest): void {
  const win = showWindow()
  if (!win) return
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => sendToRenderer(IPC.openEvent, request))
  } else {
    sendToRenderer(IPC.openEvent, request)
  }
}

/**
 * Startup failed before any window exists, so a main-process error box is the only
 * way to tell the user (the in-app askConfirm dialogs need the renderer).
 */
function reportDatabaseError(err: unknown): void {
  console.error('[db] could not open the database:', err)
  const reason = err instanceof Error ? err.message : String(err)
  const backup = err instanceof DatabaseUpgradeError && err.backupFile ? `

A backup from before the update is at:
${err.backupFile}` : ''
  dialog.showErrorBox(
    `${APP_NAME} could not open its data`,
    `${reason}

Your data has not been deleted. Data folder:
${app.getPath('userData')}${backup}

` +
      'Try starting the app again. If this keeps happening, reinstall the previous version and contact the developer.'
  )
  app.exit(1)
}

function quitApp(): void {
  quitting = true
  app.quit()
}

/** Registers/unregisters the Windows login item ("Start with Windows", hidden in tray). */
function applyLaunchAtStartup(enabled: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  // In development the executable is electron.exe, which needs the app path as argument.
  const args = app.isPackaged ? [START_HIDDEN_FLAG] : [app.getAppPath(), START_HIDDEN_FLAG]
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args, name: APP_NAME })
  // Remove entries written before the rename (they were named after the old app id).
  for (const legacyName of ['local.unified-calendar', process.execPath]) {
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, name: legacyName })
  }
}

/** Side effects of settings that live in the main process. */
function onSettingsChanged(patch: Partial<AppSettings>, settings: AppSettings): void {
  if (patch.launchAtStartup !== undefined) applyLaunchAtStartup(settings.launchAtStartup)
  reminderService.refresh() // also updates the tray
}

// A second instance would fight over the SQLite file and double-fire reminders.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Starting the app again (e.g. from the Start menu) brings the window back from the tray.
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    // Notifications show "All-In-One" and its icon (not "Electron"), in dev and installed.
    registerWindowsIdentity()
    // Open + migrate before anything else touches the database. If that fails, say
    // so and quit: otherwise the app would sit in the background with no window.
    try {
      getDb()
    } catch (err) {
      reportDatabaseError(err)
      return
    }
    if (dataMigration) {
      // Proton calendars point at export files inside the data folder.
      const moved = calendarRepository.rebaseFileSources(dataMigration.fromUrl, dataMigration.toUrl)
      console.log(`[data] updated ${moved} calendar file paths`)
    }

    registerIpcHandlers({ onSettingsChanged, onEventsChanged: () => reminderService.refresh() })

    const startHidden = process.argv.includes(START_HIDDEN_FLAG)
    openMainWindow(!startHidden)

    // Proton is never fetched automatically: the app shows the cached events and
    // only syncs Proton when the user clicks a refresh button. Web links (Google
    // etc.) refresh on the auto-sync timer.

    // Push sync progress to the renderer so the UI can refresh cached events.
    syncService.onStatusChange((status) => {
      sendToRenderer(IPC.syncStatusChanged, status)
      if (!status.running) reminderService.refresh() // also updates the tray
    })

    trayService.create({
      show: () => showWindow(),
      openEvent,
      // A click in the tray menu is an explicit user request to sync.
      refresh: () => {
        void syncService.syncAll()
        void protonAccountService.syncAll()
      },
      installUpdate: () => updateService.install(),
      quit: quitApp
    })
    // Reminders run in the main process, so they also fire while the window is hidden.
    reminderService.start(openEvent, () => trayService.update())
    autoSyncService.start()

    // Updates download in the background; once ready, tell the user once per version
    // (also when the app started hidden in the tray at login).
    updateService.onStatusChange((status) => {
      sendToRenderer(IPC.updatesStatusChanged, status)
      trayService.update()
      if (status.state === 'ready' && status.version !== updateNotifiedVersion && Notification.isSupported()) {
        updateNotifiedVersion = status.version
        const notification = createNotification({
          title: `${APP_NAME} ${status.version} is ready`,
          body: 'Click to open, then choose Restart now. Otherwise it installs the next time you quit.'
        })
        notification.on('click', () => showWindow())
        notification.show()
      }
    })
    updateService.start()

    // Connected Proton accounts (exports run only on request).
    // (New calendars from an export reach the UI via the sync status push that follows.)
    protonAccountService.onChange((accounts) => sendToRenderer(IPC.protonAccountsChanged, accounts))
    protonAccountService.init(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))

    // Keep the OS login item in sync with the saved setting (e.g. after reinstalling).
    applyLaunchAtStartup(settingsRepository.get().launchAtStartup)

    app.on('activate', () => showWindow())
  })

  // With the tray, the app keeps running when its windows are hidden; it only
  // quits through quitApp() (tray "Quit", or closing with close-to-tray off).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && quitting) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', () => {
    reminderService.stop()
    autoSyncService.stop()
    updateService.stop()
    trayService.destroy()
    protonAccountService.shutdown() // aborts in-flight exports before the DB closes
    closeDb()
  })
}
