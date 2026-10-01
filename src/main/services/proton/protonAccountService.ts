import { app, BrowserWindow, Notification, type DownloadItem } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { extname, basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nextUnusedColor } from '@shared/colors'
import type { ProtonAccount } from '@shared/types'
import { accountRepository } from '../../database/accountRepository'
import { calendarRepository } from '../../database/calendarRepository'
import { syncService } from '../../sync/syncService'
import { createNotification } from '../windowsIdentity'
import { ExportAbortedError, exportAccountCalendars, LoginRequiredError, type ExportedCalendar } from './protonExporter'
import {
  clearProtonSession,
  getProtonSession,
  isSignedInUrl,
  lockNavigationToProton,
  PROTON_EXPORT_URL,
  PROTON_LOGIN_URL,
  setDownloadListener
} from './protonSession'

const MISSING_WARNING = 'Not found in this Proton account anymore. Remove it if it was deleted in Proton.'

type Listener = (accounts: ProtonAccount[]) => void

/**
 * Orchestrates connected Proton accounts:
 *  - login / browsing windows (one persistent session per account)
 *  - exports on user request (no schedule), one account at a time, cancellable
 *  - turning exported .ics files into app calendars (auto-created, rename-aware)
 *
 * Exported files live in <userData>/proton-exports/<accountId>/ and each account
 * calendar uses its file as a file: source, so the normal sync pipeline (parse,
 * stable IDs, notes) is reused unchanged.
 */
class ProtonAccountService {
  private listeners = new Set<Listener>()
  private syncing = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private queued = new Set<string>()
  private windows = new Map<string, BrowserWindow>()
  /** Abort handle of the export currently running for an account. */
  private exportAborts = new Map<string, AbortController>()
  /** Per-account chain so imports (automatic + manual) never run concurrently. */
  private importChains = new Map<string, Promise<unknown>>()
  private parentWindow: (() => BrowserWindow | null) | null = null
  private stopped = false

  /* ---------- state ---------- */

  list(): ProtonAccount[] {
    return accountRepository.list().map((a) => (this.syncing.has(a.id) ? { ...a, status: 'syncing' as const } : a))
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    if (this.stopped) return
    const accounts = this.list()
    for (const l of this.listeners) {
      try {
        l(accounts)
      } catch (err) {
        console.error('[proton] listener failed:', err)
      }
    }
  }

  /* ---------- account management ---------- */

  add(label: string): ProtonAccount {
    const account = accountRepository.create(label)
    this.emit()
    this.openLogin(account.id)
    return account
  }

  update(id: string, patch: { label?: string }): ProtonAccount {
    const account = accountRepository.update(id, patch)
    this.emit()
    return account
  }

  async remove(id: string): Promise<void> {
    // Stop everything touching this account's session before wiping it.
    this.exportAborts.get(id)?.abort()
    this.windows.get(id)?.destroy()
    await (this.importChains.get(id) ?? Promise.resolve()).catch(() => undefined)

    for (const c of calendarRepository.listForAccount(id)) syncService.setWarning(c.id, null)
    accountRepository.remove(id)
    this.emit()
    await clearProtonSession(id).catch(() => undefined)
    await rm(this.exportDir(id), { recursive: true, force: true }).catch(() => undefined)
  }

  /* ---------- windows ---------- */

  /** Shows Proton's login page; closes itself once signed in and starts the first export. */
  openLogin(id: string): void {
    this.openWindow(id, PROTON_LOGIN_URL, true)
  }

  /** Opens Proton's Import/export page; a manual "Download ICS" is captured and imported. */
  openProton(id: string): void {
    this.openWindow(id, PROTON_EXPORT_URL, false)
  }

  private openWindow(id: string, url: string, closeWhenSignedIn: boolean): void {
    const account = accountRepository.get(id)
    if (!account) throw new Error('Account not found')

    const existing = this.windows.get(id)
    if (existing && !existing.isDestroyed()) {
      void existing.loadURL(url)
      existing.focus()
      return
    }

    // The user takes over: a background export would compete for the same session
    // and downloads, so cancel it. (The user can sync again afterwards.)
    this.exportAborts.get(id)?.abort()

    const ses = getProtonSession(id)
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      parent: this.parentWindow?.() ?? undefined,
      title: `Proton – ${account.label}`,
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    this.windows.set(id, win)
    lockNavigationToProton(win.webContents)
    // Keep our title (Proton sets its own page titles).
    win.on('page-title-updated', (e) => e.preventDefault())
    setDownloadListener(id, (item) => this.captureManualDownload(id, item))

    let signedIn = false
    const checkSignedIn = (navUrl: string): void => {
      if (!isSignedInUrl(navUrl)) return
      signedIn = true
      if (!closeWhenSignedIn) return
      // Give Proton a moment to persist the session before closing.
      setTimeout(() => {
        if (!win.isDestroyed()) win.close()
      }, 2500)
    }
    win.webContents.on('did-navigate', (_e, u) => checkSignedIn(u))
    win.webContents.on('did-navigate-in-page', (_e, u) => checkSignedIn(u))

    win.on('closed', () => {
      if (this.windows.get(id) === win) this.windows.delete(id)
      if (this.stopped || !accountRepository.get(id)) return
      // No automatic download after closing: the user syncs when they want to.
      // A successful login only moves the account to "Logged in" (ready).
      if (signedIn) {
        accountRepository.markReady(id)
        this.emit()
      }
    })
    void win.loadURL(url)
  }

  /** Files the user downloads by hand in a Proton window ("<name>-YYYY-MM-DD.ics"). */
  private captureManualDownload(id: string, item: DownloadItem): void {
    const filename = item.getFilename()
    if (!/\.ics$/i.test(filename)) {
      item.setSavePath(uniquePath(app.getPath('downloads'), filename)) // unrelated download: save normally
      return
    }
    const name = filename.replace(/(-\d{4}-\d{2}-\d{2})?( ?\(\d+\))?\.ics$/i, '').trim() || 'Calendar'
    const dir = this.exportDir(id)
    const target = join(dir, `incoming-${Date.now()}.ics`)
    // Electron requires setSavePath synchronously inside will-download.
    mkdirSync(dir, { recursive: true })
    item.setSavePath(target)
    item.once('done', (_e, state) => {
      if (state !== 'completed') return
      this.importExports(id, [{ name, path: target }], false)
        .then(() => {
          createNotification({ title: 'Calendar imported', body: `${name} was updated from Proton.` }).show()
        })
        .catch((err) => console.error(`[proton] manual import failed: ${String(err)}`))
    })
  }

  /* ---------- syncing ---------- */

  /** Queues an export for one account (accounts run one at a time). */
  sync(id: string): Promise<void> {
    if (this.stopped || this.queued.has(id) || this.syncing.has(id)) return Promise.resolve()
    this.queued.add(id)
    const run = this.queue.then(() => this.runExport(id))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Syncs every logged-in account (accounts that need a login are skipped). */
  syncAll(): Promise<void> {
    const syncable = this.list().filter((a) => a.status !== 'new' && a.status !== 'login-required')
    return Promise.all(syncable.map((a) => this.sync(a.id))).then(() => undefined)
  }

  private async runExport(id: string): Promise<void> {
    this.queued.delete(id)
    const account = accountRepository.get(id)
    // Skip removed accounts and accounts the user is currently using interactively.
    if (this.stopped || !account || this.windows.has(id)) return

    const controller = new AbortController()
    this.exportAborts.set(id, controller)
    this.syncing.add(id)
    this.emit()
    const exported: ExportedCalendar[] = []
    const dir = this.exportDir(id)
    try {
      await mkdir(dir, { recursive: true })
      const { names } = await exportAccountCalendars(id, dir, (c) => exported.push(c), controller.signal)
      await this.importExports(id, exported, true, names)
      accountRepository.setResult(id, 'ok', null)
    } catch (err) {
      if (err instanceof ExportAbortedError || this.stopped || !accountRepository.get(id)) return
      // Keep whatever calendars were exported before the failure.
      if (exported.length) await this.importExports(id, exported, false).catch(() => undefined)
      if (err instanceof LoginRequiredError) {
        accountRepository.setResult(id, 'login-required', err.message)
        if (account.status !== 'login-required' && account.status !== 'new') this.notifyLoginRequired(account)
      } else {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[proton] ${account.label}: ${message}`)
        accountRepository.setResult(id, 'error', message)
      }
    } finally {
      if (this.exportAborts.get(id) === controller) this.exportAborts.delete(id)
      this.syncing.delete(id)
      await removeLeftoverDownloads(dir)
      this.emit()
    }
  }

  /** Serializes imports per account (manual downloads can race automatic exports). */
  private importExports(
    accountId: string,
    exported: ExportedCalendar[],
    complete: boolean,
    allNames?: string[]
  ): Promise<void> {
    const previous = this.importChains.get(accountId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(() => this.doImport(accountId, exported, complete, allNames))
    this.importChains.set(accountId, run)
    void run.finally(() => {
      if (this.importChains.get(accountId) === run) this.importChains.delete(accountId)
    }).catch(() => undefined)
    return run
  }

  /**
   * Maps exported files to app calendars, creating new ones as needed.
   * When `complete` (a full export of the account), a single disappeared +
   * single new calendar name is treated as a rename so notes stay attached.
   */
  private async doImport(
    accountId: string,
    exported: ExportedCalendar[],
    complete: boolean,
    allNames: string[] = exported.map((e) => e.name)
  ): Promise<void> {
    if (this.stopped || !accountRepository.get(accountId)) return // removed meanwhile

    const existing = calendarRepository.listForAccount(accountId)
    const byName = new Map(existing.map((c) => [c.protonCalendarName ?? '', c]))
    const missing = complete ? existing.filter((c) => !allNames.includes(c.protonCalendarName ?? '')) : []
    const added = allNames.filter((n) => !byName.has(n))
    if (complete && missing.length === 1 && added.length === 1) {
      byName.set(added[0], missing.splice(0, 1)[0])
    }

    const usedColors = calendarRepository.list().map((c) => c.color)
    const toSync: string[] = []
    for (const { name, path } of exported) {
      const finalPath = join(this.exportDir(accountId), `${slug(name)}-${shortHash(name)}.ics`)
      await renameWithRetry(path, finalPath)
      const url = pathToFileURL(finalPath).href

      let calendar = byName.get(name)
      if (!calendar) {
        const color = nextUnusedColor(usedColors)
        usedColors.push(color)
        calendar = calendarRepository.createForAccount(accountId, name, { name, color, sourceUrl: url, enabled: true })
        byName.set(name, calendar)
      } else if (calendar.sourceUrl !== url || calendar.protonCalendarName !== name) {
        calendarRepository.relinkAccountCalendar(calendar.id, name, url)
      }
      syncService.setWarning(calendar.id, null)
      if (calendar.enabled) toSync.push(calendar.id)
    }

    for (const c of missing) {
      syncService.setWarning(c.id, MISSING_WARNING)
      calendarRepository.setSyncResult(c.id, MISSING_WARNING)
    }
    await Promise.all(toSync.map((cid) => syncService.syncOne(cid)))
  }

  /* ---------- lifecycle ---------- */

  /** There is deliberately no scheduler: exports only run when the user asks. */
  init(parentWindow: () => BrowserWindow | null): void {
    this.parentWindow = parentWindow
    this.stopped = false
  }

  /** Cancels running exports (called on quit). */
  shutdown(): void {
    this.stopped = true
    for (const c of this.exportAborts.values()) c.abort()
  }

  private notifyLoginRequired(account: ProtonAccount): void {
    if (!Notification.isSupported()) return
    const n = createNotification({
      title: 'Proton login needed',
      body: `"${account.label}" was signed out by Proton. Click to log in again.`
    })
    n.on('click', () => this.openLogin(account.id))
    n.show()
  }

  private exportDir(accountId: string): string {
    return join(app.getPath('userData'), 'proton-exports', accountId)
  }
}

function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'calendar'
  )
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

/** Windows: antivirus/indexer or a concurrent read can briefly lock a fresh file. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw err
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
  }
}

/** Deletes temp "incoming-*" files left by failed or cancelled exports. */
async function removeLeftoverDownloads(dir: string): Promise<void> {
  const files = await readdir(dir).catch(() => [] as string[])
  await Promise.all(
    files.filter((f) => f.startsWith('incoming-')).map((f) => rm(join(dir, f), { force: true }).catch(() => undefined))
  )
}

/** "report.pdf" -> "report (1).pdf" if it already exists, so we never overwrite. */
function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

export const protonAccountService = new ProtonAccountService()
