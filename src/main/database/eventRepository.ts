import { randomUUID } from 'node:crypto'
import type { CalendarEvent, LocalEventInput } from '@shared/types'
import { getDb } from './connection'

interface EventRow {
  id: string
  calendar_id: string | null
  external_id: string | null
  title: string
  description: string
  start_time: string
  end_time: string
  all_day: number
  location: string
  is_local_event: number
  color: string | null
  reminder_minutes: number | null
  created_at: string
}

/** Event shape produced by the ICS parser, before it is stored. */
export interface SyncedEventData {
  id: string
  externalId: string
  title: string
  description: string
  startTime: string
  endTime: string
  allDay: boolean
  location: string
}

function toEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    externalId: row.external_id,
    title: row.title,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    allDay: row.all_day === 1,
    location: row.location,
    isLocalEvent: row.is_local_event === 1,
    color: row.color,
    reminderMinutes: row.reminder_minutes,
    createdAt: row.created_at
  }
}

export const eventRepository = {
  /**
   * Returns events overlapping [start, end). Timed events are stored as ISO UTC
   * strings and all-day events as YYYY-MM-DD, both of which sort correctly as
   * text; the renderer always requests a padded range so the ≤1 day imprecision
   * at the boundaries for all-day events doesn't matter.
   */
  listInRange(start: string, end: string): CalendarEvent[] {
    const rows = getDb()
      .prepare('SELECT * FROM events WHERE start_time < ? AND end_time > ? ORDER BY start_time')
      .all(end, start) as EventRow[]
    return rows.map(toEvent)
  },

  get(id: string): CalendarEvent | null {
    const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined
    return row ? toEvent(row) : null
  },

  listLocalWithReminders(): CalendarEvent[] {
    const rows = getDb()
      .prepare('SELECT * FROM events WHERE is_local_event = 1 AND reminder_minutes IS NOT NULL')
      .all() as EventRow[]
    return rows.map(toEvent)
  },

  createLocal(input: LocalEventInput): CalendarEvent {
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO events (id, calendar_id, external_id, title, description, start_time, end_time,
                             all_day, location, is_local_event, color, reminder_minutes, created_at)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.description,
        input.startTime,
        input.endTime,
        input.allDay ? 1 : 0,
        input.location,
        input.color,
        input.reminderMinutes,
        new Date().toISOString()
      )
    return this.get(id)!
  },

  updateLocal(id: string, input: LocalEventInput): CalendarEvent {
    const result = getDb()
      .prepare(
        `UPDATE events SET title = ?, description = ?, start_time = ?, end_time = ?, all_day = ?,
                           location = ?, color = ?, reminder_minutes = ?
         WHERE id = ? AND is_local_event = 1`
      )
      .run(
        input.title,
        input.description,
        input.startTime,
        input.endTime,
        input.allDay ? 1 : 0,
        input.location,
        input.color,
        input.reminderMinutes,
        id
      )
    if (result.changes === 0) throw new Error('Local event not found')
    return this.get(id)!
  },

  removeLocal(id: string): void {
    const db = getDb()
    db.transaction(() => {
      const result = db.prepare('DELETE FROM events WHERE id = ? AND is_local_event = 1').run(id)
      if (result.changes === 0) throw new Error('Local event not found')
      db.prepare('DELETE FROM notes WHERE event_id = ?').run(id)
    })()
  },

  /**
   * Replaces the cached contents of one calendar with a fresh feed snapshot in a
   * single transaction: upsert everything we received, then delete what's gone.
   * Upserting (instead of delete-all + insert) keeps created_at stable.
   */
  replaceCalendarEvents(calendarId: string, events: SyncedEventData[]): void {
    const db = getDb()
    const upsert = db.prepare(
      `INSERT INTO events (id, calendar_id, external_id, title, description, start_time, end_time,
                           all_day, location, is_local_event, created_at)
       VALUES (@id, @calendarId, @externalId, @title, @description, @startTime, @endTime,
               @allDay, @location, 0, @createdAt)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title, description = excluded.description,
         start_time = excluded.start_time, end_time = excluded.end_time,
         all_day = excluded.all_day, location = excluded.location`
    )
    const now = new Date().toISOString()

    db.transaction(() => {
      db.exec('CREATE TEMP TABLE IF NOT EXISTS sync_keep (id TEXT PRIMARY KEY)')
      db.exec('DELETE FROM sync_keep')
      const keep = db.prepare('INSERT OR IGNORE INTO sync_keep (id) VALUES (?)')

      for (const e of events) {
        upsert.run({ ...e, calendarId, allDay: e.allDay ? 1 : 0, createdAt: now })
        keep.run(e.id)
      }
      db.prepare('DELETE FROM events WHERE calendar_id = ? AND id NOT IN (SELECT id FROM sync_keep)').run(
        calendarId
      )
      db.exec('DELETE FROM sync_keep')
    })()
  }
}
