/** Calendar source helpers shared by the main process and the renderer. */

export const AUTO_SYNC_OPTIONS = [0, 15, 30, 60, 180] as const

/** Google Calendar "Secret address in iCal format" links. */
export function isGoogleCalendarUrl(url: string): boolean {
  return hostOf(url)?.endsWith('calendar.google.com') ?? false
}

/**
 * Outlook "Publish a calendar" links: outlook.live.com (personal Outlook.com /
 * Hotmail accounts) and outlook.office365.com / outlook.office.com (work or school).
 */
export function isOutlookCalendarUrl(url: string): boolean {
  const host = hostOf(url)
  return host === 'outlook.live.com' || host === 'outlook.office365.com' || host === 'outlook.office.com'
}

/**
 * Outlook shows an HTML link and an ICS link side by side when publishing; people often
 * copy the HTML one. Both share the same token, so ".../calendar.html" maps to
 * ".../calendar.ics" (also "reachcalendar.html" for work accounts).
 */
export function outlookIcsUrl(url: string): string {
  const trimmed = url.trim()
  return isOutlookCalendarUrl(trimmed) ? trimmed.replace(/calendar\.html(?=$|[?#])/i, 'calendar.ics') : trimmed
}

/**
 * Whether a calendar may be fetched on a timer: web links only (Google, Outlook,
 * any ICS feed). Proton is excluded on purpose: Proton calendars (account exports,
 * share links and files) only update when the user clicks refresh.
 */
export function isAutoSyncSource(calendar: { sourceUrl: string; accountId: string | null; enabled: boolean }): boolean {
  if (!calendar.enabled || calendar.accountId) return false
  return hostOf(calendar.sourceUrl) !== null && !isProtonCalendarUrl(calendar.sourceUrl)
}

/** Proton Calendar share links (calendar.proton.me/api/calendar/v1/url/…). */
export function isProtonCalendarUrl(url: string): boolean {
  return hostOf(url)?.endsWith('proton.me') ?? false
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
