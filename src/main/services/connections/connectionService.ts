import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { BrowserWindow, safeStorage } from 'electron'
import { IPC } from '@shared/ipcChannels'
import { hostOf, isFileSource, isTeamworkSource } from '@shared/sources'
import type { CalendarSource, ConnectionCalendar, ConnectionStatus, ConnectionSyncResult, ConnectionsStatus } from '@shared/types'
import { accountRepository } from '../../database/accountRepository'
import { calendarRepository } from '../../database/calendarRepository'
import { settingsRepository } from '../../database/settingsRepository'
import { syncService } from '../../sync/syncService'
import { protonAccountService } from '../proton/protonAccountService'

/**
 * Calendar connections: sends some of this app's calendars to any platform that
 * speaks the calendar connection protocol. A platform gives the user an address
 * and an API key; with those, this app
 *
 *   PUT    <address>/catalog              says which calendars it has, grouped by
 *                                         Proton account, and learns which of them
 *                                         the platform wants
 *   PUT    <address>/calendars/<id>       sends one wanted calendar as .ics
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
 * API keys are kept encrypted with the operating system's key store (Electron
 * safeStorage); they never reach the renderer.
 */

const CONNECTIONS_KEY = 'connections.list'
const KEYS_KEY = 'connections.keys'
/** This install's own id, the same for every platform. */
const CLIENT_ID_KEY = 'connections.clientId'
/** What was sent last: connection id → calendar id → what. An unchanged calendar isn't sent again. */
const SENT_KEY = 'connections.sent'
const REQUEST_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 5 * 60_000
/** Largest calendar file sent. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** A platform may ask for a pause between changes to one calendar; wait at most this long, once. */
const MAX_RETRY_WAIT_MS = 40_000
/** Calendars sync in bursts; what this app has is told once they settle. */
const CATALOG_DEBOUNCE_MS = 3_000
const MAX_CONNECTIONS = 10

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

class ConnectionService {
  /** Uploads per connection and calendar, one after another, so two syncs never race. */
  private uploads = new Map<string, Promise<void>>()
  private catalogTimer: NodeJS.Timeout | null = null

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
    init: { method?: string; json?: unknown; ics?: string; timeoutMs?: number } = {}
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${address}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'X-API-Key': key,
          'X-Client-Id': this.clientId(),
          'X-Client-Name': this.clientName(),
          Accept: 'application/json',
          ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.ics !== undefined ? { 'Content-Type': 'text/calendar; charset=utf-8' } : {})
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.ics,
        signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS)
      })
    } catch {
      throw new ConnectionError('The platform could not be reached. Check the address and the internet connection.')
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
  private async tellCatalog(address: string, key: string): Promise<{ wanted: Record<string, string>; account: string }> {
    const info = await this.request<{ account?: { username?: string }; calendars?: ServerCalendar[] }>(address, key, '/catalog', {
      method: 'PUT',
      json: { calendars: this.catalogOf(address) }
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
    const { wanted, account } = await this.tellCatalog(connection.address, key)
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

  /** After a calendar synced: sends it to one platform, unless it is what the platform already has. */
  private upload(id: string, calendar: CalendarSource, ics: string): Promise<void> {
    const slot = `${id}:${calendar.id}`
    const previous = this.uploads.get(slot) ?? Promise.resolve()
    const run = previous.then(async () => {
      const connection = this.all()[id]
      const key = this.key(id)
      if (!connection || !key || !connection.wanted[calendar.id]) return
      const before = this.sentOf(id)[calendar.id]
      const hash = fingerprint(ics)
      // Nothing changed since the last successful send: no request at all.
      if (before?.hash === hash && !before.error) return
      const send = (): Promise<{ status?: string; event_count?: number }> =>
        this.request(
          connection.address,
          key,
          `/calendars/${encodeURIComponent(calendar.id)}?name=${encodeURIComponent(calendar.name.slice(0, 80))}`,
          { method: 'PUT', ics, timeoutMs: UPLOAD_TIMEOUT_MS }
        )
      try {
        if (Buffer.byteLength(ics, 'utf8') > MAX_UPLOAD_BYTES) throw new ConnectionError('This calendar is too large to send (8 MB at most)')
        let result: { status?: string; event_count?: number }
        try {
          result = await send()
        } catch (err) {
          // The platform asks for a pause after a change: wait as long as it says, once.
          if (!(err instanceof ConnectionError && err.status === 429)) throw err
          await new Promise((resolve) => setTimeout(resolve, Math.min((err.retryAfter || 30) * 1000 + 500, MAX_RETRY_WAIT_MS)))
          result = await send()
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
        this.saveSent(id, calendar.id, { hash: null, at: before?.at ?? null, eventCount: before?.eventCount ?? null, error: errorText(err) })
      }
      this.changed()
    })
    const settled = run.catch(() => undefined)
    this.uploads.set(slot, settled)
    return settled
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
      groups: [...groups.values()]
    }
  }

  status(): ConnectionsStatus {
    return { clientName: this.clientName(), connections: this.list().map((c) => this.statusOf(c)) }
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
    // Checks the address and the key, and pairs this app with the address.
    const { wanted, account } = await this.tellCatalog(address, key)
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
    this.changed()
    return this.status()
  }

  /** Forgets the address and the key. What the platform already has stays there until it is removed there. */
  disconnect(id: string): ConnectionsStatus {
    this.saveKey(id, null)
    this.save(id, null)
    this.saveSent(id, null, null)
    this.changed()
    return this.status()
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
