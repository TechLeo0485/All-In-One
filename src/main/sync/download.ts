import { setTimeout as delay } from 'node:timers/promises'
import { net, session, type Session } from 'electron'

/** Give up when nothing arrives for this long (slow VPNs still finish as long as data flows). */
const IDLE_TIMEOUT_MS = 30_000
/** Hard cap on one download, however slowly data trickles in. */
const TOTAL_TIMEOUT_MS = 120_000
const MAX_REDIRECTS = 5
const RETRY_DELAY_MS = 5_000
/**
 * Connection failures worth one more try: typical of an unstable link or VPN, and
 * raised before the server answered, so the retry is not a second request it served.
 */
const RETRYABLE = new Set([
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  'ERR_NETWORK_CHANGED',
  'ERR_TIMED_OUT',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_SSL_PROTOCOL_ERROR'
])

/** HTTP 429 (or 503 with Retry-After): the server wants us to slow down. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super('Rate limited')
  }
}

/** A failure below HTTP (DNS, connection, proxy, TLS), with a user-facing message. */
export class NetworkError extends Error {
  constructor(
    readonly code: string,
    /** True if it failed before any response arrived (safe to retry). */
    readonly beforeResponse: boolean
  ) {
    super(describeNetworkError(code))
    this.name = 'NetworkError'
  }
}

export interface DownloadOptions {
  headers: Record<string, string>
  maxBytes: number
}

/**
 * Downloads a URL as UTF-8 text through Chromium's network stack, so the Windows
 * proxy settings (VPN proxy modes, company proxies) and system certificates apply,
 * which Node's own fetch ignores. A connection dropped before the server answered
 * is retried once.
 *
 * Redirects are followed by hand: at most MAX_REDIRECTS, and never from https to
 * plain http, which would send a link's secret token unencrypted.
 */
export async function downloadText(url: string, options: DownloadOptions): Promise<string> {
  try {
    return await attempt(url, options)
  } catch (err) {
    if (!(err instanceof NetworkError) || !err.beforeResponse || !RETRYABLE.has(err.code)) throw err
    console.warn(`[sync] ${err.code}, retrying once`)
    await delay(RETRY_DELAY_MS)
    return attempt(url, options)
  }
}

let feedSession: Session | null = null

/** In-memory session without the window's cookies or cache; uses the system proxy. */
function syncSession(): Session {
  feedSession ??= session.fromPartition('feed-downloads')
  return feedSession
}

function attempt(url: string, { headers, maxBytes }: DownloadOptions): Promise<string> {
  const tooLarge = `The calendar is too large to download (over ${Math.round(maxBytes / 1024 / 1024)} MB)`
  return new Promise((resolve, reject) => {
    let current = new URL(url)
    let redirects = 0
    let gotResponse = false
    let done = false

    const request = net.request({
      url: current.href,
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      session: syncSession()
    })
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value)

    const finish = (err: Error | null, text = ''): void => {
      if (done) return
      done = true
      clearTimeout(idleTimer)
      clearTimeout(totalTimer)
      if (err) {
        request.abort()
        reject(err)
      } else {
        resolve(text)
      }
    }
    const timedOut = (): void => finish(new NetworkError('ERR_TIMED_OUT', !gotResponse))
    let idleTimer = setTimeout(timedOut, IDLE_TIMEOUT_MS)
    const totalTimer = setTimeout(timedOut, TOTAL_TIMEOUT_MS)
    const stillAlive = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(timedOut, IDLE_TIMEOUT_MS)
    }

    request.on('redirect', (_status, _method, redirectUrl) => {
      stillAlive()
      if (++redirects > MAX_REDIRECTS) return finish(new Error('The server redirected too many times'))
      const next = new URL(redirectUrl, current)
      const allowed = next.protocol === 'https:' || (next.protocol === 'http:' && current.protocol === 'http:')
      if (!allowed) return finish(new Error('The server redirected to an insecure address, so it was not followed'))
      current = next
      request.followRedirect()
    })

    request.on('response', (response) => {
      gotResponse = true
      stillAlive()
      const header = (name: string): string | null => {
        const value = response.headers[name]
        return (Array.isArray(value) ? value[0] : value) ?? null
      }
      const status = response.statusCode
      const retryAfter = header('retry-after')
      if (status === 429 || (status === 503 && retryAfter)) return finish(new RateLimitedError(parseRetryAfter(retryAfter)))
      if (status < 200 || status >= 300) {
        return finish(new Error(`Server responded with HTTP ${status} ${response.statusMessage ?? ''}`.trim()))
      }
      if (Number(header('content-length')) > maxBytes) return finish(new Error(tooLarge))

      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        stillAlive()
        size += chunk.length
        if (size > maxBytes) return finish(new Error(tooLarge))
        chunks.push(chunk)
      })
      // TextDecoder drops a leading BOM.
      response.on('end', () => finish(null, new TextDecoder().decode(Buffer.concat(chunks))))
      response.on('error', () => finish(new NetworkError('ERR_CONNECTION_CLOSED', false)))
      response.on('aborted', () => finish(new NetworkError('ERR_CONNECTION_CLOSED', false)))
    })

    request.on('error', (err) => {
      const code = /net::(ERR_[A-Z0-9_]+)/.exec(err.message)?.[1]
      finish(code ? new NetworkError(code, !gotResponse) : err)
    })
    request.end()
  })
}

/** Retry-After is either delay-seconds or an HTTP date. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

function describeNetworkError(code: string): string {
  switch (code) {
    case 'ERR_INTERNET_DISCONNECTED':
      return 'No internet connection'
    case 'ERR_NAME_NOT_RESOLVED':
    case 'ERR_NAME_RESOLUTION_FAILED':
      return "Couldn't find the server. Check your internet connection, or your VPN if you use one"
    case 'ERR_TIMED_OUT':
    case 'ERR_CONNECTION_TIMED_OUT':
      return 'Request timed out. If you use a VPN, check that it is connected, or try another server'
    case 'ERR_CONNECTION_RESET':
    case 'ERR_CONNECTION_CLOSED':
    case 'ERR_CONNECTION_ABORTED':
    case 'ERR_CONNECTION_REFUSED':
    case 'ERR_EMPTY_RESPONSE':
    case 'ERR_NETWORK_CHANGED':
      return 'The connection was interrupted. If you use a VPN, try another server'
  }
  if (code.startsWith('ERR_PROXY') || code === 'ERR_TUNNEL_CONNECTION_FAILED') {
    return "Couldn't connect through your proxy or VPN. Check that it is running"
  }
  if (code.startsWith('ERR_CERT') || code.startsWith('ERR_SSL')) {
    return 'Secure connection failed. A VPN, firewall or antivirus program may be interfering'
  }
  return `Network error (${code})`
}
