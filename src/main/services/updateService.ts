import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { settingsRepository } from '../database/settingsRepository'

/** Let the window and the first sync start before hitting the network. */
const STARTUP_DELAY_MS = 10_000
/** The app often runs for days in the tray; check again now and then. */
const CHECK_INTERVAL_MS = 4 * 3_600_000

type StatusListener = (status: UpdateStatus) => void

/** Version the user chose to skip; automatic checks don't offer it again. */
const SKIPPED_VERSION_KEY = 'skippedUpdateVersion'

/**
 * Automatic updates from GitHub Releases (see build.publish in package.json and
 * .github/workflows/release.yml, which uploads the installer plus latest.yml).
 *
 * Flow: check shortly after start and every few hours -> 'available'. Nothing is
 * downloaded until the user says so: the update popup offers "Download and install"
 * or "Skip". Download -> 'downloading' -> 'ready', and the app then restarts into the
 * new version by itself. A skipped version is not offered again by automatic checks
 * (a manual "Check for updates" still offers it).
 *
 * Only active in the installed app; development builds report 'unsupported'.
 */
class UpdateService {
  private status: UpdateStatus = {
    state: app.isPackaged ? 'idle' : 'unsupported',
    version: null,
    percent: null,
    error: null,
    skipped: false
  }
  /** Set by download(): install as soon as the download finishes. */
  private installWhenDownloaded = false
  /** The next 'update-available' comes from a manual check (ignores a skipped version). */
  private manualCheck = false
  private listeners = new Set<StatusListener>()
  private startupTimer: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (!app.isPackaged) return
    // Only download when the user asks (update popup / Settings).
    autoUpdater.autoDownload = false
    // Only reached after the user chose to install, if the restart below didn't happen.
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }))
    autoUpdater.on('update-not-available', () =>
      this.set({ state: 'up-to-date', version: null, percent: null, skipped: false })
    )
    autoUpdater.on('update-available', (info) => {
      const skipped = !this.manualCheck && settingsRepository.getInternal<string>(SKIPPED_VERSION_KEY, '') === info.version
      this.manualCheck = false
      this.set({ state: 'available', version: info.version, percent: null, skipped })
    })
    autoUpdater.on('download-progress', (progress) => this.set({ percent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version, percent: 100 })
      if (this.installWhenDownloaded) this.install()
    })
    autoUpdater.on('error', (err) => {
      console.error('[updates]', err)
      this.manualCheck = false
      this.installWhenDownloaded = false
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

  /** Resolves once the check is done. `manual` = the user clicked "Check for updates". */
  async check(manual = false): Promise<UpdateStatus> {
    const { state } = this.status
    if (state === 'unsupported' || state === 'ready' || state === 'checking' || state === 'downloading') {
      return this.status
    }
    // Already found: a manual check just offers it again, even if it was skipped.
    if (state === 'available' && manual) {
      this.set({ skipped: false })
      return this.status
    }
    this.manualCheck = manual
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // Reported through the 'error' event.
    }
    return this.status
  }

  /** User chose "Download and install": downloads, then restarts into the new version. */
  download(): void {
    const { state, version } = this.status
    // 'error' with a version = a failed download; this retries it.
    if (state !== 'available' && !(state === 'error' && version)) return
    this.installWhenDownloaded = true
    this.set({ state: 'downloading', percent: 0, error: null, skipped: false })
    autoUpdater.downloadUpdate().catch(() => {
      // Reported through the 'error' event.
    })
  }

  /** User chose "Skip": automatic checks stop offering this version. */
  skip(): void {
    if (this.status.state !== 'available' || !this.status.version) return
    settingsRepository.setInternal(SKIPPED_VERSION_KEY, this.status.version)
    this.set({ skipped: true })
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
