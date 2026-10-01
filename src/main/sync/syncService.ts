import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { CalendarSource, CalendarSyncResult, SyncStatus } from '@shared/types'
import { isAutoSyncSource } from '@shared/sources'
import { calendarRepository } from '../database/calendarRepository'
import { eventRepository } from '../database/eventRepository'
import { fileSourcePath, isFileSource } from '../services/fileSourceService'
import { parseIcs } from './icsParser'

const FETCH_TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 50 * 1024 * 1024

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
 */
class SyncService {
  private status: SyncStatus = { running: false, lastRunAt: null, results: [] }
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
      return this.run(calendarRepository.list().filter((c) => c.enabled))
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
      return calendars.length ? this.run(calendars) : Promise.resolve(this.status)
    })
  }

  /** Syncs a single calendar (also allowed when it is disabled, e.g. to test a URL). */
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

  private async run(calendars: CalendarSource[]): Promise<SyncStatus> {
    this.setStatus({ ...this.status, running: true })
    // syncCalendar never throws, so `running` is always reset.
    const results = await Promise.all(calendars.map((c) => this.syncCalendar(c)))

    // Merge with previous results so a single-calendar sync keeps the others' state.
    const merged = new Map(this.status.results.map((r) => [r.calendarId, r]))
    for (const r of results) merged.set(r.calendarId, r)
    const existingIds = new Set(calendarRepository.list().map((c) => c.id))
    this.setStatus({
      running: false,
      lastRunAt: new Date().toISOString(),
      results: [...merged.values()].filter((r) => existingIds.has(r.calendarId))
    })
    return this.status
  }

  private async syncCalendar(calendar: CalendarSource): Promise<CalendarSyncResult> {
    try {
      const { text, modifiedAt } = isFileSource(calendar.sourceUrl)
        ? await readIcsFile(calendar.sourceUrl)
        : { text: await fetchIcs(calendar.sourceUrl), modifiedAt: undefined }
      const events = parseIcs(calendar.id, text)
      eventRepository.replaceCalendarEvents(calendar.id, events)
      const warning = this.warnings.get(calendar.id) ?? null
      calendarRepository.setSyncResult(calendar.id, null)
      if (warning) calendarRepository.setSyncResult(calendar.id, warning)
      return { calendarId: calendar.id, ok: true, eventCount: events.length, sourceModifiedAt: modifiedAt }
    } catch (err) {
      const message = describeError(err)
      console.error(`[sync] ${calendar.name}: ${message}`)
      // The calendar may have been deleted while we were fetching.
      if (calendarRepository.get(calendar.id)) calendarRepository.setSyncResult(calendar.id, message)
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

/** Proton shares links as https://; webcal:// is accepted for convenience. */
export function normalizeFeedUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.replace(/^webcals?:\/\//i, 'https://')
}

async function fetchIcs(url: string): Promise<string> {
  const response = await fetch(normalizeFeedUrl(url), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'text/calendar, */*;q=0.5' }
  })
  if (!response.ok) {
    throw new Error(`Server responded with HTTP ${response.status} ${response.statusText}`.trim())
  }
  const text = await response.text()
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error('The URL did not return an iCalendar (ICS) file')
  }
  return text
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
