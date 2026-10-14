import { app } from 'electron'
import type { WhatsNew } from '@shared/types'
import { compareVersions } from '@shared/version'
import { isNewDatabase } from '../database/connection'
import { settingsRepository } from '../database/settingsRepository'

/** Last app version whose release notes the user has seen (or that was freshly installed). */
const LAST_SEEN_KEY = 'lastSeenVersion'

/**
 * Decides when the renderer shows the "What's new" popup: once after each update,
 * never on a fresh install. The version is only marked as seen when the user closes
 * the popup, so quitting before the window opens (start hidden in the tray) still
 * shows it next time.
 */
export const whatsNewService = {
  get(): WhatsNew | null {
    const current = app.getVersion()
    const seen = settingsRepository.getInternal<string | null>(LAST_SEEN_KEY, null)
    if (seen === null && isNewDatabase()) {
      // Fresh install: nothing to announce.
      this.markSeen()
      return null
    }
    if (seen !== null && compareVersions(seen, current) >= 0) return null
    // seen === null with an existing database: updated from a version before this popup existed.
    return { from: seen, to: current }
  },

  markSeen(): void {
    settingsRepository.setInternal(LAST_SEEN_KEY, app.getVersion())
  }
}
