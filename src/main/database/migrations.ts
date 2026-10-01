import type Database from 'better-sqlite3'

/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 * Never edit a migration that has shipped; append a new one instead.
 *
 * Design notes:
 *  - IDs are TEXT (UUIDs for user-created rows, deterministic hashes for synced
 *    events) so that re-syncing a feed produces the same event IDs and notes
 *    keep pointing at the right meeting.
 *  - `notes.event_id` deliberately has no foreign key: a synced event can briefly
 *    disappear from a feed (or fall outside the recurrence expansion window) and
 *    its note should survive and re-attach when it comes back.
 */
const migrations: string[] = [
  `
  CREATE TABLE calendars (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_synced_at  TEXT,
    last_sync_error TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE events (
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
  CREATE INDEX idx_events_start ON events (start_time);
  CREATE INDEX idx_events_end ON events (end_time);

  CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL UNIQUE,
    content    TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    key   TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL
  );
  `,
  // v2: connected Proton accounts (embedded login + automatic export)
  `
  CREATE TABLE proton_accounts (
    id             TEXT PRIMARY KEY,
    label          TEXT NOT NULL,
    auto_sync      INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'new',
    last_export_at TEXT,
    last_error     TEXT,
    created_at     TEXT NOT NULL
  );

  ALTER TABLE calendars ADD COLUMN account_id TEXT REFERENCES proton_accounts(id) ON DELETE CASCADE;
  ALTER TABLE calendars ADD COLUMN proton_calendar_name TEXT;
  CREATE UNIQUE INDEX idx_calendars_account_name
    ON calendars (account_id, proton_calendar_name) WHERE account_id IS NOT NULL;
  `,
  // v3: per-calendar desktop notifications
  `
  ALTER TABLE calendars ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
  `,
  // v4: the reminder check (every 15 s) looks up local events with a reminder
  `
  CREATE INDEX idx_events_local_reminders ON events (start_time)
    WHERE is_local_event = 1 AND reminder_minutes IS NOT NULL;
  `
]

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version])
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
