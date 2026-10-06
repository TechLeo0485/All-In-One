import type { ReactNode } from 'react'
import { looksLikeHtml } from '@shared/htmlText'
import { linkify } from './linkify'

/**
 * Renders an event description: plain text with clickable URLs, or, when the feed
 * sent HTML, a safe subset of it (bold, italics, links, line breaks, paragraphs,
 * lists). The HTML is parsed with DOMParser (an inert document: no scripts run,
 * nothing loads) and rebuilt as React elements from an allowlist, so feed markup
 * can never inject attributes, styles or scripts. Anything else keeps only its text.
 */

/** A line of only dashes/underscores/equals ("--------") is drawn as a divider. */
const DIVIDER_RE = /^\s*[-_=–—]{8,}\s*$/
/** Same, but inside running HTML text (dividers there usually sit between <br>s). */
const INLINE_DIVIDER_RE = /[-_=–—]{8,}/g

const SAFE_HREF_RE = /^(https?:|mailto:)/i
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BLOCKQUOTE', 'TABLE', 'TBODY', 'CENTER'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'IMG', 'svg', 'IFRAME', 'OBJECT', 'TEMPLATE', 'NOSCRIPT'])
/** Consecutive <br>s beyond this are dropped (feeds often stack 4–5 of them). */
const MAX_BREAKS = 2

const divider = (key: string | number): ReactNode => <hr key={key} className="my-2 border-slate-700" />

export function renderDescription(text: string): ReactNode {
  if (looksLikeHtml(text)) {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${text}</body></html>`, 'text/html')
    return <div className="leading-relaxed">{renderChildren(doc.body, 'r')}</div>
  }
  return <div className="whitespace-pre-wrap">{renderPlain(text)}</div>
}

/** Plain text: links + divider lines. */
function renderPlain(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let buffer: string[] = []
  const flush = (key: number): void => {
    if (buffer.length) out.push(<span key={`t${key}`}>{linkify(buffer.join('\n'))}</span>)
    buffer = []
  }
  text.split('\n').forEach((line, i) => {
    if (DIVIDER_RE.test(line)) {
      flush(i)
      out.push(divider(i))
    } else buffer.push(line)
  })
  flush(-1)
  return out
}

const BLOCK_LIKE = new Set([...BLOCK_TAGS, 'HR', 'UL', 'OL', 'LI'])

/** Whether a node ends on its own line (a block, or text ending in a divider). */
function endsWithBlock(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return /[-_=–—]{8,}\s*$/.test(node.textContent ?? '')
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_LIKE.has((node as Element).tagName.toUpperCase())
}

function renderChildren(parent: Node, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let breaks = 0
  let afterBlock = false
  parent.childNodes.forEach((node, i) => {
    const key = `${keyPrefix}.${i}`
    if (node.nodeName === 'BR') {
      // A block already starts a new line, and long runs of <br> just add empty space.
      if (!afterBlock && ++breaks <= MAX_BREAKS) out.push(<br key={key} />)
      return
    }
    const rendered = renderNode(node, key)
    if (rendered === null) return
    out.push(rendered)
    // Whitespace-only text between <br>s doesn't end a run of breaks.
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) return
    breaks = 0
    afterBlock = endsWithBlock(node)
  })
  return out
}

function renderText(text: string, key: string): ReactNode {
  const collapsed = text.replace(/\s+/g, ' ')
  if (!collapsed.trim()) return collapsed ? ' ' : null
  // Dividers inside text become rules; the rest gets clickable URLs.
  const parts = collapsed.split(INLINE_DIVIDER_RE)
  if (parts.length === 1) return <span key={key}>{linkify(collapsed)}</span>
  return (
    <span key={key}>
      {parts.flatMap((part, i) => [
        ...(i > 0 ? [divider(`d${i}`)] : []),
        ...(part.trim() ? [<span key={`p${i}`}>{linkify(part.trim())}</span>] : [])
      ])}
    </span>
  )
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return renderText(node.textContent ?? '', key)
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag) || SKIP_TAGS.has(el.tagName)) return null
  const children = (): ReactNode[] => renderChildren(el, key)

  switch (tag) {
    case 'A': {
      const href = el.getAttribute('href')?.trim() ?? ''
      if (!SAFE_HREF_RE.test(href)) return <span key={key}>{children()}</span>
      const label = el.textContent?.trim()
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="break-all text-blue-400 underline">
          {label || href}
        </a>
      )
    }
    case 'B':
    case 'STRONG':
      return (
        <strong key={key} className="font-semibold text-slate-100">
          {children()}
        </strong>
      )
    case 'I':
    case 'EM':
      return <em key={key}>{children()}</em>
    case 'U':
      return <u key={key}>{children()}</u>
    case 'HR':
      return divider(key)
    case 'UL':
      return (
        <ul key={key} className="my-1 list-disc pl-5">
          {children()}
        </ul>
      )
    case 'OL':
      return (
        <ol key={key} className="my-1 list-decimal pl-5">
          {children()}
        </ol>
      )
    case 'LI':
      return <li key={key}>{children()}</li>
    case 'TD':
    case 'TH':
      return <span key={key}>{children()} </span>
    default:
      if (BLOCK_TAGS.has(tag)) return <div key={key}>{children()}</div>
      return <span key={key}>{children()}</span> // span, font, etc.: keep the text, drop the styling
  }
}
