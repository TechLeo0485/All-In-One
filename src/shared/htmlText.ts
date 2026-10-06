/**
 * Some invites (Google, scheduling tools like GoodTime/Calendly) put HTML in the
 * event DESCRIPTION. The details panel renders a safe subset of it (renderer's
 * richText.tsx); everywhere else (search, snippets, meeting link detection) uses
 * this plain-text version. Regex-based so it also runs in the main process.
 */

const HTML_TAG_RE = /<\/?(?:br|p|div|span|a|b|strong|i|em|u|ul|ol|li|table|tbody|tr|td|th|h[1-6]|font|hr|blockquote)\b[^>]*>/i

/** True when the text contains HTML markup (not just a stray "<" or ">"). */
export function looksLikeHtml(text: string): boolean {
  return HTML_TAG_RE.test(text)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

/** HTML description -> readable plain text (line breaks kept, tags removed). Plain text is returned as is. */
export function htmlToPlainText(text: string): string {
  if (!looksLikeHtml(text)) return text
  return decodeEntities(
    text
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/\s+/g, ' ') // HTML collapses whitespace; real line breaks come from tags
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|li|tr|h[1-6]|ul|ol|table|blockquote|hr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
