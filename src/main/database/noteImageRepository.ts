import { randomUUID } from 'node:crypto'
import { NOTE_IMAGE_SCHEME } from '@shared/noteImages'
import { getDb } from './connection'

/** Images pasted or dropped into notes (see @shared/noteImages). */
export const noteImageRepository = {
  add(mimeType: string, data: Buffer): string {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO note_images (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)')
      .run(id, mimeType, data, new Date().toISOString())
    return id
  },

  get(id: string): { mimeType: string; data: Buffer } | null {
    const row = getDb().prepare('SELECT mime_type, data FROM note_images WHERE id = ?').get(id) as
      | { mime_type: string; data: Buffer }
      | undefined
    return row ? { mimeType: row.mime_type, data: row.data } : null
  },

  /**
   * Deletes images no note refers to any more (removed from the text, or the note or
   * its event was deleted). Run at startup only, so undo while editing keeps working.
   */
  removeUnused(): number {
    return getDb()
      .prepare(
        `DELETE FROM note_images WHERE NOT EXISTS (
           SELECT 1 FROM notes WHERE instr(notes.content, '${NOTE_IMAGE_SCHEME}://' || note_images.id) > 0
         )`
      )
      .run().changes
  }
}
