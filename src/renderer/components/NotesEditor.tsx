import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Note } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../utils/errors'
import { Button, inputClass, Spinner } from './ui'

const AUTOSAVE_DELAY_MS = 800

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/**
 * Markdown meeting notes for one event.
 *
 * Editing model: click the note (or "Edit note") to edit; changes autosave while
 * typing and are flushed when leaving edit mode, switching to another event, or
 * closing the panel. Each save is bound to the event id it was typed for, so a
 * pending save can never land on a different event.
 *
 * Rendering: react-markdown does not render raw HTML, so notes can't inject
 * scripts; links open in the system browser (main-process window-open handler).
 */
export function NotesEditor({ eventId }: { eventId: string }) {
  const notify = useAppStore((s) => s.notify)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Refs give the unmount/switch flush access to the latest values.
  const draftRef = useRef('')
  const savedContentRef = useRef('')
  const timerRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** Persists `content` for `forEventId`. Empty content deletes the note. */
  const persist = useCallback(
    async (forEventId: string, content: string): Promise<boolean> => {
      if (content === savedContentRef.current && forEventId === eventId) return true
      setSaveState('saving')
      try {
        if (content.trim() === '') {
          await window.api.notes.remove(forEventId)
          if (forEventId === eventId) setNote(null)
        } else {
          const saved = await window.api.notes.save(forEventId, content)
          if (forEventId === eventId) setNote(saved)
        }
        if (forEventId === eventId) savedContentRef.current = content
        setSaveState('saved')
        return true
      } catch (err) {
        setSaveState('error')
        notify(`Note not saved: ${errorMessage(err)}`, 'error')
        return false
      }
    },
    [eventId, notify]
  )

  const cancelTimer = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  // Load the note whenever the event changes; flush unsaved text of the previous one first.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEditing(false)
    setSaveState('idle')
    window.api.notes
      .get(eventId)
      .then((n) => {
        if (cancelled) return
        setNote(n)
        savedContentRef.current = n?.content ?? ''
        draftRef.current = n?.content ?? ''
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        notify(errorMessage(err), 'error')
        setLoading(false)
      })

    return () => {
      cancelled = true
      cancelTimer()
      // Flush pending edits for *this* event before switching away / unmounting.
      const pending = draftRef.current
      if (pending !== savedContentRef.current) {
        const save = pending.trim() === '' ? window.api.notes.remove(eventId) : window.api.notes.save(eventId, pending)
        save.catch((err) => notify(`Note not saved: ${errorMessage(err)}`, 'error'))
      }
    }
  }, [eventId, notify])

  const startEditing = (): void => {
    const content = note?.content ?? ''
    setDraft(content)
    draftRef.current = content
    setSaveState('idle')
    setEditing(true)
  }

  // Focus the textarea with the caret at the end when entering edit mode.
  useEffect(() => {
    if (!editing) return
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  }, [editing])

  const onChange = (value: string): void => {
    setDraft(value)
    draftRef.current = value
    setSaveState('pending')
    cancelTimer()
    const forEventId = eventId
    timerRef.current = window.setTimeout(() => void persist(forEventId, value), AUTOSAVE_DELAY_MS)
  }

  const finishEditing = async (): Promise<void> => {
    cancelTimer()
    const ok = await persist(eventId, draftRef.current)
    if (ok) setEditing(false)
  }

  const remove = async (): Promise<void> => {
    const ok = await askConfirm({
      title: 'Delete note?',
      message: 'This meeting note will be permanently deleted.',
      confirmLabel: 'Delete note',
      danger: true
    })
    if (!ok) return
    cancelTimer()
    try {
      await window.api.notes.remove(eventId)
      setNote(null)
      setDraft('')
      draftRef.current = ''
      savedContentRef.current = ''
      setEditing(false)
      setSaveState('idle')
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  const statusText: Record<SaveState, string> = {
    idle: 'Markdown supported',
    pending: 'Typing…',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Not saved, check the error message'
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Meeting notes</h3>
        {!editing && !loading && note && (
          <div className="flex gap-1.5">
            <Button className="px-2.5! py-1! text-xs" onClick={startEditing}>
              Edit note
            </Button>
            <Button variant="danger" className="px-2.5! py-1! text-xs" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <Spinner className="text-slate-500" />
      ) : editing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            className={`${inputClass} min-h-56 resize-y font-mono text-[13px] leading-relaxed`}
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => {
              // Save when focus leaves the editor (but not when clicking its own buttons).
              if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
                cancelTimer()
                void persist(eventId, draftRef.current)
              }
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                cancelTimer()
                void persist(eventId, draftRef.current)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                void finishEditing()
              }
            }}
            placeholder={'# Agenda\n- [ ] Item one\n\n**Decisions**\n...'}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs ${saveState === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
              {saveState === 'saving' && <Spinner className="mr-1 h-2.5! w-2.5! align-[-1px]" />}
              {statusText[saveState]} · saves automatically
            </span>
            <Button variant="primary" onClick={() => void finishEditing()}>
              Done
            </Button>
          </div>
        </div>
      ) : note ? (
        <div
          role="button"
          tabIndex={0}
          title="Click to edit"
          onClick={(e) => {
            // Let links work normally; anything else starts editing.
            if ((e.target as HTMLElement).closest('a')) return
            startEditing()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') startEditing()
          }}
          className="group cursor-text rounded-lg border border-transparent p-2 -m-2 hover:border-slate-700 hover:bg-slate-800/60"
        >
          <div className="markdown selectable">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
            >
              {note.content}
            </Markdown>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Updated {new Date(note.updatedAt).toLocaleString()}
            <span className="opacity-0 group-hover:opacity-100"> · click to edit</span>
          </p>
        </div>
      ) : (
        <button
          onClick={startEditing}
          className="w-full rounded-lg border border-dashed border-slate-700 px-3 py-6 text-sm text-slate-500 hover:border-slate-500 hover:text-slate-200"
        >
          + Add meeting notes
        </button>
      )}
    </section>
  )
}
