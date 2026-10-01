import { normalizeFeedUrl } from '@shared/sources'

/** Helpers for displaying calendar sources (share links vs. exported .ics files). */

/** "file:///C:/Users/me/Downloads/My%20calendar.ics" -> "My calendar.ics" */
export function fileNameFromUrl(url: string): string {
  const last = url.split('/').pop() ?? url
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** Full local path for tooltips: "C:\Users\me\Downloads\My calendar.ics" */
export function filePathFromUrl(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname)
    // Windows drive paths come through as "/C:/..."
    return /^\/[a-z]:\//i.test(path) ? path.slice(1).replace(/\//g, '\\') : path
  } catch {
    return url
  }
}

/** Hides the secret token part of a share URL in the UI. */
export function maskShareUrl(url: string): string {
  try {
    const u = new URL(normalizeFeedUrl(url))
    return `${u.host}${u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname}`
  } catch {
    return url.slice(0, 40)
  }
}
