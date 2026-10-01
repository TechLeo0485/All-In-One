import { randomUUID } from 'node:crypto'
import type { Note } from '@shared/types'
import { getDb } from './connection'

interface NoteRow {
  id: string
  event_id: string
  content: string
  updated_at: string
}

function toNote(row: NoteRow): Note {
  return { id: row.id, eventId: row.event_id, content: row.content, updatedAt: row.updated_at }
}

/** One markdown note per event (enforced by the UNIQUE constraint on event_id). */
export const noteRepository = {
  getForEvent(eventId: string): Note | null {
    const row = getDb().prepare('SELECT * FROM notes WHERE event_id = ?').get(eventId) as NoteRow | undefined
    return row ? toNote(row) : null
  },

  save(eventId: string, content: string): Note {
    getDb()
      .prepare(
        `INSERT INTO notes (id, event_id, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (event_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      )
      .run(randomUUID(), eventId, content, new Date().toISOString())
    return this.getForEvent(eventId)!
  },

  remove(eventId: string): void {
    getDb().prepare('DELETE FROM notes WHERE event_id = ?').run(eventId)
  }
}
