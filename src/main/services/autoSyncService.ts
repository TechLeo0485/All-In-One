import { settingsRepository } from '../database/settingsRepository'
import { syncService } from '../sync/syncService'

const CHECK_INTERVAL_MS = 60_000
/** Let the window open before the first fetch at startup. */
const STARTUP_DELAY_MS = 10_000

/**
 * Refreshes web link calendars (Google etc.) every `autoSyncMinutes`, and once at
 * startup. Proton calendars are never included (see isAutoSyncSource).
 *
 * A minute tick compares against the last run instead of one long timer, so changes
 * to the interval apply right away and a PC waking from sleep catches up promptly.
 */
class AutoSyncService {
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private lastRunAt = 0

  start(): void {
    this.startupTimer = setTimeout(() => this.check(), STARTUP_DELAY_MS)
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.timer) clearInterval(this.timer)
    this.startupTimer = this.timer = null
  }

  private check(): void {
    const minutes = settingsRepository.get().autoSyncMinutes
    if (minutes <= 0 || Date.now() - this.lastRunAt < minutes * 60_000) return
    this.lastRunAt = Date.now()
    syncService.syncAuto().catch((err) => console.error('[auto-sync] failed:', err))
  }
}

export const autoSyncService = new AutoSyncService()
