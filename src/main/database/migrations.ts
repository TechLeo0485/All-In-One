import type Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 * They run at startup, so an auto-update upgrades the user's existing database
 * in place: accounts, links, events and notes are kept.
 *
 * Rules for adding a migration (so updates never break a user's data):
 *  1. Append only. Never reorder a migration or change what it creates once it has
 *     shipped; users' databases already ran it.
 *  2. Additive only. Add tables, columns (with a DEFAULT) and indexes; don't drop
 *     or rename anything. An older version of the app (e.g. after reinstalling
 *     it) must still work with the newer database.
 *  3. Safe to re-run. Use addColumn() and CREATE ... IF NOT EXISTS, so a database
 *     that already has the change (e.g. from a dev build) doesn't fail.
 *  4. Run `npm run test:migrations`, which upgrades databases from every older
 *     version with sample data. The release workflow runs it too.
 *
 * Design notes:
 *  - IDs are TEXT (UUIDs for user-created rows, deterministic hashes for synced
 *    events) so that re-syncing a feed produces the same event IDs and notes
 *    keep pointing at the right meeting.
 *  - `notes.event_id` deliberately has no foreign key: a synced event can briefly
 *    disappear from a feed (or fall outside the recurrence expansion window) and
 *    its note should survive and re-attach when it comes back.
 */
export const migrations: Migration[] = [
  `
  CREATE TABLE IF NOT EXISTS calendars (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_synced_at  TEXT,
    last_sync_error TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id               TEXT PRIMARY KEY,
    calendar_id      TEXT REFERENCES calendars(id) ON DELETE CASCADE,
    external_id      TEXT,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    start_time       TEXT NOT NULL,
    end_time         TEXT NOT NULL,
    all_day          INTEGER NOT NULL DEFAULT 0,
    location         TEXT NOT NULL DEFAULT '',
    is_local_event   INTEGER NOT NULL DEFAULT 0,
    color            TEXT,
    reminder_minutes INTEGER,
    created_at       TEXT NOT NULL,
    UNIQUE (calendar_id, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_time);
  CREATE INDEX IF NOT EXISTS idx_events_end ON events (end_time);

  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL UNIQUE,
    content    TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    key   TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL
  );
  `,
  // v2: connected Proton accounts (embedded login + automatic export)
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS proton_accounts (
        id             TEXT PRIMARY KEY,
        label          TEXT NOT NULL,
        auto_sync      INTEGER NOT NULL DEFAULT 1,
        status         TEXT NOT NULL DEFAULT 'new',
        last_export_at TEXT,
        last_error     TEXT,
        created_at     TEXT NOT NULL
      );
    `)
    addColumn(db, 'calendars', 'account_id', 'TEXT REFERENCES proton_accounts(id) ON DELETE CASCADE')
    addColumn(db, 'calendars', 'proton_calendar_name', 'TEXT')
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_account_name
        ON calendars (account_id, proton_calendar_name) WHERE account_id IS NOT NULL;
    `)
  },
  // v3: per-calendar desktop notifications
  (db) => addColumn(db, 'calendars', 'notify', 'INTEGER NOT NULL DEFAULT 1'),
  // v4: the reminder check (every 15 s) looks up local events with a reminder
  `
  CREATE INDEX IF NOT EXISTS idx_events_local_reminders ON events (start_time)
    WHERE is_local_event = 1 AND reminder_minutes IS NOT NULL;
  `,
  // v5: organizer and guests of synced events, as a JSON array of EventAttendee
  (db) => addColumn(db, 'events', 'attendees', "TEXT NOT NULL DEFAULT '[]'"),
  // v6: local events in the default color now store NULL ("follow Settings"), so
  // changing the default color in Settings recolors them. Before, every event saved
  // a copy of the default. Events in the factory default or the current default are
  // treated as "default"; deliberately picked other colors are kept.
  (db) => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'localEventColor'`).get() as { value: string } | undefined
    const defaults = new Set(['#10b981'])
    try {
      if (row) defaults.add(String(JSON.parse(row.value)).toLowerCase())
    } catch {
      // unreadable setting: the factory default is still handled
    }
    const reset = db.prepare(`UPDATE events SET color = NULL WHERE is_local_event = 1 AND lower(color) = ?`)
    for (const color of defaults) reset.run(color)
  },
  // v7: folded title/description/location/guests for search, written with each event.
  // Existing rows are filled in by fillMissingSearchText() right after upgrading.
  (db) => addColumn(db, 'events', 'search_text', "TEXT NOT NULL DEFAULT ''")
]

/** SQL text, or a function for changes that need checks or data conversion. */
type Migration = string | ((db: Database.Database) => void)

export const LATEST_VERSION = migrations.length

/** How many pre-upgrade backups to keep in the backups folder. */
const KEEP_BACKUPS = 3

/** ALTER TABLE ... ADD COLUMN that does nothing if the column already exists. */
export function addColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[]
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export interface UpgradeResult {
  from: number
  to: number
  /** Copy of the database taken before upgrading (null for new databases or no upgrade) */
  backupFile: string | null
}

/** Thrown when an upgrade step fails; the database stays at the last good version. */
export class DatabaseUpgradeError extends Error {
  readonly backupFile: string | null

  constructor(message: string, backupFile: string | null) {
    super(message)
    this.name = 'DatabaseUpgradeError'
    this.backupFile = backupFile
  }
}

/**
 * Brings the database to LATEST_VERSION.
 *
 * - New database: creates the schema; nothing to back up.
 * - Older database: copies it to `backupDir` first, then upgrades step by step.
 *   Each step runs in its own transaction, so a failing step is rolled back and
 *   the database stays at the previous, consistent version.
 * - Newer database (an older app version was reinstalled): left untouched. Thanks
 *   to rule 2 above, the extra tables/columns don't bother this version.
 */
export function upgradeDatabase(db: Database.Database, backupDir: string | null, migrationList: Migration[] = migrations): UpgradeResult {
  const latest = migrationList.length
  const from = db.pragma('user_version', { simple: true }) as number
  if (from >= latest) {
    if (from > latest) {
      console.warn(`[db] database is version ${from}, this app knows up to ${latest}; using it as is (newer app was installed before)`)
    }
    return { from, to: from, backupFile: null }
  }

  // A failed backup (e.g. disk full) shouldn't lock the user out: the per-step
  // transactions still protect the data, so log it and carry on.
  let backupFile: string | null = null
  if (from > 0 && backupDir) {
    try {
      backupFile = backupBeforeUpgrade(db, backupDir, from)
    } catch (err) {
      console.error('[db] could not back up the database before upgrading:', err)
    }
  }

  for (let version = from; version < latest; version++) {
    const migration = migrationList[version]
    try {
      db.transaction(() => {
        if (typeof migration === 'string') db.exec(migration)
        else migration(db)
        db.pragma(`user_version = ${version + 1}`)
      })()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new DatabaseUpgradeError(`Upgrading the database to version ${version + 1} failed: ${reason}`, backupFile)
    }
  }
  console.log(`[db] upgraded database from version ${from} to ${latest}`)
  return { from, to: latest, backupFile }
}

/** Consistent copy via VACUUM INTO (works while WAL is active); keeps the newest few. */
function backupBeforeUpgrade(db: Database.Database, backupDir: string, version: number): string {
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(backupDir, `calendar-v${version}-${stamp}.db`)
  if (existsSync(file)) rmSync(file) // VACUUM INTO refuses to overwrite
  db.prepare('VACUUM INTO ?').run(file)

  // Names sort by date, so the oldest come first.
  const backups = readdirSync(backupDir)
    .filter((name) => /^calendar-v\d+-.+\.db$/.test(name))
    .sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    rmSync(join(backupDir, old), { force: true })
  }
  return file
}
