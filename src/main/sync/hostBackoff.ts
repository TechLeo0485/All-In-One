import { settingsRepository } from '../database/settingsRepository'

/** First pause after a rate limit without a usable Retry-After; doubles on each repeat. */
const BASE_BACKOFF_MS = 30 * 60_000
const MAX_BACKOFF_MS = 6 * 60 * 60_000
/** Never retry sooner than this, even if the server's Retry-After is shorter. */
const MIN_BACKOFF_MS = 60_000
const STORE_KEY = 'syncBackoff'

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
    const entry = load()[host]
    return entry && entry.until > Date.now() ? entry.until : null
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
