// Upgrade tests for src/main/database/migrations.ts. Run: npm run test:migrations
// Each test builds a database the way an older app version left it, then upgrades
// it like an auto-update would, and checks that nothing was lost.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import Database from 'better-sqlite3'
import { DatabaseUpgradeError, LATEST_VERSION, migrations, upgradeDatabase } from '../src/main/database/migrations.ts'

const root = mkdtempSync(join(tmpdir(), 'aio-migrations-'))
const opened: Database.Database[] = []
after(() => {
  for (const db of opened) db.close()
  rmSync(root, { recursive: true, force: true })
})

let counter = 0
/** A fresh on-disk database (WAL, like the app) plus its own backup folder. */
function openDb(): { db: Database.Database; backupDir: string } {
  const base = join(root, String(++counter))
  const db = new Database(`${base}.db`)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  opened.push(db)
  return { db, backupDir: `${base}-backups` }
}

const version = (db: Database.Database): number => db.pragma('user_version', { simple: true }) as number
const columns = (db: Database.Database, table: string): string[] =>
  (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)

const GOOGLE_URL = 'https://calendar.google.com/calendar/ical/x/basic.ics'

/** Data an older version could have stored (only v1 columns, which every version has). */
function insertSampleData(db: Database.Database): void {
  db.prepare(
    `INSERT INTO calendars (id, name, color, source_url, created_at) VALUES ('cal1', 'Work', '#3b82f6', ?, '2026-01-01')`
  ).run(GOOGLE_URL)
  db.prepare(
    `INSERT INTO events (id, calendar_id, external_id, title, start_time, end_time, created_at)
     VALUES ('ev1', 'cal1', 'uid1', 'Standup', '2026-10-05T09:00:00.000Z', '2026-10-05T09:15:00.000Z', '2026-01-01')`
  ).run()
  db.prepare(
    `INSERT INTO events (id, calendar_id, title, start_time, end_time, is_local_event, color, reminder_minutes, created_at)
     VALUES ('local1', NULL, 'Dentist', '2026-10-06', '2026-10-07', 1, '#10b981', 30, '2026-01-01')`
  ).run()
  db.prepare(`INSERT INTO notes (id, event_id, content, updated_at) VALUES ('n1', 'ev1', '# Agenda', '2026-01-01')`).run()
  db.prepare(`INSERT INTO settings (key, value) VALUES ('autoSyncMinutes', '30')`).run()
}

function assertSampleDataIntact(db: Database.Database): void {
  assert.equal(db.prepare(`SELECT source_url FROM calendars WHERE id = 'cal1'`).pluck().get(), GOOGLE_URL)
  assert.equal(db.prepare(`SELECT count(*) FROM events`).pluck().get(), 2)
  assert.equal(db.prepare(`SELECT reminder_minutes FROM events WHERE id = 'local1'`).pluck().get(), 30)
  assert.equal(db.prepare(`SELECT content FROM notes WHERE event_id = 'ev1'`).pluck().get(), '# Agenda')
  assert.equal(db.prepare(`SELECT value FROM settings WHERE key = 'autoSyncMinutes'`).pluck().get(), '30')
}

test('a new database gets the latest schema and no backup', () => {
  const { db, backupDir } = openDb()
  assert.deepEqual(upgradeDatabase(db, backupDir), { from: 0, to: LATEST_VERSION, backupFile: null })
  assert.ok(columns(db, 'events').includes('attendees'))
  assert.ok(columns(db, 'calendars').includes('account_id'))
})

for (let from = 1; from < LATEST_VERSION; from++) {
  test(`upgrading from version ${from} keeps all data and makes a backup`, () => {
    const { db, backupDir } = openDb()
    upgradeDatabase(db, null, migrations.slice(0, from))
    assert.equal(version(db), from)
    insertSampleData(db)

    const result = upgradeDatabase(db, backupDir)
    assert.equal(result.from, from)
    assert.equal(version(db), LATEST_VERSION)
    assertSampleDataIntact(db)
    assert.equal(db.prepare(`SELECT attendees FROM events WHERE id = 'ev1'`).pluck().get(), '[]')

    // The backup is a complete copy of the old version.
    assert.ok(result.backupFile)
    const backup = new Database(result.backupFile, { readonly: true })
    assert.equal(version(backup), from)
    assertSampleDataIntact(backup)
    backup.close()
  })
}

test('running the upgrade again does nothing', () => {
  const { db, backupDir } = openDb()
  upgradeDatabase(db, backupDir)
  assert.deepEqual(upgradeDatabase(db, backupDir), { from: LATEST_VERSION, to: LATEST_VERSION, backupFile: null })
})

test('every step is safe to run again on a database that already has it', () => {
  const { db, backupDir } = openDb()
  upgradeDatabase(db, null)
  insertSampleData(db)
  db.pragma('user_version = 0') // as if the version number was lost
  upgradeDatabase(db, backupDir)
  assert.equal(version(db), LATEST_VERSION)
  assertSampleDataIntact(db)
})

test('a column that already exists (e.g. from a dev build) does not break the upgrade', () => {
  const { db, backupDir } = openDb()
  upgradeDatabase(db, null, migrations.slice(0, 4))
  db.exec(`ALTER TABLE events ADD COLUMN attendees TEXT NOT NULL DEFAULT '[]'`)
  upgradeDatabase(db, backupDir)
  assert.equal(version(db), LATEST_VERSION)
})

test('a failing step is rolled back and reported; earlier steps and data stay', () => {
  const { db, backupDir } = openDb()
  const broken = [...migrations, `CREATE TABLE extra (id TEXT); SELECT * FROM table_that_does_not_exist;`]
  upgradeDatabase(db, null, migrations.slice(0, 2))
  insertSampleData(db)

  assert.throws(
    () => upgradeDatabase(db, backupDir, broken),
    (err: unknown) =>
      err instanceof DatabaseUpgradeError &&
      err.backupFile !== null &&
      err.message.includes(`version ${LATEST_VERSION + 1}`)
  )
  assert.equal(version(db), LATEST_VERSION) // every good step was applied
  assert.equal(columns(db, 'extra').length, 0, 'the failed step left nothing behind')
  assertSampleDataIntact(db)
})

test('local events in the default color switch to "follow Settings"; picked colors stay', () => {
  const { db, backupDir } = openDb()
  upgradeDatabase(db, null, migrations.slice(0, 5))
  db.prepare(`INSERT INTO settings (key, value) VALUES ('localEventColor', '"#F59E0B"')`).run()
  const insert = db.prepare(
    `INSERT INTO events (id, title, start_time, end_time, is_local_event, color, created_at)
     VALUES (?, 'x', '2026-10-06', '2026-10-07', 1, ?, '2026-01-01')`
  )
  insert.run('factoryDefault', '#10b981')
  insert.run('currentDefault', '#f59e0b')
  insert.run('picked', '#ef4444')

  upgradeDatabase(db, backupDir)
  const colorOf = (id: string): unknown => db.prepare(`SELECT color FROM events WHERE id = ?`).pluck().get(id)
  assert.equal(colorOf('factoryDefault'), null)
  assert.equal(colorOf('currentDefault'), null)
  assert.equal(colorOf('picked'), '#ef4444')
})

test('a newer database (older app reinstalled) is used as is', () => {
  const { db, backupDir } = openDb()
  upgradeDatabase(db, backupDir)
  db.pragma(`user_version = ${LATEST_VERSION + 3}`)
  assert.equal(upgradeDatabase(db, backupDir).to, LATEST_VERSION + 3)
  assert.equal(version(db), LATEST_VERSION + 3)
})

test('only the newest 3 backups are kept', () => {
  const { db, backupDir } = openDb()
  upgradeDatabase(db, null, migrations.slice(0, 1))
  for (let i = 0; i < 5; i++) {
    db.pragma('user_version = 1') // pretend each run is another update
    upgradeDatabase(db, backupDir)
  }
  assert.equal(readdirSync(backupDir).length, 3)
})
