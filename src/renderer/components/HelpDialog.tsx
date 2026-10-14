import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { APP_NAME } from '@shared/brand'
import type { WhatsNew } from '@shared/types'
import { compareVersions } from '@shared/version'
import guideText from '../../../docs/HELP.md?raw'
import { useAppStore, type HelpTab } from '../stores/appStore'
import { releaseNotes } from '../utils/changelog'
import { Button, Modal } from './ui'

/**
 * Help popup, opened by clicking the logo in the sidebar: the setup guide
 * (docs/HELP.md) and the release notes (CHANGELOG.md), both bundled into the app.
 * After an update it opens by itself on "What's new", once.
 */
export function HelpDialog() {
  const tab = useAppStore((s) => s.helpTab)
  const setTab = useAppStore((s) => s.setHelpTab)
  const [version, setVersion] = useState<string | null>(null)
  /** Set after an update; kept for this session so the new versions stay marked. */
  const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null)
  const [seenPending, setSeenPending] = useState(false)

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version), () => undefined)
    window.api.app.whatsNew().then(
      (w) => {
        if (!w) return
        setWhatsNew(w)
        setSeenPending(true)
        setTab('whats-new')
      },
      () => undefined
    )
  }, [setTab])

  if (!tab) return null

  const close = (): void => {
    setTab(null)
    if (seenPending) {
      setSeenPending(false)
      void window.api.app.whatsNewSeen()
    }
  }

  return (
    <Modal title={whatsNew && seenPending ? `${APP_NAME} was updated` : `${APP_NAME} help`} width="max-w-3xl" onClose={close}>
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 mb-4 flex gap-1 border-b border-slate-800 bg-slate-900 px-5 pt-2">
        <TabButton tab="guide" current={tab} onSelect={setTab}>
          Guide
        </TabButton>
        <TabButton tab="whats-new" current={tab} onSelect={setTab}>
          What's new
        </TabButton>
        {version && <span className="ml-auto self-center pb-1 text-xs text-slate-500">Version {version}</span>}
      </div>
      {/* Keyed so switching tabs starts at the top */}
      <div key={tab} className="min-h-[50vh]">
        {tab === 'guide' ? <Guide /> : version && <ReleaseList version={version} whatsNew={whatsNew} onDone={close} />}
      </div>
    </Modal>
  )
}

function TabButton({
  tab,
  current,
  onSelect,
  children
}: {
  tab: HelpTab
  current: HelpTab
  onSelect: (tab: HelpTab) => void
  children: ReactNode
}) {
  const active = tab === current
  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function Guide() {
  const ref = useRef<HTMLDivElement>(null)
  // Headings get GitHub-style ids so the guide's "#google-calendar" links work.
  const components = useMemo<Components>(() => {
    const heading =
      (Tag: 'h1' | 'h2' | 'h3' | 'h4') =>
      ({ children }: { children?: ReactNode }) => <Tag id={slug(textOf(children))}>{children}</Tag>
    return {
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      h4: heading('h4'),
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            // In-page links scroll the popup; web links open in the browser (main-process handler).
            if (!href?.startsWith('#')) return
            e.preventDefault()
            ref.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' })
          }}
        >
          {children}
        </a>
      )
    }
  }, [])

  return (
    <div ref={ref} className="markdown help-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {guideText}
      </Markdown>
    </div>
  )
}

function ReleaseList({ version, whatsNew, onDone }: { version: string; whatsNew: WhatsNew | null; onDone: () => void }) {
  const releases = useMemo(() => releaseNotes(version), [version])
  /** Versions added by the update: newer than the previous one, or just the latest if that's unknown. */
  const isNew = (v: string): boolean =>
    !!whatsNew && (whatsNew.from ? compareVersions(v, whatsNew.from) > 0 : v === releases[0]?.version)

  if (!releases.length) return <p className="text-sm text-slate-400">No release notes yet.</p>

  return (
    <div className="space-y-6">
      {whatsNew && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm">
          <p className="flex-1 text-slate-200">
            {whatsNew.from ? (
              <>
                Updated from <span className="font-medium text-white">{whatsNew.from}</span> to{' '}
                <span className="font-medium text-white">{whatsNew.to}</span>. Here's what changed.
              </>
            ) : (
              <>
                You're now on <span className="font-medium text-white">{whatsNew.to}</span>. Here's what changed.
              </>
            )}
          </p>
          <Button variant="primary" onClick={onDone}>
            Got it
          </Button>
        </div>
      )}
      {releases.map((r) => (
        <section key={r.version}>
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-white">
            Version {r.version}
            {r.version === version && <Badge className="bg-slate-700 text-slate-200">Installed</Badge>}
            {isNew(r.version) && <Badge className="bg-blue-500 text-white">New</Badge>}
          </h3>
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{r.notes}</Markdown>
          </div>
        </section>
      ))}
    </div>
  )
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>
}

/** Plain text of rendered markdown children (headings may contain bold or code). */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children)
      return ''
    })
    .join('')
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to dashes. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}
