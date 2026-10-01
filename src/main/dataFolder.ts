import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DATA_FOLDER, LEGACY_DATA_FOLDER } from '@shared/brand'

export interface DataFolderMigration {
  /** file: URL prefix of the old folder (to rewrite stored file sources) */
  fromUrl: string
  toUrl: string
}

/**
 * Points userData at %APPDATA%\All-In-One (same folder for dev and the installed app)
 * and, on the first start after the rename, moves everything over from the old
 * %APPDATA%\unified-calendar folder: database, Proton logins (Partitions/) and
 * exported calendars. Must run before the app is ready.
 *
 * Entries are moved one by one because Electron may already have created the
 * new folder (it is also the default location for productName "All-In-One").
 * An explicit --user-data-dir (used for testing) always wins.
 */
export function setUpDataFolder(): DataFolderMigration | null {
  if (app.commandLine.hasSwitch('user-data-dir')) return null

  const appData = app.getPath('appData')
  const target = join(appData, DATA_FOLDER)
  const legacy = join(appData, LEGACY_DATA_FOLDER)
  app.setPath('userData', target)

  const hasData = (dir: string): boolean => existsSync(join(dir, 'calendar.db'))
  if (hasData(target) || !hasData(legacy)) return null

  try {
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(legacy)) {
      const from = join(legacy, entry)
      const to = join(target, entry)
      if (!existsSync(to)) renameSync(from, to)
    }
    try {
      rmdirSync(legacy) // only succeeds if everything was moved
    } catch {
      // leftovers (e.g. files Electron recreated) are harmless
    }
    console.log(`[data] moved data from ${legacy} to ${target}`)
    return { fromUrl: pathToFileURL(legacy).href, toUrl: pathToFileURL(target).href }
  } catch (err) {
    console.error(`[data] could not move ${legacy} to ${target}:`, err)
    // Fall back to the old folder so no data appears lost.
    app.setPath('userData', legacy)
    return null
  }
}
