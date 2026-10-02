import Database from 'better-sqlite3'
import { join } from 'node:path'
import { app } from 'electron'
import { foldText } from '@shared/search'
import { upgradeDatabase } from './migrations'
import { fillMissingSearchText } from './searchText'

let db: Database.Database | null = null
/** Set on shutdown so late async work fails loudly instead of silently reopening the file. */
let shutDown = false

/**
 * Lazily opens the SQLite database stored in the user's app-data folder.
 * better-sqlite3 is synchronous, which is fine here: it runs only in the main
 * process, queries are small and indexed, and it keeps the code simple.
 */
export function getDb(): Database.Database {
  if (db) return db
  if (shutDown) throw new Error('Database is closed (app is quitting)')

  const file = join(app.getPath('userData'), 'calendar.db')
  const opened = new Database(file)
  try {
    opened.pragma('journal_mode = WAL')
    opened.pragma('foreign_keys = ON')
    // Case- and accent-insensitive matching for event search (SQLite's own LIKE only folds ASCII).
    opened.function('casefold', { deterministic: true }, (value: unknown) => (value == null ? '' : foldText(String(value))))
    // After an app update: back up, then upgrade the schema in place (see migrations.ts).
    upgradeDatabase(opened, join(app.getPath('userData'), 'backups'))
    fillMissingSearchText(opened)
  } catch (err) {
    opened.close() // don't keep a half-usable handle; the caller reports the error
    throw err
  }
  db = opened
  return db
}

export function closeDb(): void {
  shutDown = true
  db?.close()
  db = null
}
