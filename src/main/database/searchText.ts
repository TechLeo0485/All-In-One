import type Database from 'better-sqlite3'
import { eventSearchText } from '@shared/search'

/**
 * Fills events.search_text where it is empty: right after the v7 upgrade, and for
 * rows written by an older app version (which doesn't know the column). Runs at
 * every start; when nothing is missing it is a single quick query.
 */
export function fillMissingSearchText(db: Database.Database): void {
  const rows = db
    .prepare(`SELECT id, title, description, location, attendees FROM events WHERE search_text = ''`)
    .all() as { id: string; title: string; description: string; location: string; attendees: string }[]
  if (rows.length === 0) return

  const update = db.prepare('UPDATE events SET search_text = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) {
      let attendees: { name: string; email: string }[] = []
      try {
        const parsed: unknown = JSON.parse(row.attendees)
        if (Array.isArray(parsed)) attendees = parsed
      } catch {
        // broken guest list: index the other fields
      }
      update.run(eventSearchText({ ...row, attendees }), row.id)
    }
  })()
  console.log(`[db] indexed ${rows.length} events for search`)
}
