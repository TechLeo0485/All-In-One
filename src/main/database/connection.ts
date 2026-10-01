import Database from 'better-sqlite3'
import { join } from 'node:path'
import { app } from 'electron'
import { runMigrations } from './migrations'

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
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function closeDb(): void {
  shutDown = true
  db?.close()
  db = null
}
