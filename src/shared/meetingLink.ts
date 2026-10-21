/**
 * Finds the video-call link of an event for the "Open meeting link" button.
 *
 * Invites mix the join link with others: scheduling tools (reschedule / cancel),
 * help pages ("Learn more about Meet"), dial-in lists, "Meeting options". So only
 * links of known meeting services count, with a path that actually joins a call.
 * Teams, Zoom and scheduling tools often hide the join link behind "Join the
 * meeting" in HTML, so link targets (href) are read too, not only visible text.
 * A link of an unknown service is only taken from the location field, which holds
 * nothing else; the description is too noisy for a guess.
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi
const HREF_RE = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

/** Meeting services: host (the domain or any subdomain of it) and, when the host has other pages too, a join path. */
const SERVICES: { host: string; path?: RegExp }[] = [
  { host: 'meet.google.com', path: /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[^/]+)/i },
  { host: 'zoom.us', path: /^\/(?:j|my|w|s|wc)\/[^/]+/i },
  { host: 'zoomgov.com', path: /^\/(?:j|my|w|s|wc)\/[^/]+/i },
  { host: 'teams.microsoft.com', path: /^\/(?:l\/meetup-join|meet)\//i },
  { host: 'teams.live.com', path: /^\/meet\//i },
  { host: 'webex.com', path: /^\/(?:meet\/|join\/|[^/]+\/j\.php|[^/]+\/m\.php|wbxmjs\/joinservice\/)/i },
  { host: 'meet.proton.me', path: /^\/.+/ },
  { host: 'gotomeeting.com', path: /^\/join\//i },
  { host: 'meet.goto.com', path: /^\/.+/ },
  { host: 'chime.aws', path: /^\/\d+/ },
  { host: 'bluejeans.com', path: /^\/\d+/ },
  { host: 'whereby.com', path: /^\/[^/]+/ },
  { host: 'meet.jit.si', path: /^\/[^/]+/ },
  { host: 'join.skype.com', path: /^\/[^/]+/ },
  { host: 'meetings.ringcentral.com', path: /^\/j\//i },
  { host: 'v.ringcentral.com', path: /^\/join\//i },
  { host: 'meet.around.co', path: /^\/[^/]+/ }
]

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`)
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** True for a join link of a known meeting service. */
export function isMeetingUrl(url: string): boolean {
  const u = parse(url)
  if (!u) return false
  const hostname = u.hostname.toLowerCase()
  return SERVICES.some((s) => hostMatches(hostname, s.host) && (!s.path || s.path.test(u.pathname)))
}

function decodeAmp(url: string): string {
  return url.replace(/&amp;/gi, '&')
}

/** Every http(s) link in the text, in order: HTML link targets and visible URLs. */
export function collectUrls(text: string): string[] {
  const urls: string[] = []
  for (const m of text.matchAll(HREF_RE)) {
    const href = decodeAmp((m[1] ?? m[2] ?? '').trim())
    if (/^https?:\/\//i.test(href)) urls.push(href)
  }
  for (const m of text.matchAll(URL_RE)) urls.push(decodeAmp(m[0]))
  return urls
}

/** The event's meeting link, or null. `description` may be HTML. */
export function findMeetingUrl(location: string, description: string): string | null {
  const locationUrls = collectUrls(location)
  const known = [...locationUrls, ...collectUrls(description)].find(isMeetingUrl)
  if (known) return known
  return locationUrls.find((url) => parse(url) !== null) ?? null
}
