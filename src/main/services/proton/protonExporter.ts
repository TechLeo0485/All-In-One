import { BrowserWindow, type DownloadItem } from 'electron'
import { join } from 'node:path'
import { getProtonSession, isLoginUrl, lockNavigationToProton, PROTON_EXPORT_URL, setDownloadListener } from './protonSession'

/**
 * Automates Proton's own "Download ICS" flow in a hidden window that uses the
 * account's saved session. This is the only export path available to free Proton
 * accounts (no share links, no API/CalDAV).
 *
 * The page structure below comes from Proton's open-source web client
 * (github.com/ProtonMail/WebClients):
 *   packages/components/containers/calendar/settings/CalendarExportSection.tsx
 *   packages/components/containers/calendar/exportModal/ExportModal.tsx
 *
 *   <div class="flex">
 *     <span><button id="calendar-<ID>" class="select field">Selected name</button></span>  ← CalendarSelect (SelectTwo)
 *     <span><button>Download ICS</button></span>
 *   </div>
 *   dropdown options: <li class="dropdown-item"><button title="<calendar name>">…</button></li>
 *   modal: export runs, then a submit button "Save ICS file" appears → triggers a
 *          blob download named "<calendar name>-YYYY-MM-DD.ics"
 *
 * Selectors are structural (ids/classes/attributes), not text, so they work in
 * any UI language. If Proton changes this page, the export fails with a clear
 * error and the user can still use "Open Proton" + Download ICS manually.
 */

export class LoginRequiredError extends Error {
  constructor() {
    super('Proton login expired. Log in again to resume syncing.')
    this.name = 'LoginRequiredError'
  }
}

export interface ExportedCalendar {
  /** Calendar name as shown in Proton */
  name: string
  /** Temporary path of the downloaded .ics file */
  path: string
}

const PAGE_LOAD_TIMEOUT_MS = 90_000
const DOWNLOAD_TIMEOUT_MS = 6 * 60_000

/* ---------- scripts executed inside Proton's page ---------- */

const PAGE_HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeoutMs, what) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      await sleep(150);
    }
    throw new Error('EXPORT_UI_TIMEOUT: ' + what);
  };
  // The export section comes after the import section, so take the last calendar select.
  const exportSelect = () => [...document.querySelectorAll('button[id^="calendar-"]')].pop() || null;
  const options = () => [...document.querySelectorAll('li.dropdown-item button[title]')];
`

const DETECT_STATE_SCRIPT = `(() => {
  const path = location.pathname;
  if (/^\\/(login|switch|signup|reauth|authorize)(\\/|$)/.test(path)) return 'login';
  if (document.querySelector('input#username, input[name="username"], input#password')) return 'login';
  if ([...document.querySelectorAll('button[id^="calendar-"]')].length) return 'ready';
  return 'loading';
})()`

const LIST_CALENDARS_SCRIPT = `(async () => {
  ${PAGE_HELPERS}
  const select = exportSelect();
  if (!select) throw new Error('EXPORT_CONTROLS_NOT_FOUND');
  const current = select.textContent.trim();
  select.click();
  const opts = await waitFor(() => { const o = options(); return o.length ? o : null; }, 8000, 'calendar list');
  const names = opts.map((o) => o.title);
  // Close the dropdown by re-selecting the current calendar.
  (opts.find((o) => o.title === current) || opts[0]).click();
  await sleep(300);
  return names;
})()`

/** Selects the calendar at `index` in the dropdown (by position, so duplicate names work). */
function exportCalendarScript(index: number, name: string): string {
  return `(async (index, name) => {
    ${PAGE_HELPERS}
    // Dismiss any welcome / what's-new dialog that might cover the page.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    let select = exportSelect();
    if (!select) throw new Error('EXPORT_CONTROLS_NOT_FOUND');
    select.click();
    const option = await waitFor(() => options()[index], 8000, 'calendar "' + name + '" in list');
    if (option.title !== name) throw new Error('EXPORT_UI_TIMEOUT: calendar list changed during export');
    option.click();
    await waitFor(() => { const s = exportSelect(); return s && s.textContent.trim() === name; }, 8000, 'calendar selection');
    select = exportSelect();

    const row = select.parentElement && select.parentElement.parentElement;
    const download = row && [...row.querySelectorAll('button')].find((b) => b !== select && !b.id.startsWith('calendar-'));
    if (!download) throw new Error('EXPORT_CONTROLS_NOT_FOUND');

    const existingSubmits = new Set(document.querySelectorAll('button[type="submit"]'));
    download.click();
    // The modal fetches + decrypts all events, then shows the "Save ICS file" submit button.
    const save = await waitFor(
      () => [...document.querySelectorAll('button[type="submit"]')].find((b) => !existingSubmits.has(b) && !b.disabled),
      5 * 60 * 1000,
      'export to finish'
    );
    save.click();
    return true;
  })(${index}, ${JSON.stringify(name)})`
}

/**
 * Proton allows two calendars with the same name; give duplicates a stable
 * suffix so each maps to its own app calendar: "Work", "Work (2)".
 */
export function uniqueCalendarNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1
    seen.set(n, count)
    return count === 1 ? n : `${n} (${count})`
  })
}

export class ExportAbortedError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportAbortedError'
  }
}

/* ---------- main-process side ---------- */

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

function describePageError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('EXPORT_CONTROLS_NOT_FOUND') || message.includes('EXPORT_UI_TIMEOUT')) {
    return new Error(
      `Couldn't operate Proton's export page (${message.replace(/^.*?(EXPORT_\w+)/, '$1')}). ` +
        'Proton may have changed its website. Use "Open Proton" and click Download ICS as a workaround.'
    )
  }
  return err instanceof Error ? err : new Error(message)
}

/**
 * Exports every calendar of one account. Downloads are written to `incomingDir`.
 * Calls `onCalendar` after each calendar so partial progress is kept even if a
 * later calendar fails.
 */
export async function exportAccountCalendars(
  accountId: string,
  incomingDir: string,
  onCalendar: (exported: ExportedCalendar) => void,
  signal: AbortSignal
): Promise<{ names: string[] }> {
  if (signal.aborted) throw new ExportAbortedError()
  const ses = getProtonSession(accountId)
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Hidden windows are throttled by default, which would stall Proton's app.
      backgroundThrottling: false
    }
  })
  lockNavigationToProton(win.webContents)
  // The hidden window never needs popups.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.setAudioMuted(true)

  // Cancellation (account removed, user opened the account's window, app quitting):
  // destroy the window so Proton's app stops, and fail whatever we're waiting on.
  let rejectAborted: (e: Error) => void = () => undefined
  const aborted = new Promise<never>((_, reject) => (rejectAborted = reject))
  aborted.catch(() => undefined)
  const onAbort = (): void => {
    rejectAborted(new ExportAbortedError())
    pending?.reject(new ExportAbortedError())
    pending = null
    if (!win.isDestroyed()) win.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  const step = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted])

  // Downloads triggered by this run are captured here. Anything arriving when we're
  // not waiting for a download is cancelled instead of leaking a file.
  let pending: { resolve: (path: string) => void; reject: (e: Error) => void } | null = null
  setDownloadListener(accountId, (item: DownloadItem) => {
    const waiter = pending
    if (!waiter) {
      item.cancel()
      return
    }
    const target = join(incomingDir, `incoming-${Date.now()}-${Math.random().toString(36).slice(2)}.ics`)
    item.setSavePath(target)
    item.once('done', (_e, state) => {
      if (state === 'completed') waiter.resolve(target)
      else waiter.reject(new Error(`Download ${state}`))
      if (pending === waiter) pending = null
    })
  })

  const exec = <T>(script: string): Promise<T> => step(win.webContents.executeJavaScript(script, true) as Promise<T>)

  try {
    await step(
      withTimeout(win.loadURL(PROTON_EXPORT_URL), PAGE_LOAD_TIMEOUT_MS, 'Proton did not load (check your internet connection)')
    )

    // Proton is a single-page app: wait until it has decrypted the session and rendered.
    const started = Date.now()
    for (;;) {
      if (isLoginUrl(win.webContents.getURL())) throw new LoginRequiredError()
      const state = await exec<string>(DETECT_STATE_SCRIPT).catch((e) => {
        if (e instanceof ExportAbortedError) throw e
        return 'loading'
      })
      if (state === 'login') throw new LoginRequiredError()
      if (state === 'ready') break
      if (Date.now() - started > PAGE_LOAD_TIMEOUT_MS) {
        throw describePageError(new Error('EXPORT_UI_TIMEOUT: export page'))
      }
      await step(new Promise((r) => setTimeout(r, 500)))
    }

    const rawNames = await exec<string[]>(LIST_CALENDARS_SCRIPT).catch((e) => {
      throw e instanceof ExportAbortedError ? e : describePageError(e)
    })
    const names = uniqueCalendarNames(rawNames)

    for (let i = 0; i < rawNames.length; i++) {
      const downloaded = new Promise<string>((resolve, reject) => (pending = { resolve, reject }))
      downloaded.catch(() => undefined) // handled below; avoid unhandled rejection if we bail early
      await exec(exportCalendarScript(i, rawNames[i])).catch((e) => {
        pending = null
        throw e instanceof ExportAbortedError ? e : describePageError(e)
      })
      const path = await step(withTimeout(downloaded, DOWNLOAD_TIMEOUT_MS, `Export of "${names[i]}" did not finish in time`))
      onCalendar({ name: names[i], path })
      await step(new Promise((r) => setTimeout(r, 800))) // let the modal close
    }
    return { names }
  } finally {
    signal.removeEventListener('abort', onAbort)
    pending = null
    if (!win.isDestroyed()) win.destroy()
  }
}
