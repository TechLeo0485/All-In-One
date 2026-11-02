/**
 * Images in meeting notes. The image itself is stored in the database; the note's
 * markdown refers to it as `![image](note-image://<id>)`, which the main process
 * serves through its own protocol (no files on disk, nothing loaded from the web).
 */

export const NOTE_IMAGE_SCHEME = 'note-image'

/** Image types notes accept (what Chromium can show and people paste or drop). */
export const NOTE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'] as const

/** Largest image a note accepts. */
export const MAX_NOTE_IMAGE_BYTES = 15 * 1024 * 1024

export function noteImageUrl(id: string): string {
  return `${NOTE_IMAGE_SCHEME}://${id}`
}

export function noteImageMarkdown(id: string): string {
  return `![image](${noteImageUrl(id)})`
}

const NOTE_IMAGE_RE = new RegExp(`!\\[[^\\]]*\\]\\(${NOTE_IMAGE_SCHEME}://[^)]*\\)`, 'g')

/** Note text without its image references (for search and previews). */
export function stripNoteImages(text: string): string {
  return text.replace(NOTE_IMAGE_RE, '')
}
