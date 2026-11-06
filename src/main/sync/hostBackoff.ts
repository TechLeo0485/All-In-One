import { settingsRepository } from '../database/settingsRepository'

/** First pause after a rate limit without a usable Retry-After; doubles on each repeat. */
const BASE_BACKOFF_MS = 30 * 60_000
/** Longest pause, also when the server asks for more (Retry-After). */
const MAX_BACKOFF_MS = 2 * 60 * 60_000
/** Never retry sooner than this, even if the server's Retry-After is shorter. */
const MIN_BACKOFF_MS = 60_000
const STORE_KEY = 'syncBackoff'
/** The app version whose start last cleared the pauses (see resetOnUpdate). */
const RESET_VERSION_KEY = 'syncBackoffResetVersion'

interface Backoff {
  /** Epoch ms before which the host is not contacted again */
  until: number
  /** Consecutive rate limits, for the doubling */
  strikes: number
}

/**
 * Remembers servers that answered "too many requests" (Google's secret iCal links do
 * this when hit too often from one IP) and keeps every sync, automatic or manual,
 * away from them until the pause is over. Retrying while limited only extends the
 * block. Kept per host because the limit applies to the PC, not a single link, and
 * persisted so restarting the app does not trigger another request right away.
 */
export const hostBackoff = {
  /** Epoch ms until which `host` must not be contacted, or null if it is free. */
  blockedUntil(host: string): number | null {
    const all = load()
    const entry = all[host]
    if (!entry || entry.until <= Date.now()) return null
    // Pauses saved under an older, longer maximum (or with the clock set back) are shortened once.
    const latest = Date.now() + MAX_BACKOFF_MS
    if (entry.until > latest) {
      entry.until = latest
      settingsRepository.setInternal(STORE_KEY, all)
    }
    return entry.until
  },

  /** Records a rate limit and returns when the host may be contacted again. */
  recordLimited(host: string, retryAfterMs: number | null): number {
    const all = load()
    const strikes = (all[host]?.strikes ?? 0) + 1
    const fallback = Math.min(BASE_BACKOFF_MS * 2 ** (strikes - 1), MAX_BACKOFF_MS)
    const delay = Math.min(Math.max(retryAfterMs ?? fallback, MIN_BACKOFF_MS), MAX_BACKOFF_MS)
    const until = Date.now() + delay
    all[host] = { until, strikes }
    settingsRepository.setInternal(STORE_KEY, all)
    return until
  },

  /**
   * Once per app version: forgets all pauses (and their doubling), so after an update
   * the user can refresh straight away. Returns the hosts that were paused.
   */
  resetOnUpdate(version: string): string[] {
    if (settingsRepository.getInternal<string>(RESET_VERSION_KEY, '') === version) return []
    settingsRepository.setInternal(RESET_VERSION_KEY, version)
    const hosts = Object.keys(load())
    if (hosts.length) settingsRepository.setInternal(STORE_KEY, {})
    return hosts
  },

  recordSuccess(host: string): void {
    const all = load()
    if (!(host in all)) return
    delete all[host]
    settingsRepository.setInternal(STORE_KEY, all)
  }
}

function load(): Record<string, Backoff> {
  const all = settingsRepository.getInternal<Record<string, Backoff>>(STORE_KEY, {})
  return all && typeof all === 'object' ? all : {}
}

const LAST_REQUEST_KEY = 'syncLastRequest'

/**
 * When each server was last contacted, persisted so the pause between requests also
 * holds across separate refresh clicks and app restarts (see syncService pacing).
 */
export const hostPacing = {
  lastRequestAt(host: string): number {
    const value = loadRequests()[host]
    return typeof value === 'number' ? value : 0
  },

  markRequest(host: string): void {
    const all = loadRequests()
    all[host] = Date.now()
    settingsRepository.setInternal(LAST_REQUEST_KEY, all)
  }
}

function loadRequests(): Record<string, number> {
  const all = settingsRepository.getInternal<Record<string, number>>(LAST_REQUEST_KEY, {})
  return all && typeof all === 'object' ? all : {}
}
