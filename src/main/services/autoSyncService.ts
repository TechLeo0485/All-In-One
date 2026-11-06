import { settingsRepository } from '../database/settingsRepository'
import { syncService } from '../sync/syncService'

const CHECK_INTERVAL_MS = 60_000
/** Let the window open before the first check at startup. */
const STARTUP_DELAY_MS = 10_000
const LAST_RUN_KEY = 'autoSyncLastRunAt'
/** Set once auto-sync was switched off for installs from before it became off by default. */
const OFF_BY_DEFAULT_KEY = 'autoSyncOffByDefault'

/**
 * Refreshes web link calendars (Google etc.) every `autoSyncMinutes`. Off by default:
 * Google rate limits a PC that fetches several links on a timer. Proton calendars are
 * never included (see isAutoSyncSource).
 *
 * A minute tick compares against the last run instead of one long timer, so changes
 * to the interval apply right away and a PC waking from sleep catches up promptly.
 * The last run is persisted, so restarting the app does not trigger an extra sync.
 */
class AutoSyncService {
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null

  start(): void {
    this.switchOffOnce()
    this.startupTimer = setTimeout(() => this.check(), STARTUP_DELAY_MS)
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.timer) clearInterval(this.timer)
    this.startupTimer = this.timer = null
  }

  /** Existing installs had auto-sync on; turn it off once, the user may turn it on again. */
  private switchOffOnce(): void {
    if (settingsRepository.getInternal(OFF_BY_DEFAULT_KEY, false)) return
    if (settingsRepository.get().autoSyncMinutes !== 0) settingsRepository.update({ autoSyncMinutes: 0 })
    settingsRepository.setInternal(OFF_BY_DEFAULT_KEY, true)
  }

  private check(): void {
    const minutes = settingsRepository.get().autoSyncMinutes
    if (minutes <= 0) return
    const lastRunAt = settingsRepository.getInternal(LAST_RUN_KEY, 0)
    // A last run "in the future" (clock set back) counts as long ago.
    if (lastRunAt <= Date.now() && Date.now() - lastRunAt < minutes * 60_000) return
    settingsRepository.setInternal(LAST_RUN_KEY, Date.now())
    syncService.syncAuto().catch((err) => console.error('[auto-sync] failed:', err))
  }
}

export const autoSyncService = new AutoSyncService()
