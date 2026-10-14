import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app } from 'electron'
import { APP_NAME } from '@shared/brand'
import type { CalendarSource, CalendarSyncResult, SyncStatus } from '@shared/types'
import { hostOf, isAutoSyncSource, isFileSource, isGoogleCalendarUrl, normalizeFeedUrl } from '@shared/sources'
import { calendarRepository } from '../database/calendarRepository'
import { eventRepository } from '../database/eventRepository'
import { fileSourcePath } from '../services/fileSourceService'
import { hostBackoff } from './hostBackoff'
import { parseIcs } from './icsParser'

const FETCH_TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 50 * 1024 * 1024
/**
 * Pause between two requests to the same server. Several Google accounts still share
 * one IP, and a burst of parallel requests is what triggers HTTP 429.
 */
const SAME_HOST_GAP_MS = 1_500
/**
 * Refresh-all and auto-sync skip web links fetched successfully this recently, so
 * repeated clicks keep the cached result instead of sending more requests.
 */
const MIN_REFETCH_MS = 60_000
/** Cap on a downloaded feed, so a broken or hostile link cannot exhaust memory. */
const MAX_FEED_BYTES = 50 * 1024 * 1024
const MAX_REDIRECTS = 5

type StatusListener = (status: SyncStatus) => void

/**
 * Read-only sync of ICS feeds into the local SQLite cache. Nothing is ever written
 * back to Proton.
 *
 * Syncs run on explicit user request (refresh buttons). The only exception is
 * autoSyncService, which refreshes non-Proton web links (Google etc.) on a timer.
 *
 * Error handling: each calendar syncs independently. If a fetch or parse fails,
 * the error is recorded on that calendar and its previously cached events are
 * left untouched, so the user still sees their last known schedule offline.
 *
 * Politeness: links on the same server are fetched one after another, and a server
 * that answers "too many requests" is left alone for a while (see hostBackoff).
 */
class SyncService {
  private status: SyncStatus = { running: false, syncingIds: [], lastRunAt: null, results: [] }
  /** All runs are serialized through this chain so they never write concurrently. */
  private queue: Promise<unknown> = Promise.resolve()
  /** A queued-but-not-started full sync; further syncAll() calls join it. */
  private pendingFull: Promise<SyncStatus> | null = null
  private listeners = new Set<StatusListener>()
  /** Warnings that survive a successful read (e.g. "not found in Proton anymore"). */
  private warnings = new Map<string, string>()

  setWarning(calendarId: string, warning: string | null): void {
    if (warning) this.warnings.set(calendarId, warning)
    else this.warnings.delete(calendarId)
  }

  getStatus(): SyncStatus {
    return this.status
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Syncs every enabled calendar. If a full sync is already waiting in the queue,
   * callers share it instead of queueing duplicates.
   */
  syncAll(): Promise<SyncStatus> {
    if (this.pendingFull) return this.pendingFull
    const full = this.enqueue(() => {
      this.pendingFull = null // from now on, new requests should queue a fresh run
      return this.run(calendarRepository.list().filter((c) => c.enabled), true)
    })
    this.pendingFull = full
    return full
  }

  /**
   * Timer-driven sync of web link calendars (never Proton, see isAutoSyncSource).
   * Skipped while a full sync is waiting, since that covers these calendars too.
   */
  syncAuto(): Promise<SyncStatus> {
    if (this.pendingFull) return this.pendingFull
    return this.enqueue(() => {
      const calendars = calendarRepository.list().filter(isAutoSyncSource)
      return calendars.length ? this.run(calendars, true) : Promise.resolve(this.status)
    })
  }

  /**
   * Syncs a single calendar (also allowed when it is disabled, e.g. to test a URL).
   * Always fetches, since the URL may just have been edited.
   */
  syncOne(calendarId: string): Promise<SyncStatus> {
    return this.enqueue(() => {
      const calendar = calendarRepository.get(calendarId)
      if (!calendar) throw new Error('Calendar not found')
      return this.run([calendar])
    })
  }

  private enqueue(task: () => Promise<SyncStatus>): Promise<SyncStatus> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async run(calendars: CalendarSource[], reuseRecent = false): Promise<SyncStatus> {
    if (reuseRecent) {
      const recent = calendars.map((c) => this.recentResult(c))
      const reused = recent.filter((r) => r !== null)
      calendars = calendars.filter((_, i) => !recent[i])
      if (reused.length) console.log(`[sync] ${reused.length} calendar(s) synced under a minute ago, kept cached`)
    }
    this.setStatus({ ...this.status, running: true, syncingIds: calendars.map((c) => c.id) })
    // syncCalendar never throws, so `running` is always reset.
    const results = (await Promise.all(groupByHost(calendars).map((group) => this.syncGroup(group)))).flat()

    // Merge with previous results so a single-calendar sync keeps the others' state.
    const merged = new Map(this.status.results.map((r) => [r.calendarId, r]))
    for (const r of results) merged.set(r.calendarId, r)
    const existingIds = new Set(calendarRepository.list().map((c) => c.id))
    this.setStatus({
      running: false,
      syncingIds: [],
      lastRunAt: new Date().toISOString(),
      results: [...merged.values()].filter((r) => existingIds.has(r.calendarId))
    })
    return this.status
  }

  /** The last successful result of a web link fetched less than MIN_REFETCH_MS ago. */
  private recentResult(calendar: CalendarSource): CalendarSyncResult | null {
    if (!hostOf(calendar.sourceUrl) || !calendar.lastSyncedAt) return null
    if (Date.now() - Date.parse(calendar.lastSyncedAt) >= MIN_REFETCH_MS) return null
    return this.status.results.find((r) => r.calendarId === calendar.id && r.ok) ?? null
  }

  /** Syncs calendars of one server sequentially, pausing between actual requests. */
  private async syncGroup(calendars: CalendarSource[]): Promise<CalendarSyncResult[]> {
    const results: CalendarSyncResult[] = []
    for (const [i, calendar] of calendars.entries()) {
      const host = hostOf(calendar.sourceUrl)
      if (i > 0 && host && !hostBackoff.blockedUntil(host)) await delay(SAME_HOST_GAP_MS)
      results.push(await this.syncCalendar(calendar))
    }
    return results
  }

  private async syncCalendar(calendar: CalendarSource): Promise<CalendarSyncResult> {
    const host = hostOf(calendar.sourceUrl)
    try {
      const blockedUntil = host ? hostBackoff.blockedUntil(host) : null
      if (blockedUntil) throw new Error(rateLimitMessage(calendar.sourceUrl, blockedUntil))
      const { text, modifiedAt } = isFileSource(calendar.sourceUrl)
        ? await readIcsFile(calendar.sourceUrl)
        : { text: await fetchIcs(calendar.sourceUrl), modifiedAt: undefined }
      const events = parseIcs(calendar.id, text, { sourceUrl: calendar.sourceUrl })
      eventRepository.replaceCalendarEvents(calendar.id, events)
      calendarRepository.setSyncSuccess(calendar.id, this.warnings.get(calendar.id) ?? null)
      if (host) hostBackoff.recordSuccess(host)
      return { calendarId: calendar.id, ok: true, eventCount: events.length, sourceModifiedAt: modifiedAt }
    } catch (err) {
      const message =
        err instanceof RateLimitedError && host
          ? rateLimitMessage(calendar.sourceUrl, hostBackoff.recordLimited(host, err.retryAfterMs))
          : describeError(err)
      console.error(`[sync] ${calendar.name}: ${message}`)
      // The calendar may have been deleted while we were fetching.
      if (calendarRepository.get(calendar.id)) calendarRepository.setSyncError(calendar.id, message)
      return { calendarId: calendar.id, ok: false, eventCount: 0, error: message }
    }
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    for (const listener of this.listeners) {
      // A failing listener (e.g. a destroyed window) must never break the sync itself.
      try {
        listener(status)
      } catch (err) {
        console.error('[sync] status listener failed:', err)
      }
    }
  }
}

/**
 * Same-server web links share one group (run sequentially); files and other servers
 * get their own group, so they still sync in parallel.
 */
function groupByHost(calendars: CalendarSource[]): CalendarSource[][] {
  const groups: CalendarSource[][] = []
  const byHost = new Map<string, CalendarSource[]>()
  for (const calendar of calendars) {
    const host = hostOf(calendar.sourceUrl)
    const group = host ? byHost.get(host) : undefined
    if (group) {
      group.push(calendar)
      continue
    }
    const created = [calendar]
    if (host) byHost.set(host, created)
    groups.push(created)
  }
  return groups
}

/** HTTP 429 (or 503 with Retry-After): the server wants us to slow down. */
class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super('Rate limited')
  }
}

/** Retry-After is either delay-seconds or an HTTP date. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

function rateLimitMessage(url: string, until: number): string {
  const server = isGoogleCalendarUrl(url) ? 'Google' : hostOf(url)
  const time = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${server} is temporarily limiting requests (HTTP 429). Paused until ${time} to avoid a longer block`
}

/**
 * Downloads a feed. Redirects are followed by hand: at most MAX_REDIRECTS, and never
 * from https to plain http, which would send the link's secret token unencrypted.
 */
async function fetchIcs(url: string): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let current = new URL(normalizeFeedUrl(url))
  for (let redirects = 0; ; redirects++) {
    const response = await fetch(current, {
      signal,
      redirect: 'manual',
      // Google writes Meet join instructions into DESCRIPTION, localized per request; without
      // this they can come back in an arbitrary language (e.g. Chinese).
      headers: {
        Accept: 'text/calendar, */*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
        // Identify as a calendar client rather than an anonymous script.
        'User-Agent': `${APP_NAME}/${app.getVersion()}`
      }
    })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      if (redirects >= MAX_REDIRECTS) throw new Error('The server redirected too many times')
      const next = new URL(location, current)
      const allowed = next.protocol === 'https:' || (next.protocol === 'http:' && current.protocol === 'http:')
      if (!allowed) throw new Error('The server redirected to an insecure address, so it was not followed')
      current = next
      continue
    }
    const retryAfter = response.headers.get('retry-after')
    if (response.status === 429 || (response.status === 503 && retryAfter)) {
      await response.body?.cancel()
      throw new RateLimitedError(parseRetryAfter(retryAfter))
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Server responded with HTTP ${response.status} ${response.statusText}`.trim())
    }
    const text = await readLimited(response)
    if (!text.includes('BEGIN:VCALENDAR')) {
      throw new Error('The URL did not return an iCalendar (ICS) file')
    }
    return text
  }
}

/** Reads the body as UTF-8, aborting once it exceeds MAX_FEED_BYTES. */
async function readLimited(response: Response): Promise<string> {
  const tooLarge = 'The calendar is too large to download (over 50 MB)'
  if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES) {
    await response.body?.cancel()
    throw new Error(tooLarge)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_FEED_BYTES) {
      await reader.cancel()
      throw new Error(tooLarge)
    }
    chunks.push(value)
  }
  // TextDecoder drops a leading BOM, like response.text() did.
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Reads an exported .ics file (file: URL). The file's mtime tells the user how old the snapshot is. */
async function readIcsFile(url: string): Promise<{ text: string; modifiedAt: string }> {
  const path = fileSourcePath(url)
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`${basename(path)} is not a file`)
    if (info.size > MAX_FILE_BYTES) throw new Error(`${basename(path)} is too large (over 50 MB)`)
    const text = await readFile(path, 'utf8')
    if (!text.includes('BEGIN:VCALENDAR')) {
      throw new Error(`${basename(path)} is not an iCalendar (ICS) file`)
    }
    return { text, modifiedAt: info.mtime.toISOString() }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error(`File not found: ${basename(path)}. Was it moved or deleted? Use "Update from file" to pick it again.`)
    }
    if (code === 'EACCES' || code === 'EPERM') throw new Error(`No permission to read ${basename(path)}`)
    throw err
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'Request timed out'
    // fetch() wraps network failures; the cause has the useful detail (DNS, TLS, ...).
    const cause = (err as Error & { cause?: unknown }).cause
    if (err.message === 'fetch failed' && cause instanceof Error) return `Network error: ${cause.message}`
    return err.message
  }
  return String(err)
}

export const syncService = new SyncService()
