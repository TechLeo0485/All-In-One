import type { ReactNode } from 'react'

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi

/**
 * Turns URLs in plain text into links. Returns React nodes (no HTML parsing),
 * so event text from feeds can't inject markup. Links open in the system browser
 * via the main process window-open handler.
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    nodes.push(
      <a key={start} href={match[0]} target="_blank" rel="noreferrer" className="text-blue-400 underline break-all">
        {match[0]}
      </a>
    )
    last = start + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
