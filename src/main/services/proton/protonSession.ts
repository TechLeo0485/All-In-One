import { app, session, shell, type DownloadItem, type Session, type WebContents } from 'electron'

/**
 * Per-account browser sessions for Proton.
 *
 * Every connected account gets its own persistent Electron partition, which works
 * like a separate browser profile: cookies/local storage are isolated, so many
 * Proton accounts can stay logged in side by side. The app never sees or stores
 * passwords; the user types them into Proton's own login page.
 */

/** Overridable only in development, to run the automation against a local mock. */
const DEV_BASE_URL = !app.isPackaged ? process.env['UC_PROTON_BASE_URL'] : undefined

export const PROTON_ACCOUNT_URL = DEV_BASE_URL ?? 'https://account.proton.me'
export const PROTON_LOGIN_URL = `${PROTON_ACCOUNT_URL}/login`
/** Proton's Calendar "Import/export" settings page (see CALENDAR_SETTINGS_ROUTE.INTEROPS in Proton's WebClients). */
export const PROTON_EXPORT_URL = `${PROTON_ACCOUNT_URL}/calendar/import-export`

const ALLOWED_HOST_SUFFIXES = ['proton.me', 'protonmail.com', 'proton.ch']

export function partitionFor(accountId: string): string {
  return `persist:proton-${accountId}`
}

export function isProtonUrl(url: string): boolean {
  try {
    const { protocol, hostname, origin } = new URL(url)
    if (DEV_BASE_URL && origin === new URL(DEV_BASE_URL).origin) return true
    return protocol === 'https:' && ALLOWED_HOST_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`))
  } catch {
    return false
  }
}

/** True when the URL is a Proton page that requires (or offers) signing in. */
export function isLoginUrl(url: string): boolean {
  try {
    return /^\/(login|switch|signup|reauth|authorize)(\/|$)/.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** Proton's signed-in app routes look like /u/<n>/... */
export function isSignedInUrl(url: string): boolean {
  try {
    return isProtonUrl(url) && /^\/u\/\d+(\/|$)/.test(new URL(url).pathname)
  } catch {
    return false
  }
}

type DownloadListener = (item: DownloadItem) => void

const configured = new Set<string>()
const downloadListeners = new Map<string, DownloadListener>()

/** Routes downloads of the account's session to `listener` (one listener per account). */
export function setDownloadListener(accountId: string, listener: DownloadListener): void {
  downloadListeners.set(accountId, listener)
}

export function getProtonSession(accountId: string): Session {
  const partition = partitionFor(accountId)
  const ses = session.fromPartition(partition)
  if (configured.has(partition)) return ses
  configured.add(partition)

  // Present as regular Chrome: some sites refuse unknown "Electron" user agents.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|All-In-One)\/\S+/gi, ''))

  // Proton's web app needs no special permissions for login/export.
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')

  ses.on('will-download', (_event, item) => {
    const listener = downloadListeners.get(accountId)
    if (listener) listener(item)
    else item.cancel()
  })
  return ses
}

/** Keeps Proton windows on Proton; anything else opens in the system browser. */
export function lockNavigationToProton(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isProtonUrl(url)) return { action: 'allow' }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Popups opened by Proton get the same restrictions (recursively).
  contents.on('did-create-window', (child) => lockNavigationToProton(child.webContents))
  contents.on('will-navigate', (event, url) => {
    if (!isProtonUrl(url)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
}

/** Logs the account out of this app by wiping its partition. */
export async function clearProtonSession(accountId: string): Promise<void> {
  const ses = getProtonSession(accountId)
  await ses.clearStorageData()
  await ses.clearCache()
  downloadListeners.delete(accountId)
}
