import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { BrowserWindow, net, Notification, powerMonitor, safeStorage } from 'electron'
import { IPC } from '@shared/ipcChannels'
import { hostOf, isFileSource, isTeamworkSource } from '@shared/sources'
import type { CalendarSource, ConnectionCalendar, ConnectionStatus, ConnectionSyncResult, ConnectionsStatus } from '@shared/types'
import { accountRepository } from '../../database/accountRepository'
import { calendarRepository } from '../../database/calendarRepository'
import { settingsRepository } from '../../database/settingsRepository'
import { syncService } from '../../sync/syncService'
import { protonAccountService } from '../proton/protonAccountService'
import { createNotification } from '../windowsIdentity'

/**
 * Calendar connections: sends some of this app's calendars to any platform that
 * speaks the calendar connection protocol. A platform gives the user an address
 * and an API key; with those, this app
 *
 *   PUT    <address>/catalog              says which calendars it has, grouped by
 *                                         Proton account, and learns which of them
 *                                         the platform wants
 *   PUT    <address>/calendars/<id>       sends one wanted calendar as .ics
 *   GET    <address>/requests             listens (server-sent events) for "sync":
 *                                         someone on the platform wants a fresh copy
 *
 * with the headers X-API-Key, X-Client-Id (this install's own id: an address is
 * paired with the one app that first uses it) and X-Client-Name. Nothing here
 * knows which platform is on the other end; any number can be connected at once.
 *
 * Calendars stay in this app as before: links, Proton logins and files never
 * leave this computer. Only the events of a calendar a platform wants are sent
 * to it, every time that calendar syncs with something changed.
 *
 * Nothing is sent that does not need to be. No connection: no request at all,
 * ever. Connected: a request only when a wanted calendar synced with changed
 * content, when the list of calendars changed, or when the user asks (Check
 * what's wanted, Sync & send). There is no timer and no polling.
 *
 * When it sends:
 *   1. a wanted calendar synced here and is not what the platform has;
 *   2. the platform asked for a fresh copy (see below), which syncs it first.
 * Only the newest copy of a calendar ever waits: one that syncs again while an
 * older copy is still going out replaces whatever was queued behind it. A send
 * that fails because the network or the platform is down is kept (the newest
 * only) and tried again - with a growing wait, and at once when the computer
 * is back online or wakes up. Checking for "online" asks the operating system,
 * not the network.
 *
 * A connection ended on one side ends on the other. Ended on the platform, it
 * is dropped here as soon as the platform says so - over the live connection
 * ("disconnected"), or by answering a request 410 (this app was disconnected),
 * 404 (the address is gone) or 401 (the key no longer works) - and the user is
 * told. Disconnected here, the platform is told (DELETE <address>/pairing);
 * when the network is down, that is retried until it gets through.
 *
 * Listening for sync requests is one idle connection per platform, held only
 * while that platform is connected and only while its "Let it ask for a sync"
 * switch is on; the platform sends a few bytes every half minute to keep it
 * open. A platform that has no such stream is not asked again until restart.
 *
 * API keys are kept encrypted with the operating system's key store (Electron
 * safeStorage); they never reach the renderer.
 */

const CONNECTIONS_KEY = 'connections.list'
const KEYS_KEY = 'connections.keys'
/** This install's own id, the same for every platform. */
const CLIENT_ID_KEY = 'connections.clientId'
/** What was sent last: connection id → calendar id → what. An unchanged calendar isn't sent again. */
const SENT_KEY = 'connections.sent'
/** Connections the platform ended, to tell the user on the page until they dismiss it. */
const ENDED_KEY = 'connections.ended'
/** Disconnected here while the platform could not be told: told when the network allows. */
const RELEASES_KEY = 'connections.releases'
/** Answers that mean the platform no longer has this connection for this app. */
const ENDED_STATUSES = new Set([401, 404, 410])
const REQUEST_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 5 * 60_000
/** Largest calendar file sent. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** A platform may ask for a pause between changes to one calendar; wait at most this long, once. */
const MAX_RETRY_WAIT_MS = 40_000
/** Calendars sync in bursts; what this app has is told once they settle. */
const CATALOG_DEBOUNCE_MS = 3_000
const MAX_CONNECTIONS = 10
/** The live connection: how long to wait before trying again after it drops. */
const LIVE_RETRY_MIN_MS = 5_000
const LIVE_RETRY_MAX_MS = 5 * 60_000
/** A request for calendars synced this recently is already answered. */
const REQUEST_REPEAT_MS = 60_000
/** A send that failed for the network: first retry after this, doubling, up to the longest. */
const RETRY_MIN_MS = 30_000
const RETRY_MAX_MS = 10 * 60_000
/** A sync a platform asked for that failed here: tried again this many times at most. */
const REQUEST_RETRIES = 6
/** While something waits for the network: how often the operating system is asked whether it is back. */
const ONLINE_CHECK_MS = 3_000

interface Connection {
  id: string
  /** What the user calls it; the platform's host by default. */
  name: string
  address: string
  /** The account on the platform the key belongs to, when the platform says. */
  account: string
  lastCheckedAt: string | null
  lastError: string | null
  /** What the platform wants, as it last said: calendar id → what it is for there (a profile's name). */
  wanted: Record<string, string>
  /** Fingerprint of the list of calendars last told: the same list isn't told again. */
  catalogHash: string | null
  /** Listen for the platform asking for a fresh copy. On unless switched off. */
  listen?: boolean
}

interface Sent {
  hash: string | null
  at: string | null
  eventCount: number | null
  error: string | null
}

/** One calendar as the platform describes it back. */
interface ServerCalendar {
  calendar_id: string
  wanted: boolean
  profile?: string | null
}

/** One copy of a calendar on its way to one platform. */
interface Outgoing {
  id: string
  calendar: CalendarSource
  ics: string
  /** Sends of this copy that failed for the network. */
  tries: number
}

/** Disconnected here; the platform still has to be told. The key is encrypted as the others. */
interface PendingRelease {
  address: string
  key: string
  tries: number
}

class ConnectionError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retryAfter = 0
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/** A fingerprint of what the calendar says, not of when it was written out. */
function fingerprint(ics: string): string {
  return createHash('sha256').update(ics.replace(/^DTSTAMP[^\r\n]*\r?\n/gm, '')).digest('hex')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A connection the platform ended, as the page tells the user. */
interface EndedNotice {
  name: string
  reason: string
  at: string
}

/** Why the platform no longer has this connection, from its answer. */
function endedReason(status: number, detail: string): string {
  if (status === 410) return detail || 'This app was disconnected on the platform.'
  if (status === 404) return 'The connection was removed on the platform, or given a new address.'
  return 'The platform no longer accepts the API key: it was revoked or deleted there.'
}

/**
 * Why a request got no answer at all, in words that say what to do: Node's
 * fetch only says "fetch failed" and keeps the reason in `cause`.
 */
function unreachable(err: unknown, address: string): string {
  const cause = (err as {
    cause?: { code?: string; message?: string; cert?: { subjectaltname?: string; subject?: { CN?: string } } }
  } | null)?.cause
  const code = cause?.code ?? (err as { name?: string } | null)?.name ?? ''
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    // The certificate comes with the error: its names ("DNS:app.example.com, ..."),
    // else its common name. (The message lists only the kind matched: for an IP
    // address, the certificate's IP entries - usually none.)
    const name = /DNS:([^\s,]+)/.exec(cause?.cert?.subjectaltname ?? '')?.[1] ?? cause?.cert?.subject?.CN
    return name
      ? `The platform's certificate is for ${name}, not for ${hostOf(address) ?? 'this address'}. Use ${name} in the address instead.`
      : "The platform's certificate is not for this address. Use the name the platform is reached by, not its IP address."
  }
  if (code === 'CERT_HAS_EXPIRED') return "The platform's certificate has expired. Ask whoever runs it to renew it."
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) {
    return "The platform's certificate is not trusted (self-signed or incomplete). It needs a certificate from a known authority."
  }
  if (code === 'ERR_SSL_WRONG_VERSION_NUMBER' || code === 'EPROTO') {
    return 'The platform does not answer https on this port. Check whether the address should start with http://.'
  }
  if (code === 'ECONNREFUSED') return 'Nothing answered on that port: the platform is not running there, or the port is wrong.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'That name was not found. Check the address, and the internet connection.'
  if (code === 'TimeoutError' || code === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'The platform did not answer in time. Check the address and the internet connection.'
  }
  return `The platform could not be reached${code ? ` (${code})` : ''}. Check the address and the internet connection.`
}

class ConnectionService {
  /** The send under way per connection and calendar; whoever waits for a calendar to go waits on this. */
  private uploads = new Map<string, Promise<void>>()
  /** What waits to go, per connection and calendar: the newest copy only. */
  private waiting = new Map<string, Outgoing>()
  /** Slots with a send under way. */
  private sending = new Set<string>()
  /** Copies that could not be sent for the network or the platform being down: the newest only, tried again. */
  private unsent = new Map<string, Outgoing>()
  private retryTimer: NodeJS.Timeout | null = null
  /** Asks the operating system whether the network is back, only while something waits for it. */
  private onlineWatch: NodeJS.Timeout | null = null
  private wasOnline = true
  /** Syncs a platform asked for that failed here, per connection: tried again later. */
  private requestRetries = new Map<string, { calendarIds: Set<string>; tries: number; timer: NodeJS.Timeout }>()
  private catalogTimer: NodeJS.Timeout | null = null
  /** The live connections: connection id → the way to end it. */
  private live = new Map<string, AbortController>()
  /** Whether each live connection is up right now, for the page. */
  private listening = new Set<string>()
  /** When a calendar was last synced because a platform asked. */
  private requestedAt = new Map<string, number>()

  constructor() {
    // Every successful sync of a calendar goes to the platforms that want it.
    syncService.onCalendarSynced((calendar, ics) => {
      const connections = this.list()
      if (connections.length === 0) return
      let unknown = false
      for (const connection of connections) {
        if (connection.wanted[calendar.id]) void this.upload(connection.id, calendar, ics)
        else unknown = true
      }
      // Perhaps a calendar a platform has not heard of yet (a new Proton calendar).
      if (unknown) this.scheduleCatalogs()
    })
  }

  // ---------------------------------------------------------------------------
  // Stored state

  private all(): Record<string, Connection> {
    return settingsRepository.getInternal<Record<string, Connection> | null>(CONNECTIONS_KEY, null) ?? {}
  }

  private list(): Connection[] {
    return Object.values(this.all())
  }

  private get(id: string): Connection {
    const connection = this.all()[id]
    if (!connection) throw new ConnectionError('This connection is gone')
    return connection
  }

  private save(id: string, patch: Partial<Connection> | null): void {
    const all = this.all()
    if (patch === null) delete all[id]
    else if (all[id]) all[id] = { ...all[id], ...patch }
    settingsRepository.setInternal(CONNECTIONS_KEY, all)
  }

  private keys(): Record<string, string> {
    return settingsRepository.getInternal<Record<string, string> | null>(KEYS_KEY, null) ?? {}
  }

  private key(id: string): string | null {
    const stored = this.keys()[id]
    if (!stored) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  private saveKey(id: string, key: string | null): void {
    if (key && !safeStorage.isEncryptionAvailable()) {
      throw new ConnectionError('This computer cannot store the API key securely, so it was not saved.')
    }
    const keys = this.keys()
    if (key) keys[id] = safeStorage.encryptString(key).toString('base64')
    else delete keys[id]
    settingsRepository.setInternal(KEYS_KEY, keys)
  }

  private clientId(): string {
    let id = settingsRepository.getInternal<string | null>(CLIENT_ID_KEY, null)
    if (!id) {
      id = `all-in-one-${randomUUID()}`
      settingsRepository.setInternal(CLIENT_ID_KEY, id)
    }
    return id
  }

  private clientName(): string {
    return `All-In-One on ${hostname()}`.slice(0, 80)
  }

  private sentOf(id: string): Record<string, Sent> {
    return (settingsRepository.getInternal<Record<string, Record<string, Sent>> | null>(SENT_KEY, null) ?? {})[id] ?? {}
  }

  private saveSent(id: string, calendarId: string | null, sent: Sent | null): void {
    const all = settingsRepository.getInternal<Record<string, Record<string, Sent>> | null>(SENT_KEY, null) ?? {}
    if (calendarId === null) delete all[id]
    else {
      const mine = all[id] ?? {}
      if (sent) mine[calendarId] = sent
      else delete mine[calendarId]
      all[id] = mine
    }
    settingsRepository.setInternal(SENT_KEY, all)
  }

  private changed(): void {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.connectionsChanged)
  }

  // ---------------------------------------------------------------------------
  // Talking to a platform

  private async request<T>(
    address: string,
    key: string,
    path: string,
    init: { method?: string; json?: unknown; ics?: string; timeoutMs?: number; pairNew?: boolean } = {}
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${address}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'X-API-Key': key,
          'X-Client-Id': this.clientId(),
          'X-Client-Name': this.clientName(),
          // The user is connecting this app now: pair it, even if the
          // platform disconnected it before.
          ...(init.pairNew ? { 'X-Pair': 'new' } : {}),
          Accept: 'application/json',
          ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.ics !== undefined ? { 'Content-Type': 'text/calendar; charset=utf-8' } : {})
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.ics,
        signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS)
      })
    } catch (err) {
      throw new ConnectionError(unreachable(err, address))
    }
    if (!response.ok) {
      let detail = ''
      try {
        const body = (await response.json()) as { detail?: unknown; message?: unknown }
        if (typeof body.detail === 'string') detail = body.detail
        else if (typeof body.message === 'string') detail = body.message
      } catch {
        // not JSON: the status says enough
      }
      if (response.status === 401) detail ||= 'The platform refused the API key. Make a new one there.'
      if (response.status === 404) detail ||= 'The platform has no connection at this address. It may have been replaced or removed.'
      throw new ConnectionError(
        detail || `The platform answered ${response.status}`,
        response.status,
        Number(response.headers.get('Retry-After')) || 0
      )
    }
    try {
      return (await response.json()) as T
    } catch {
      throw new ConnectionError('The address answered, but not as a calendar connection. Check that it was copied in full.')
    }
  }

  /** This app's calendars that can go to a platform: not Teamwork's own, not ones that come from that platform. */
  private shareable(address: string): CalendarSource[] {
    const host = hostOf(address)
    return calendarRepository
      .list()
      .filter((c) => c.enabled && !isTeamworkSource(c.sourceUrl) && !(host && hostOf(c.sourceUrl) === host))
  }

  /** The Proton account a calendar belongs to, as platforms show it; the rest stand together. */
  private groupOf(calendar: CalendarSource): { id: string; name: string } {
    if (calendar.accountId) {
      const account = accountRepository.get(calendar.accountId)
      return { id: `proton-${calendar.accountId}`, name: account?.email || account?.label || 'Proton account' }
    }
    if (isFileSource(calendar.sourceUrl)) return { id: 'files', name: 'Files' }
    return { id: 'links', name: 'Calendar links' }
  }

  private catalogOf(address: string): { id: string; name: string; group_id: string; group_name: string }[] {
    return this.shareable(address).map((c) => {
      const group = this.groupOf(c)
      return { id: c.id, name: c.name.slice(0, 200) || 'Calendar', group_id: group.id, group_name: group.name }
    })
  }

  private catalogHash(address: string): string {
    return createHash('sha256').update(JSON.stringify(this.catalogOf(address))).digest('hex')
  }

  /** Tells a platform what this app has; answers what it wants and whose account the key is. */
  private async tellCatalog(
    address: string,
    key: string,
    pairNew = false
  ): Promise<{ wanted: Record<string, string>; account: string }> {
    const info = await this.request<{ account?: { username?: string }; calendars?: ServerCalendar[] }>(address, key, '/catalog', {
      method: 'PUT',
      json: { calendars: this.catalogOf(address) },
      pairNew
    })
    if (!Array.isArray(info.calendars)) {
      throw new ConnectionError('The address answered, but not as a calendar connection. Check that it was copied in full.')
    }
    const wanted: Record<string, string> = {}
    for (const c of info.calendars) if (c.wanted) wanted[c.calendar_id] = c.profile || 'Wanted'
    return { wanted, account: info.account?.username ?? '' }
  }

  private async sendCatalog(id: string): Promise<void> {
    const connection = this.get(id)
    const key = this.key(id)
    if (!key) throw new ConnectionError('The API key for this connection is missing. Remove the connection and add it again.')
    let told: { wanted: Record<string, string>; account: string }
    try {
      told = await this.tellCatalog(connection.address, key)
    } catch (err) {
      this.endIfGone(id, err)
      throw err
    }
    const { wanted, account } = told
    // A calendar no longer wanted starts fresh if it is wanted again.
    for (const calendarId of Object.keys(this.sentOf(id))) if (!wanted[calendarId]) this.saveSent(id, calendarId, null)
    this.save(id, {
      wanted,
      account: account || connection.account,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      catalogHash: this.catalogHash(connection.address)
    })
  }

  /**
   * After a sync of a calendar some platform does not want: tells each platform
   * what this app has, but only where that changed (a new, renamed or removed
   * calendar). The same list is never sent twice, so syncing calendars nobody
   * wants costs no request at all.
   */
  private scheduleCatalogs(): void {
    if (this.catalogTimer) clearTimeout(this.catalogTimer)
    this.catalogTimer = setTimeout(() => {
      this.catalogTimer = null
      const stale = this.list().filter((c) => c.catalogHash !== this.catalogHash(c.address))
      if (stale.length === 0) return
      void Promise.all(
        stale.map((c) => this.sendCatalog(c.id).catch((err) => this.save(c.id, { lastError: errorText(err) })))
      ).finally(() => this.changed())
    }, CATALOG_DEBOUNCE_MS)
  }

  /**
   * After a calendar synced: queues it for one platform. Only the newest copy
   * waits - this one replaces an older one that has not left yet, and one that
   * was waiting for the network.
   */
  private upload(id: string, calendar: CalendarSource, ics: string, tries = 0): Promise<void> {
    const slot = `${id}:${calendar.id}`
    this.waiting.set(slot, { id, calendar, ics, tries })
    this.unsent.delete(slot)
    if (!this.sending.has(slot)) this.uploads.set(slot, this.drain(slot))
    return this.uploads.get(slot) ?? Promise.resolve()
  }

  /** Sends what waits for one slot, one copy at a time, until nothing newer has arrived. */
  private async drain(slot: string): Promise<void> {
    this.sending.add(slot)
    try {
      for (;;) {
        const next = this.waiting.get(slot)
        if (!next) break
        this.waiting.delete(slot)
        await this.send(slot, next).catch(() => undefined)
      }
    } finally {
      this.sending.delete(slot)
    }
  }

  /** Sends one copy, unless it is what the platform already has. */
  private async send(slot: string, out: Outgoing): Promise<void> {
    const { id, calendar, ics } = out
    const connection = this.all()[id]
    const key = this.key(id)
    if (!connection || !key || !connection.wanted[calendar.id]) return
    const before = this.sentOf(id)[calendar.id]
    const hash = fingerprint(ics)
    // Nothing changed since the last successful send: no request at all.
    if (before?.hash === hash && !before.error) return
    const put = (): Promise<{ status?: string; event_count?: number }> =>
      this.request(
        connection.address,
        key,
        `/calendars/${encodeURIComponent(calendar.id)}?name=${encodeURIComponent(calendar.name.slice(0, 80))}`,
        { method: 'PUT', ics, timeoutMs: UPLOAD_TIMEOUT_MS }
      )
    try {
      if (Buffer.byteLength(ics, 'utf8') > MAX_UPLOAD_BYTES) throw new ConnectionError('This calendar is too large to send (8 MB at most)', 413)
      let result: { status?: string; event_count?: number }
      try {
        result = await put()
      } catch (err) {
        // The platform asks for a pause after a change: wait as long as it says, once.
        if (!(err instanceof ConnectionError && err.status === 429)) throw err
        await new Promise((resolve) => setTimeout(resolve, Math.min((err.retryAfter || 30) * 1000 + 500, MAX_RETRY_WAIT_MS)))
        result = await put()
      }
      if (result.status === 'unassigned') {
        // It was let go on the platform since the platform was last asked.
        const wanted = { ...connection.wanted }
        delete wanted[calendar.id]
        this.save(id, { wanted })
        this.saveSent(id, calendar.id, null)
      } else {
        this.saveSent(id, calendar.id, {
          hash,
          at: new Date().toISOString(),
          eventCount: result.event_count ?? before?.eventCount ?? null,
          error: null
        })
      }
    } catch (err) {
      if (this.endIfGone(id, err)) return
      // The network or the platform is down (unreachable, 5xx, still busy): this
      // copy is kept and tried again, unless a newer one is already waiting.
      const down = !(err instanceof ConnectionError) || err.status === 0 || err.status === 429 || err.status >= 500
      this.saveSent(id, calendar.id, {
        hash: null,
        at: before?.at ?? null,
        eventCount: before?.eventCount ?? null,
        error: down ? `${errorText(err)} It will be sent as soon as it can be.` : errorText(err)
      })
      if (down && !this.waiting.has(slot)) {
        this.unsent.set(slot, { ...out, tries: out.tries + 1 })
        this.scheduleRetry()
      }
    }
    this.changed()
  }

  /** Tries unsent copies again after a wait that doubles with each failure, and watches for the network coming back. */
  private scheduleRetry(): void {
    if (this.unsent.size === 0) return
    if (!this.retryTimer) {
      const tries = Math.min(...[...this.unsent.values()].map((o) => o.tries))
      const delay = Math.min(RETRY_MIN_MS * 2 ** Math.max(tries - 1, 0), RETRY_MAX_MS)
      this.retryTimer = setTimeout(() => this.retryUnsent(), delay)
    }
    this.watchOnline()
  }

  /** Sends every unsent copy now (the wait is over, or the network is back). */
  private retryUnsent(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const again = [...this.unsent.values()]
    this.unsent.clear()
    for (const out of again) {
      const slot = `${out.id}:${out.calendar.id}`
      // A newer copy came in meanwhile: that one goes, not this.
      if (!this.waiting.has(slot)) void this.upload(out.id, out.calendar, out.ics, out.tries)
    }
  }

  /**
   * While something waits for the network - an unsent copy, a requested sync
   * that failed, a live connection that dropped - asks the operating system
   * every few seconds whether it is online (no request is made). The moment
   * it comes back: unsent copies go, and the live connections reconnect.
   * With nothing waiting, this stops.
   */
  private watchOnline(): void {
    if (this.onlineWatch) return
    this.wasOnline = net.isOnline()
    this.onlineWatch = setInterval(() => {
      const online = net.isOnline()
      const back = online && !this.wasOnline
      this.wasOnline = online
      if (back) this.networkBack()
      const liveDown = [...this.live.keys()].some((id) => !this.listening.has(id))
      if (this.unsent.size === 0 && this.requestRetries.size === 0 && !liveDown && !this.releaseTimer) {
        if (this.onlineWatch) clearInterval(this.onlineWatch)
        this.onlineWatch = null
      }
    }, ONLINE_CHECK_MS)
  }

  /** The network is back, or the computer woke up: do at once what was waiting for it. */
  private networkBack(): void {
    if (this.unsent.size > 0) this.retryUnsent()
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
    void this.sendReleases()
    for (const [id, retry] of [...this.requestRetries]) {
      clearTimeout(retry.timer)
      this.requestRetries.delete(id)
      void this.syncRequested(id, [...retry.calendarIds], retry.tries)
    }
    // Live connections that were waiting to retry start over now.
    for (const id of [...this.live.keys()]) {
      if (!this.listening.has(id)) {
        this.stopLive(id)
        this.startLive(id)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sync requests: a platform asks for a fresh copy over a live connection

  /** Starts listening on every connection that wants it. Called once the app is up. */
  start(): void {
    for (const connection of this.list()) this.startLive(connection.id)
    // Waking from sleep: connections dropped while asleep, and sends may be waiting.
    powerMonitor.on('resume', () => this.networkBack())
    // Disconnects made while a platform could not be told: tell it now.
    void this.sendReleases()
  }

  /** Ends every live connection (the app is quitting). */
  stop(): void {
    for (const id of [...this.live.keys()]) this.stopLive(id)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.onlineWatch) clearInterval(this.onlineWatch)
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    for (const retry of this.requestRetries.values()) clearTimeout(retry.timer)
    this.retryTimer = this.onlineWatch = null
    this.requestRetries.clear()
  }

  private startLive(id: string): void {
    const connection = this.all()[id]
    if (!connection || connection.listen === false || this.live.has(id) || !this.key(id)) return
    const controller = new AbortController()
    this.live.set(id, controller)
    void this.runLive(id, controller.signal).finally(() => {
      if (this.live.get(id) === controller) this.live.delete(id)
      if (this.listening.delete(id)) this.changed()
    })
  }

  private stopLive(id: string): void {
    this.live.get(id)?.abort()
    this.live.delete(id)
    if (this.listening.delete(id)) this.changed()
  }

  private async runLive(id: string, signal: AbortSignal): Promise<void> {
    let delay = LIVE_RETRY_MIN_MS
    while (!signal.aborted) {
      const connection = this.all()[id]
      const key = this.key(id)
      if (!connection || !key || connection.listen === false) return
      try {
        const response = await fetch(`${connection.address}/requests`, {
          headers: {
            'X-API-Key': key,
            'X-Client-Id': this.clientId(),
            'X-Client-Name': this.clientName(),
            Accept: 'text/event-stream'
          },
          signal
        })
        // No such stream on this platform, or the key or address no longer works:
        // nothing to gain from asking again. (Check what's wanted reports the reason.)
        // Ended on the platform: drop it here too.
        if (ENDED_STATUSES.has(response.status)) {
          let detail = ''
          try {
            const body = (await response.json()) as { detail?: unknown }
            if (typeof body.detail === 'string') detail = body.detail
          } catch {
            // the status says enough
          }
          this.endedByPlatform(id, endedReason(response.status, detail))
          return
        }
        // No such stream on this platform, or another app holds the address:
        // nothing to gain from asking again. (Check what's wanted reports the reason.)
        if ([403, 405, 409, 501].includes(response.status)) return
        if (!response.ok || !response.body) throw new Error(`The platform answered ${response.status}`)
        delay = LIVE_RETRY_MIN_MS
        this.listening.add(id)
        this.changed()
        // The platform is reachable again: what could not be sent goes now.
        if (this.unsent.size > 0) this.retryUnsent()
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          let end: number
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            this.onLiveMessage(id, buffer.slice(0, end))
            buffer = buffer.slice(end + 2)
          }
        }
      } catch {
        // dropped or unreachable: try again below, more slowly each time
      }
      if (this.listening.delete(id)) this.changed()
      if (signal.aborted) return
      // Down: wait, but the moment the network is back this starts over (networkBack).
      this.watchOnline()
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, LIVE_RETRY_MAX_MS)
    }
  }

  /** One server-sent event: `event:` and `data:` lines. Lines starting with ":" are keep-alives. */
  private onLiveMessage(id: string, block: string): void {
    let event = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (event === 'disconnected') {
      let reason = 'The connection was ended on the platform.'
      try {
        const said = (JSON.parse(data) as { reason?: unknown }).reason
        if (typeof said === 'string' && said) reason = said.endsWith('.') ? said : `${said}.`
      } catch {
        // keep the general reason
      }
      this.endedByPlatform(id, reason)
      return
    }
    if (event !== 'sync') return
    let calendarIds: unknown
    try {
      calendarIds = (JSON.parse(data) as { calendar_ids?: unknown }).calendar_ids
    } catch {
      return
    }
    if (!Array.isArray(calendarIds)) return
    void this.syncRequested(id, calendarIds.filter((c): c is string => typeof c === 'string'))
  }

  /**
   * The platform asked for these calendars: sync the ones it really gets; each
   * is sent as it arrives. Asked again for a calendar within a minute, the
   * first sync answers both. One that fails to sync here (the network, Proton)
   * is tried again later, a few times, and at once when the network is back.
   */
  private async syncRequested(id: string, calendarIds: string[], tries = 0): Promise<void> {
    const connection = this.all()[id]
    if (!connection) return
    const now = Date.now()
    const calendars = this.shareable(connection.address).filter(
      (c) =>
        calendarIds.includes(c.id) &&
        connection.wanted[c.id] &&
        (tries > 0 || now - (this.requestedAt.get(c.id) ?? 0) > REQUEST_REPEAT_MS)
    )
    if (calendars.length === 0) return
    for (const c of calendars) this.requestedAt.set(c.id, now)
    const accounts = [...new Set(calendars.map((c) => c.accountId).filter((a): a is string => Boolean(a)))]
    const others = calendars.filter((c) => !c.accountId)
    await Promise.all([
      ...accounts.map((a) => protonAccountService.sync(a).catch(() => undefined)),
      ...others.map((c) => syncService.syncOne(c.id, { force: true }).catch(() => undefined))
    ])
    const failed = calendars.filter((c) => calendarRepository.get(c.id)?.lastSyncError).map((c) => c.id)
    if (failed.length === 0 || tries >= REQUEST_RETRIES) return
    // One retry per connection: a later failure joins the one already waiting.
    const waiting = this.requestRetries.get(id)
    if (waiting) clearTimeout(waiting.timer)
    const ids = new Set([...(waiting?.calendarIds ?? []), ...failed])
    const timer = setTimeout(() => {
      this.requestRetries.delete(id)
      void this.syncRequested(id, [...ids], tries + 1)
    }, Math.min(RETRY_MIN_MS * 2 ** tries, RETRY_MAX_MS))
    this.requestRetries.set(id, { calendarIds: ids, tries: tries + 1, timer })
    this.watchOnline()
  }

  /** Whether the platform may ask this app for a fresh copy. Off ends the live connection at once. */
  setListen(id: string, on: boolean): ConnectionsStatus {
    this.get(id)
    this.save(id, { listen: on })
    if (on) this.startLive(id)
    else this.stopLive(id)
    this.changed()
    return this.status()
  }

  // ---------------------------------------------------------------------------
  // For the renderer

  private statusOf(connection: Connection): ConnectionStatus {
    const sent = this.sentOf(connection.id)
    const groups = new Map<string, { id: string; name: string; calendars: ConnectionCalendar[] }>()
    for (const calendar of this.shareable(connection.address)) {
      const group = this.groupOf(calendar)
      const entry = groups.get(group.id) ?? { ...group, calendars: [] }
      const last = sent[calendar.id]
      entry.calendars.push({
        id: calendar.id,
        name: calendar.name,
        color: calendar.color,
        wantedFor: connection.wanted[calendar.id] ?? null,
        lastSentAt: last?.at ?? null,
        eventCount: last?.eventCount ?? null,
        error: last?.error ?? null
      })
      groups.set(group.id, entry)
    }
    return {
      id: connection.id,
      name: connection.name,
      host: hostOf(connection.address) ?? connection.address,
      account: connection.account,
      lastCheckedAt: connection.lastCheckedAt,
      lastError: connection.lastError,
      listen: connection.listen !== false,
      listening: this.listening.has(connection.id),
      groups: [...groups.values()]
    }
  }

  status(): ConnectionsStatus {
    return {
      clientName: this.clientName(),
      connections: this.list().map((c) => this.statusOf(c)),
      ended: settingsRepository.getInternal<EndedNotice[] | null>(ENDED_KEY, null) ?? []
    }
  }

  /** Pairs this app with a platform's connection address, using an API key made there. */
  async connect(rawAddress: string, rawKey: string, rawName: string): Promise<ConnectionsStatus> {
    const address = rawAddress.trim().replace(/\/+$/, '')
    let url: URL
    try {
      url = new URL(address)
    } catch {
      throw new ConnectionError('That is not an address. Copy the connection address from the platform.')
    }
    if (!/^https?:$/.test(url.protocol)) throw new ConnectionError('The address must start with https:// or http://')
    const key = rawKey.trim()
    if (!key) throw new ConnectionError('Paste the API key from the platform.')
    if (this.list().some((c) => c.address === address)) throw new ConnectionError('This address is connected already.')
    if (this.list().length >= MAX_CONNECTIONS) throw new ConnectionError(`At most ${MAX_CONNECTIONS} connections`)
    // Checks the address and the key, and pairs this app with the address -
    // anew, if the platform had disconnected it.
    const { wanted, account } = await this.tellCatalog(address, key, true)
    this.dropRelease(address)
    const id = randomUUID()
    this.saveKey(id, key)
    const all = this.all()
    all[id] = {
      id,
      name: rawName.trim().slice(0, 60) || url.hostname,
      address,
      account,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      wanted,
      catalogHash: this.catalogHash(address)
    }
    settingsRepository.setInternal(CONNECTIONS_KEY, all)
    this.startLive(id)
    this.changed()
    return this.status()
  }

  /**
   * Disconnects here and tells the platform, which lets go of this app at once
   * (what it already has stays there). The network down: it is told later.
   */
  disconnect(id: string): ConnectionsStatus {
    const connection = this.all()[id]
    const key = this.key(id)
    this.forget(id)
    if (connection && key) {
      this.queueRelease({ address: connection.address, key, tries: 0 })
      void this.sendReleases()
    }
    return this.status()
  }

  /** Drops a connection here: its live connection, key, state and anything waiting to go. */
  private forget(id: string): void {
    this.stopLive(id)
    for (const slot of [...this.waiting.keys(), ...this.unsent.keys()]) {
      if (slot.startsWith(`${id}:`)) {
        this.waiting.delete(slot)
        this.unsent.delete(slot)
      }
    }
    const retry = this.requestRetries.get(id)
    if (retry) clearTimeout(retry.timer)
    this.requestRetries.delete(id)
    this.saveKey(id, null)
    this.save(id, null)
    this.saveSent(id, null, null)
    this.changed()
  }

  /** The platform ended this connection: drop it here too, and tell the user. */
  private endedByPlatform(id: string, reason: string): void {
    const connection = this.all()[id]
    if (!connection) return
    this.forget(id)
    const ended = settingsRepository.getInternal<EndedNotice[] | null>(ENDED_KEY, null) ?? []
    ended.unshift({ name: connection.name, reason, at: new Date().toISOString() })
    settingsRepository.setInternal(ENDED_KEY, ended.slice(0, 10))
    this.changed()
    if (Notification.isSupported()) {
      createNotification({ title: `${connection.name} was disconnected`, body: reason }).show()
    }
  }

  /** An answer that means the platform no longer has this connection: it ends here. True if so. */
  private endIfGone(id: string, err: unknown): boolean {
    if (!(err instanceof ConnectionError) || !ENDED_STATUSES.has(err.status)) return false
    this.endedByPlatform(id, endedReason(err.status, err.message))
    return true
  }

  /** The user read the notices about connections the platform ended. */
  dismissEnded(): ConnectionsStatus {
    settingsRepository.setInternal(ENDED_KEY, [])
    this.changed()
    return this.status()
  }

  // Telling platforms about disconnects made here while they could not be reached.

  private releases(): PendingRelease[] {
    return (settingsRepository.getInternal<PendingRelease[] | null>(RELEASES_KEY, null) ?? []).map((r) => {
      try {
        return { ...r, key: safeStorage.decryptString(Buffer.from(r.key, 'base64')) }
      } catch {
        return { ...r, key: '' }
      }
    }).filter((r) => r.key)
  }

  private saveReleases(list: PendingRelease[]): void {
    settingsRepository.setInternal(
      RELEASES_KEY,
      safeStorage.isEncryptionAvailable()
        ? list.map((r) => ({ ...r, key: safeStorage.encryptString(r.key).toString('base64') }))
        : []
    )
  }

  private queueRelease(release: PendingRelease): void {
    this.saveReleases([...this.releases().filter((r) => r.address !== release.address), release])
  }

  private dropRelease(address: string): void {
    const list = this.releases()
    if (list.some((r) => r.address === address)) this.saveReleases(list.filter((r) => r.address !== address))
  }

  private releaseTimer: NodeJS.Timeout | null = null

  /** Tells each platform still waiting that this app disconnected; retries the ones it can't reach. */
  private async sendReleases(): Promise<void> {
    const list = this.releases()
    if (list.length === 0) return
    const left: PendingRelease[] = []
    for (const release of list) {
      try {
        await this.request(release.address, release.key, '/pairing', { method: 'DELETE' })
      } catch (err) {
        // Down, or busy: try again. Anything else (gone, refused) means there is
        // nothing left to release.
        const down = !(err instanceof ConnectionError) || err.status === 0 || err.status === 429 || err.status >= 500
        if (down) left.push({ ...release, tries: release.tries + 1 })
      }
    }
    this.saveReleases(left)
    if (left.length > 0 && !this.releaseTimer) {
      const tries = Math.min(...left.map((r) => r.tries))
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = null
        void this.sendReleases()
      }, Math.min(RETRY_MIN_MS * 2 ** Math.max(tries - 1, 0), RETRY_MAX_MS))
      this.watchOnline()
    }
  }

  /** Asks the platform again which calendars it wants (after choosing them there). */
  async refresh(id: string): Promise<ConnectionsStatus> {
    try {
      await this.sendCatalog(id)
    } catch (err) {
      this.save(id, { lastError: errorText(err) })
      throw err
    } finally {
      this.changed()
    }
    return this.status()
  }

  /** Syncs every calendar the platform wants now (Proton accounts are exported first); each is sent as it arrives. */
  async syncWanted(id: string): Promise<ConnectionSyncResult[]> {
    await this.refresh(id)
    const connection = this.get(id)
    const calendars = this.shareable(connection.address).filter((c) => connection.wanted[c.id])
    const accounts = [...new Set(calendars.map((c) => c.accountId).filter((a): a is string => Boolean(a)))]
    const others = calendars.filter((c) => !c.accountId)
    await Promise.all([
      ...accounts.map((a) => protonAccountService.sync(a).catch(() => undefined)),
      ...others.map((c) => syncService.syncOne(c.id, { force: true }).catch(() => undefined))
    ])
    await Promise.all(calendars.map((c) => this.uploads.get(`${id}:${c.id}`)))
    const sent = this.sentOf(id)
    return calendars.map((c) => {
      const last = sent[c.id]
      const fresh = calendarRepository.get(c.id)
      if (fresh?.lastSyncError) return { name: c.name, ok: false, message: fresh.lastSyncError }
      if (last?.error) return { name: c.name, ok: false, message: last.error }
      if (!last?.at) return { name: c.name, ok: false, message: 'It did not sync here, so nothing was sent' }
      return { name: c.name, ok: true, message: `${last.eventCount ?? 0} events sent (${connection.wanted[c.id]})` }
    })
  }
}

export const connectionService = new ConnectionService()
