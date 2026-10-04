import { randomUUID } from 'node:crypto'
import type { CalendarSource, CalendarSourceInput } from '@shared/types'
import { getDb } from './connection'

interface CalendarRow {
  id: string
  name: string
  color: string
  source_url: string
  enabled: number
  last_synced_at: string | null
  last_sync_error: string | null
  created_at: string
  account_id: string | null
  proton_calendar_name: string | null
  notify: number
}

function toCalendar(row: CalendarRow): CalendarSource {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sourceUrl: row.source_url,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    accountId: row.account_id,
    protonCalendarName: row.proton_calendar_name,
    notify: row.notify === 1
  }
}

export const calendarRepository = {
  list(): CalendarSource[] {
    const rows = getDb()
      .prepare('SELECT * FROM calendars ORDER BY created_at')
      .all() as CalendarRow[]
    return rows.map(toCalendar)
  },

  get(id: string): CalendarSource | null {
    const row = getDb().prepare('SELECT * FROM calendars WHERE id = ?').get(id) as
      | CalendarRow
      | undefined
    return row ? toCalendar(row) : null
  },

  create(input: CalendarSourceInput): CalendarSource {
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO calendars (id, name, color, source_url, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.color, input.sourceUrl, input.enabled ? 1 : 0, new Date().toISOString())
    return this.get(id)!
  },

  listForAccount(accountId: string): CalendarSource[] {
    const rows = getDb()
      .prepare('SELECT * FROM calendars WHERE account_id = ? ORDER BY created_at')
      .all(accountId) as CalendarRow[]
    return rows.map(toCalendar)
  },

  /** Creates a calendar owned by a Proton account (source is the app-managed export file). */
  createForAccount(
    accountId: string,
    protonCalendarName: string,
    input: CalendarSourceInput
  ): CalendarSource {
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO calendars (id, name, color, source_url, enabled, created_at, account_id, proton_calendar_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.color,
        input.sourceUrl,
        input.enabled ? 1 : 0,
        new Date().toISOString(),
        accountId,
        protonCalendarName
      )
    return this.get(id)!
  },

  /** After the data folder moved: rewrite file: sources that pointed into the old folder. */
  rebaseFileSources(fromUrl: string, toUrl: string): number {
    return getDb()
      .prepare(
        `UPDATE calendars SET source_url = ? || substr(source_url, length(?) + 1)
         WHERE substr(source_url, 1, length(?)) = ?`
      )
      .run(toUrl, fromUrl, fromUrl, fromUrl).changes
  },

  /** Points an account calendar at a (renamed) Proton calendar / new export file. */
  relinkAccountCalendar(id: string, protonCalendarName: string, sourceUrl: string): void {
    getDb()
      .prepare('UPDATE calendars SET proton_calendar_name = ?, source_url = ? WHERE id = ?')
      .run(protonCalendarName, sourceUrl, id)
  },

  update(id: string, input: Partial<CalendarSourceInput>): CalendarSource {
    const existing = this.get(id)
    if (!existing) throw new Error('Calendar not found')
    const merged = { ...existing, ...input }
    getDb()
      .prepare('UPDATE calendars SET name = ?, color = ?, source_url = ?, enabled = ?, notify = ? WHERE id = ?')
      .run(merged.name, merged.color, merged.sourceUrl, merged.enabled ? 1 : 0, merged.notify ? 1 : 0, id)
    return this.get(id)!
  },

  /** Failed sync: keeps last_synced_at so the UI can show "last good sync". */
  setSyncError(id: string, error: string): void {
    getDb().prepare('UPDATE calendars SET last_sync_error = ? WHERE id = ?').run(error, id)
  },

  /** Successful sync; `warning` (e.g. "not found in Proton anymore") is still shown. */
  setSyncSuccess(id: string, warning: string | null): void {
    getDb()
      .prepare('UPDATE calendars SET last_sync_error = ?, last_synced_at = ? WHERE id = ?')
      .run(warning, new Date().toISOString(), id)
  },

  remove(id: string): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare('DELETE FROM notes WHERE event_id IN (SELECT id FROM events WHERE calendar_id = ?)').run(id)
      db.prepare('DELETE FROM event_statuses WHERE event_id IN (SELECT id FROM events WHERE calendar_id = ?)').run(id)
      // Events are removed by ON DELETE CASCADE.
      db.prepare('DELETE FROM calendars WHERE id = ?').run(id)
    })()
  }
}
