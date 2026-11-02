import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MAX_NOTE_IMAGE_BYTES, NOTE_IMAGE_SCHEME, NOTE_IMAGE_TYPES, noteImageMarkdown } from '@shared/noteImages'
import type { Note } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../utils/errors'
import { ImageViewer } from './ImageViewer'
import { Button, inputClass, Spinner } from './ui'

const AUTOSAVE_DELAY_MS = 800

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/** Dropped files that are read as text and put into the note. */
const TEXT_FILE_RE = /\.(txt|md|markdown|csv|tsv|log|json)$/i
const MAX_TEXT_FILE_BYTES = 1024 * 1024

/** react-markdown drops unknown URL schemes; let note images through. */
const urlTransform = (url: string): string =>
  url.startsWith(`${NOTE_IMAGE_SCHEME}://`) ? url : defaultUrlTransform(url)

const isImageFile = (file: File): boolean => file.type.startsWith('image/')
const isTextFile = (file: File): boolean => file.type.startsWith('text/') || TEXT_FILE_RE.test(file.name)

/** Markdown for one pasted/dropped file: the stored image, or the text file's contents. */
async function fileToMarkdown(file: File): Promise<string> {
  if (isImageFile(file)) {
    if (!(NOTE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      throw new Error(`${file.name || 'This image'}: only PNG, JPEG, GIF, WebP and BMP images can be added`)
    }
    if (file.size > MAX_NOTE_IMAGE_BYTES) {
      throw new Error(`${file.name || 'This image'} is too big (at most ${MAX_NOTE_IMAGE_BYTES / 1024 / 1024} MB)`)
    }
    const id = await window.api.notes.addImage(new Uint8Array(await file.arrayBuffer()), file.type)
    return noteImageMarkdown(id)
  }
  if (isTextFile(file)) {
    if (file.size > MAX_TEXT_FILE_BYTES) throw new Error(`${file.name} is too big to add as text (at most 1 MB)`)
    return (await file.text()).trimEnd()
  }
  throw new Error(`${file.name}: only images and text files can be added to a note`)
}

/** Image URLs of a note, in order (for stepping through them in the viewer). */
const imageUrls = (markdown: string): string[] =>
  Array.from(markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g), (m) => urlTransform(m[1])).filter(Boolean)

const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

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
 *
 * Images: pasted (Ctrl+V), dropped or picked with "Add image", they are stored by
 * the main process and the note gets a `![image](note-image://<id>)` line at the
 * caret. Dropped text files are put in as text. Dropping onto the note while not
 * editing starts editing and adds to the end.
 */
export function NotesEditor({ eventId }: { eventId: string }) {
  const notify = useAppStore((s) => s.notify)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  /** Images being stored (paste/drop/Add image), shown as "Adding image…". */
  const [adding, setAdding] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  /** Image open in the full-window viewer. */
  const [viewing, setViewing] = useState<{ images: string[]; start: number } | null>(null)

  // Refs give the unmount/switch flush access to the latest values.
  const draftRef = useRef('')
  const savedContentRef = useRef('')
  const timerRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Images are stored asynchronously; these tell where the result goes once it's back.
  const eventIdRef = useRef(eventId)
  const editingRef = useRef(false)
  const noteRef = useRef<Note | null>(null)
  useEffect(() => {
    eventIdRef.current = eventId
    editingRef.current = editing
    noteRef.current = note
  })

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
    setViewing(null)
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

  /**
   * Puts blocks (image lines, text) into the note of `forEventId`, each on its own
   * lines: at the caret while editing, otherwise at the end (and starts editing).
   * Dropped if the user moved on to another event meanwhile.
   */
  const insertBlocks = (forEventId: string, blocks: string[]): void => {
    if (forEventId !== eventIdRef.current || blocks.length === 0) return
    const text = blocks.join('\n\n')
    const ta = textareaRef.current
    if (editingRef.current && ta) {
      const value = draftRef.current
      const before = value.slice(0, ta.selectionStart)
      const after = value.slice(ta.selectionEnd)
      const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
      const trail = after === '' ? '\n' : after.startsWith('\n') ? '' : '\n\n'
      const inserted = lead + text + trail
      onChange(before + inserted + after)
      const caret = before.length + inserted.length
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(caret, caret)
      })
    } else {
      const content = noteRef.current?.content ?? ''
      const lead = content.trim() === '' ? '' : content.endsWith('\n') ? '\n' : '\n\n'
      setEditing(true)
      onChange((content.trim() === '' ? '' : content) + lead + text + '\n')
    }
  }

  const addFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const forEventId = eventId
    setAdding((n) => n + 1)
    const blocks: string[] = []
    for (const file of files) {
      try {
        const block = await fileToMarkdown(file)
        if (block) blocks.push(block)
      } catch (err) {
        notify(errorMessage(err), 'error')
      }
    }
    setAdding((n) => n - 1)
    insertBlocks(forEventId, blocks)
  }

  const onDragOver = (e: DragEvent): void => {
    if (loading) return
    // Text dragged onto the textarea is handled by the textarea itself.
    if (!hasFiles(e) && (e.target === textareaRef.current || !e.dataTransfer.types.includes('text/plain'))) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onDrop = (e: DragEvent): void => {
    setDragOver(false)
    if (loading) return
    if (hasFiles(e)) {
      e.preventDefault()
      void addFiles(Array.from(e.dataTransfer.files))
      return
    }
    const text = e.dataTransfer.getData('text/plain')
    if (text && e.target !== textareaRef.current) {
      e.preventDefault()
      insertBlocks(eventId, [text])
    }
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
    <section
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
      className={`-m-1.5 rounded-lg p-1.5 ${dragOver ? 'bg-blue-500/10 ring-2 ring-blue-500/60' : ''}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={NOTE_IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // picking the same file again still fires onChange
          void addFiles(files)
        }}
      />
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
            onPaste={(e) => {
              // Text wins: cells copied from Excel or Word also carry a picture of themselves.
              if (e.clipboardData.getData('text/plain')) return
              const files = Array.from(e.clipboardData.files)
              if (files.length === 0) return
              e.preventDefault()
              void addFiles(files)
            }}
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
            <span className={`text-xs ${saveState === 'error' && !adding ? 'text-red-400' : 'text-slate-500'}`}>
              {(saveState === 'saving' || adding > 0) && <Spinner className="mr-1 h-2.5! w-2.5! align-[-1px]" />}
              {adding > 0 ? 'Adding image…' : `${statusText[saveState]} · saves automatically`}
            </span>
            <div className="flex gap-1.5">
              <Button title="Or paste with Ctrl+V, or drop images here" onClick={() => fileInputRef.current?.click()}>
                Add image
              </Button>
              <Button variant="primary" onClick={() => void finishEditing()}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : note ? (
        <div
          role="button"
          tabIndex={0}
          title="Click to edit"
          onClick={(e) => {
            // Let links work normally; images open in the viewer; anything else starts editing.
            const target = e.target as HTMLElement
            if (target.closest('a')) return
            if (target instanceof HTMLImageElement) {
              const src = target.getAttribute('src') ?? ''
              const images = imageUrls(note.content)
              setViewing({ images: images.includes(src) ? images : [src], start: Math.max(0, images.indexOf(src)) })
              return
            }
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
              urlTransform={urlTransform}
              components={{
                a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
                img: ({ node: _node, ...props }) => <img {...props} loading="lazy" draggable={false} />
              }}
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
      {/* Outside the note's click area: clicks in the viewer would otherwise bubble there and start editing. */}
      {viewing && <ImageViewer images={viewing.images} start={viewing.start} onClose={() => setViewing(null)} />}
    </section>
  )
}
