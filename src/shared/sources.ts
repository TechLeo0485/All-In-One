/** Calendar source helpers shared by the main process and the renderer. */

export const AUTO_SYNC_OPTIONS = [0, 15, 30, 60, 180] as const

/** Google Calendar "Secret address in iCal format" links. */
export function isGoogleCalendarUrl(url: string): boolean {
  return hostOf(url)?.endsWith('calendar.google.com') ?? false
}

/**
 * Whether a calendar may be fetched on a timer: web links only (Google, Outlook,
 * any ICS feed). Proton is excluded on purpose: Proton calendars (account exports,
 * share links and files) only update when the user clicks refresh.
 */
export function isAutoSyncSource(calendar: { sourceUrl: string; accountId: string | null; enabled: boolean }): boolean {
  if (!calendar.enabled || calendar.accountId) return false
  const host = hostOf(calendar.sourceUrl)
  return host !== null && !host.endsWith('proton.me')
}

/** Exported .ics files are stored as file: URLs. */
export function isFileSource(url: string): boolean {
  return url.trim().toLowerCase().startsWith('file:')
}

/** Calendar apps share links as https://; webcal(s):// is accepted for convenience. */
export function normalizeFeedUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, 'https://')
}

/** Hostname of an http(s)/webcal(s) URL, or null for files and invalid URLs. */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(normalizeFeedUrl(url))
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : null
  } catch {
    return null
  }
}
