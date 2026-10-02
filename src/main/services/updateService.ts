import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/** Let the window and the first sync start before hitting the network. */
const STARTUP_DELAY_MS = 10_000
/** The app often runs for days in the tray; check again now and then. */
const CHECK_INTERVAL_MS = 4 * 3_600_000

type StatusListener = (status: UpdateStatus) => void

/**
 * Automatic updates from GitHub Releases (see build.publish in package.json and
 * .github/workflows/release.yml, which uploads the installer plus latest.yml).
 *
 * Flow: check shortly after start and every few hours -> download in the background
 * -> 'ready'. The update is then installed when the user clicks "Restart now"
 * (banner, notification or tray), or silently whenever the app quits. A downloaded
 * update is cached, so if the PC shuts down first, the next start offers it again
 * right away.
 *
 * Only active in the installed app; development builds report 'unsupported'.
 */
class UpdateService {
  private status: UpdateStatus = {
    state: app.isPackaged ? 'idle' : 'unsupported',
    version: null,
    percent: null,
    error: null
  }
  private listeners = new Set<StatusListener>()
  private startupTimer: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date', version: null, percent: null }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (progress) => this.set({ percent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version, percent: 100 }))
    autoUpdater.on('error', (err) => {
      console.error('[updates]', err)
      // A failed re-check must not hide an update that is already downloaded.
      if (this.status.state !== 'ready') this.set({ state: 'error', percent: null, error: describeError(err) })
    })

    this.startupTimer = setTimeout(() => void this.check(), STARTUP_DELAY_MS)
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.timer) clearInterval(this.timer)
    this.startupTimer = this.timer = null
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolves once the check is done; a found update keeps downloading in the background. */
  async check(): Promise<UpdateStatus> {
    const { state } = this.status
    if (state === 'unsupported' || state === 'ready' || state === 'checking' || state === 'downloading') {
      return this.status
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // Reported through the 'error' event.
    }
    return this.status
  }

  /** Quits, runs the installer silently and starts the new version. */
  install(): void {
    if (this.status.state !== 'ready') return
    // Deferred so the IPC reply reaches the renderer before the app quits.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const listener of this.listeners) {
      try {
        listener(this.status)
      } catch (err) {
        console.error('[updates] status listener failed:', err)
      }
    }
  }
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // No release published yet, or latest.yml missing from it.
  if (/404|Cannot find latest|Unable to find latest/i.test(message)) return 'No published update found'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|net::/i.test(message)) return 'No internet connection'
  // electron-updater errors can include long HTTP dumps; the first line is the useful part.
  return message.split('\n')[0].slice(0, 200)
}

export const updateService = new UpdateService()
