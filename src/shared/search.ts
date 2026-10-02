/**
 * Text matching for event search, shared by the main process (finding events) and
 * the renderer (highlighting matches). Matching ignores case and accents, so
 * "cafe" finds "Café" and "MEETING" finds "meeting".
 */

/** Longer queries are cut to this many words. */
const MAX_TERMS = 8

/** Lower case without accents. Can change the length of the text, see foldWithMap(). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Guest names and emails as plain text: "Alice Smith alice@corp.com, bob@corp.com". */
export function guestsText(attendees: { name: string; email: string }[]): string {
  return attendees.map((a) => [a.name, a.email].filter(Boolean).join(' ')).join(', ')
}

/**
 * Folded text of an event's own fields, stored with the event (events.search_text)
 * so searching doesn't have to fold every event again. Notes and calendar names are
 * matched separately because they change independently of the event.
 */
export function eventSearchText(event: {
  title: string
  description: string
  location: string
  attendees: { name: string; email: string }[]
}): string {
  return foldText([event.title, event.description, event.location, guestsText(event.attendees)].join('\n'))
}

/** The words of a query, folded; every word must match somewhere in the event. */
export function searchTerms(query: string): string[] {
  return [...new Set(foldText(query).split(/\s+/).filter(Boolean))].slice(0, MAX_TERMS)
}

/** Folded text plus, for every folded character, its index in the original text. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const part = foldText(text[i])
    folded += part
    for (let k = 0; k < part.length; k++) map.push(i)
  }
  return { folded, map }
}

/** [start, end) ranges in `text` matching any term, sorted and merged. */
export function findMatches(text: string, terms: string[]): [number, number][] {
  if (!text || terms.length === 0) return []
  const { folded, map } = foldWithMap(text)
  const ranges: [number, number][] = []
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      ranges.push([map[at], map[at + term.length - 1] + 1])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** ~`width` characters of `text` around its first match, on one line. */
export function snippetAround(text: string, terms: string[], width = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const first = findMatches(flat, terms)[0]
  if (!first || flat.length <= width) return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
  const start = Math.max(0, Math.min(first[0] - Math.floor(width / 3), flat.length - width))
  const end = Math.min(flat.length, start + width)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}
