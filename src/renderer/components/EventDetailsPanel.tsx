import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { AttendeeStatus, CalendarEvent, CallerCandidate, CallerEventShare, EventAttendee, TeamworkInterview } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, DEFAULT_IMPORTANT_COLOR, findStatus, FOLLOW_UP_ID } from '@shared/eventStatus'
import { findMeetingUrl } from '@shared/meetingLink'
import { describeRecurrence } from '@shared/recurrence'
import { useAppStore } from '../stores/appStore'
import { useEventDetails } from '../hooks/useEventDetails'
import {
  addDays,
  formatEventWhen,
  formatInDisplayZone,
  formatReminder,
  fromLocalInputValue,
  todayString,
  toLocalInputValue,
  zonedDateString
} from '../utils/dates'
import { linkify } from '../utils/linkify'
import { renderDescription } from '../utils/richText'
import { errorMessage } from '../utils/errors'
import { placeNextTo } from '../utils/placement'
import { BellIcon, ClockIcon, CloudUploadIcon, DownloadIcon, ExternalIcon, LinkIcon, LockIcon, MapPinIcon, RepeatIcon, StarIcon, UsersIcon, XIcon } from './icons'
import { NotesEditor } from './NotesEditor'
import { Button, ColorDot, isModalOpen, Spinner } from './ui'

/** Long guest lists start collapsed to keep the notes editor in view. */
const GUESTS_COLLAPSED = 8

const STATUS_STYLE: Record<AttendeeStatus, { mark: string; className: string; label: string }> = {
  accepted: { mark: '✓', className: 'bg-emerald-500/20 text-emerald-300', label: 'Accepted' },
  tentative: { mark: '?', className: 'bg-amber-500/20 text-amber-300', label: 'Maybe' },
  declined: { mark: '✕', className: 'bg-red-500/20 text-red-300', label: 'Declined' },
  'needs-action': { mark: '•', className: 'bg-slate-700 text-slate-400', label: 'Awaiting reply' }
}

function guestSummary(attendees: EventAttendee[]): string {
  const count = (status: AttendeeStatus): number => attendees.filter((a) => a.status === status).length
  const parts = [
    [count('accepted'), 'yes'],
    [count('tentative'), 'maybe'],
    [count('declined'), 'no'],
    [count('needs-action'), 'awaiting']
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
  return `${attendees.length} ${attendees.length === 1 ? 'guest' : 'guests'} · ${parts.join(', ')}`
}

function GuestList({ attendees }: { attendees: EventAttendee[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? attendees : attendees.slice(0, GUESTS_COLLAPSED)

  return (
    <div className="space-y-2 pl-6 text-sm">
      <p className="flex items-center gap-2 text-slate-300">
        <UsersIcon className="shrink-0 text-slate-500" />
        {guestSummary(attendees)}
      </p>
      <ul className="space-y-1.5 pl-6">
        {visible.map((a) => {
          const style = STATUS_STYLE[a.status]
          const tags = [a.isOrganizer && 'Organizer', a.optional && 'Optional'].filter(Boolean).join(' · ')
          return (
            <li key={a.email || a.name} className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${style.className}`}
                title={style.label}
                aria-label={style.label}
              >
                {style.mark}
              </span>
              <span className="min-w-0">
                <span className="selectable block truncate text-slate-200" title={a.email}>
                  {a.name || a.email}
                </span>
                {(a.name && a.email) || tags ? (
                  <span className="selectable block truncate text-xs text-slate-500">
                    {[a.name && a.email, tags].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
      {attendees.length > GUESTS_COLLAPSED && (
        <button className="pl-6 text-xs text-blue-400 hover:underline" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${attendees.length} guests`}
        </button>
      )}
    </div>
  )
}

/** On/off mark for key events (e.g. final rounds): an outline in the color from Settings. Separate from the status. */
function ImportantToggle({ event }: { event: CalendarEvent }) {
  const setEventImportant = useAppStore((s) => s.setEventImportant)
  const color = useAppStore((s) => s.settings?.importantColor ?? DEFAULT_IMPORTANT_COLOR)
  return (
    <div className="pl-6">
      <button
        role="switch"
        aria-checked={event.important}
        title={event.important ? 'Click to remove the Important mark' : 'Outline this event on the calendar'}
        onClick={() => void setEventImportant(event.id, !event.important)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
          event.important ? 'font-medium text-slate-50' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
        }`}
        style={event.important ? { borderColor: color, backgroundColor: `${color}26` } : undefined}
      >
        <StarIcon size={12} stroke={color} fill={event.important ? color : 'none'} />
        Important
      </button>
    </div>
  )
}

/** Status chips from Settings; clicking the selected one again clears it. */
function StatusPicker({ event }: { event: CalendarEvent }) {
  const statuses = useAppStore((s) => s.settings?.eventStatuses ?? DEFAULT_EVENT_STATUSES)
  const setEventStatus = useAppStore((s) => s.setEventStatus)
  const setView = useAppStore((s) => s.setView)
  // A status deleted in Settings counts as none.
  const current = findStatus(statuses, event.status)?.id ?? null
  // Ended without a status: ask, like the notification 5 minutes after the end does.
  const ended = event.allDay ? event.endTime <= todayString() : new Date(event.endTime).getTime() <= Date.now()

  return (
    <div className="space-y-2">
      {ended && current === null && statuses.length > 0 && <p className="pl-6 text-xs font-medium text-sky-300">How did it go?</p>}
      <div className="flex flex-wrap gap-1.5 pl-6" role="radiogroup" aria-label="Status">
        {statuses.map((o) => {
          const selected = current === o.id
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={selected}
              title={selected ? 'Click again to clear the status' : undefined}
              onClick={() => void setEventStatus(event.id, selected ? null : o.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                selected ? 'font-medium text-slate-50' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
              style={selected ? { borderColor: o.color, backgroundColor: `${o.color}26` } : undefined}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />
              {o.label}
            </button>
          )
        })}
        <button
          className="px-1 text-xs text-slate-500 hover:text-slate-300 hover:underline"
          onClick={() => setView('settings')}
          title="Add, rename or recolor statuses"
        >
          {statuses.length ? 'Edit…' : 'Add statuses in Settings…'}
        </button>
      </div>
      {current === FOLLOW_UP_ID && <FollowUpReminder key={event.id} event={event} />}
    </div>
  )
}

/**
 * Shares just this event with a Teamwork profile, without sharing its calendar.
 * Shown only while signed in to Teamwork (the Teamwork page in the sidebar).
 */
function TeamworkShare({
  event,
  state,
  setState
}: {
  event: CalendarEvent
  state: CallerEventShare | null
  setState: (state: CallerEventShare) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!state?.signedIn) return null

  async function pick(profileId: string | null) {
    setBusy(true)
    setError(null)
    try {
      setState(await window.api.caller.shareEvent(event.id, profileId))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const info = state.teamwork && (
    <p className="flex flex-wrap items-center gap-2 text-slate-300">
      <span className="min-w-0 break-words">{state.teamwork.label}</span>
      <a href={state.teamwork.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline">
        <ExternalIcon size={11} /> Open on Teamwork
      </a>
    </p>
  )

  if (state.fromTeamwork) {
    return (
      <div className="space-y-1 pl-6 text-xs">
        <span className="text-slate-400">From Teamwork{state.workspaceName ? ` · ${state.workspaceName}` : ''} · read-only</span>
        {info}
      </div>
    )
  }

  return (
    <div className="space-y-1 pl-6 text-xs">
      {info}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-400">Teamwork{state.workspaceName ? ` · ${state.workspaceName}` : ''}</span>
        {state.calendarSharedWith ? (
          <span className="text-slate-300">Shared with {state.calendarSharedWith} (whole calendar)</span>
        ) : (
          <select
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            aria-label="Share this event with a profile"
            value={state.profileId ?? ''}
            disabled={busy || (state.profiles.length === 0 && !state.profileId)}
            onChange={(e) => void pick(e.target.value || null)}
          >
            <option value="">Not shared</option>
            {state.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                Share with {p.fullName}
              </option>
            ))}
          </select>
        )}
        {busy && <Spinner className="text-slate-500" />}
      </div>
      {state.profiles.length === 0 && !state.calendarSharedWith && !state.error && (
        <p className="text-slate-500">You don&apos;t work any profile in this workspace yet.</p>
      )}
      {(error ?? state.error) && <p className="text-red-300">{error ?? state.error}</p>}
    </div>
  )
}

/**
 * Teamwork details of the selected event, refreshed when Teamwork changes
 * (a new caller, a resume added). Null for local events and when signed out.
 */
function useTeamworkShare(eventId: string | null): [CallerEventShare | null, (state: CallerEventShare) => void] {
  const [state, setState] = useState<CallerEventShare | null>(null)
  useEffect(() => {
    setState(null)
    if (!eventId) return
    let alive = true
    const load = (): void => {
      window.api.caller
        .eventShare(eventId)
        .then((s) => alive && setState(s))
        .catch(() => alive && setState(null))
    }
    load()
    const off = window.api.caller.onChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [eventId])
  return [state, setState]
}

const CANDIDATE_STATUS: Record<CallerCandidate['status'], string> = {
  free: 'free',
  busy: 'busy then',
  unavailable: 'outside hours'
}

/**
 * Choosing the caller of a Teamwork interview, for members allowed to assign:
 * the callers as Teamwork ranks them (recommended first, with whether they're
 * free and how many interviews they have). A later round stays with the
 * earlier round's caller; the admin is asked before moving it.
 */
function CallerPicker({ interview, onDone }: { interview: TeamworkInterview; onDone: () => void }) {
  const askConfirm = useAppStore((s) => s.askConfirm)
  const [candidates, setCandidates] = useState<CallerCandidate[] | null>(null)
  const [choice, setChoice] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.caller
      .candidates(interview.id)
      .then((list) => {
        if (!alive) return
        setCandidates(list)
        setChoice(list.find((c) => c.recommended)?.userId ?? list[0]?.userId ?? '')
      })
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [interview.id])

  async function assign(callerId: string | null) {
    setBusy(true)
    setError(null)
    try {
      let result = await window.api.caller.assign(interview.id, callerId, false)
      if (!result.ok) {
        const ok = await askConfirm({ title: 'Move a later round?', message: result.locked, confirmLabel: 'Move it', danger: true })
        if (!ok) return
        result = await window.api.caller.assign(interview.id, callerId, true)
      }
      if (result.ok) onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (error && !candidates) return <p className="text-xs text-red-300">{error}</p>
  if (!candidates) return <Spinner className="text-slate-500" />
  if (candidates.length === 0) return <p className="text-xs text-slate-500">No callers in this workspace yet.</p>
  return (
    <div className="mt-1 space-y-1.5">
      <select
        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
        aria-label="Caller"
        value={choice}
        disabled={busy}
        onChange={(e) => setChoice(e.target.value)}
      >
        {candidates.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.recommended ? '★ ' : ''}
            {c.name}
            {c.level ? ` · L${c.level}` : ''} · {CANDIDATE_STATUS[c.status]} · {c.interviewCount} interview{c.interviewCount === 1 ? '' : 's'}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !choice || choice === interview.callerId}
          onClick={() => void assign(choice)}
          className="rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Assign
        </button>
        {interview.callerId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void assign(null)}
            className="rounded-md border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Unassign
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDone} className={linkClass}>
          Cancel
        </button>
        {busy && <Spinner className="text-slate-500" />}
      </div>
      <p className="text-[0.7rem] text-slate-500">★ is Teamwork&apos;s recommendation. The caller gets a notification.</p>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}

const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Who is on a Teamwork interview, at the top of the card: the caller (or
 * "You"), the profile they speak as and its bidders, the round, and the resume
 * an owner added, to save on this computer.
 */
function WhoJoins({ interview }: { interview: TeamworkInterview }) {
  const [choosing, setChoosing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingLink, setEditingLink] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { caller, resume, link } = interview
  const canManage = interview.canUploadResume

  async function download() {
    setSaving(true)
    setMessage(null)
    try {
      const path = await window.api.caller.downloadResume(interview.id)
      if (path) setMessage(`Saved to ${path}`)
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function upload() {
    setUploading(true)
    setMessage(null)
    try {
      const name = await window.api.caller.uploadResume(interview.id)
      if (name) setMessage(`${name} added. The caller can download it now.`)
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  async function saveLink(url: string | null) {
    setLinkBusy(true)
    setMessage(null)
    try {
      await window.api.caller.shareLink(interview.id, url)
      setEditingLink(false)
      setLinkDraft('')
      setMessage(url ? 'Link shared with everyone on this interview.' : 'Link removed.')
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setLinkBusy(false)
    }
  }

  const chip =
    'inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:border-slate-500 hover:text-white disabled:opacity-60'
  const uploadButton = canManage && (
    <button
      type="button"
      onClick={() => void upload()}
      disabled={uploading}
      className={chip}
      title="Add the resume sent to the company (PDF or Word, up to 10 MB)"
    >
      {uploading ? <Spinner className="text-slate-400" /> : <CloudUploadIcon size={12} />} {resume ? 'Replace' : 'Upload resume'}
    </button>
  )

  return (
    <div className="space-y-2 pl-6 text-sm">
      <p className="text-[0.65rem] font-semibold tracking-wide text-slate-500 uppercase">Who joins</p>
      <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1.5">
        <dt className="text-slate-500">Caller</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          {caller ? (
            <>
              <ColorDot color={caller.color} size={10} />
              <span className="truncate font-medium text-slate-100">{caller.mine ? `You (${caller.name})` : caller.name}</span>
              {caller.level ? <span className="shrink-0 text-xs text-slate-500">Level {caller.level}</span> : null}
            </>
          ) : (
            <span className="text-amber-300">Nobody yet</span>
          )}
          {interview.canAssign && !choosing && (
            <button type="button" className={`ml-auto shrink-0 ${linkClass}`} onClick={() => setChoosing(true)}>
              {caller ? 'Change' : 'Assign'}
            </button>
          )}
        </dd>
        {choosing && (
          <dd className="col-span-2">
            <CallerPicker interview={interview} onDone={() => setChoosing(false)} />
          </dd>
        )}
        <dt className="text-slate-500">As</dt>
        <dd className="min-w-0">
          <span className="font-medium text-slate-100">{interview.profile ?? 'No profile'}</span>
          {interview.bidders.length > 0 && (
            <span className="block text-xs text-slate-500">
              Bidder{interview.bidders.length > 1 ? 's' : ''}: {interview.bidders.join(', ')}
            </span>
          )}
        </dd>
        {(interview.company || interview.round) && (
          <>
            <dt className="text-slate-500">For</dt>
            <dd className="min-w-0 text-slate-300">
              {[interview.company && interview.role ? `${interview.company} – ${interview.role}` : interview.company, interview.round]
                .filter(Boolean)
                .join(' · ')}
              {interview.locked && (
                <span className="ml-1 inline-flex items-center gap-1 text-xs text-slate-500" title="Stays with the earlier round's caller">
                  <LockIcon size={11} /> same caller
                </span>
              )}
            </dd>
          </>
        )}
        <dt className="text-slate-500">Resume</dt>
        <dd className="min-w-0">
          {resume ? (
            <span className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void download()} disabled={saving} className={chip} title={`Save ${resume.filename}`}>
                {saving ? <Spinner className="text-slate-400" /> : <DownloadIcon size={12} />} Download
              </button>
              {uploadButton}
              <span className="min-w-0 truncate text-xs text-slate-500" title={resume.filename}>
                {resume.filename} · {formatSize(resume.size)}
              </span>
            </span>
          ) : uploadButton ? (
            uploadButton
          ) : (
            <span className="text-xs text-slate-500">None added on Teamwork yet</span>
          )}
        </dd>
        {(link || canManage) && (
          <>
            <dt className="text-slate-500">Link</dt>
            <dd className="min-w-0">
              {editingLink ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (linkDraft.trim()) void saveLink(linkDraft)
                  }}
                >
                  <input
                    type="url"
                    autoFocus
                    required
                    placeholder="https://…"
                    aria-label="Link"
                    value={linkDraft}
                    disabled={linkBusy}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  />
                  <button
                    type="submit"
                    disabled={linkBusy || !linkDraft.trim()}
                    className="rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Share
                  </button>
                  <button type="button" disabled={linkBusy} onClick={() => setEditingLink(false)} className={linkClass}>
                    Cancel
                  </button>
                  {linkBusy && <Spinner className="text-slate-500" />}
                </form>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {link && (
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className={chip} title={link.url}>
                      <ExternalIcon size={12} /> Open
                    </a>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      className={chip}
                      disabled={linkBusy}
                      onClick={() => {
                        setLinkDraft(link?.url ?? '')
                        setEditingLink(true)
                      }}
                    >
                      <LinkIcon size={12} /> {link ? 'Change' : 'Share link'}
                    </button>
                  )}
                  {canManage && link && (
                    <button type="button" className={linkClass} disabled={linkBusy} onClick={() => void saveLink(null)}>
                      Remove
                    </button>
                  )}
                  {link && (
                    <span className="min-w-0 truncate text-xs text-slate-500" title={link.url}>
                      {link.site}
                      {link.sharedBy ? ` · by ${link.sharedBy}` : ''}
                    </span>
                  )}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
      {message && <p className="selectable text-xs break-all text-slate-400">{message}</p>}
    </div>
  )
}

/** Quick choices for a follow-up reminder; all at 09:00 in the display timezone. */
const FOLLOW_UP_CHOICES = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 }
]

function daysFromNowAtNine(days: number): Date {
  return new Date(fromLocalInputValue(`${addDays(todayString(), days)}T09:00`))
}

const REMINDER_FORMAT = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } as const
const reminderFmt = { format: (date: Date): string => formatInDisplayZone(date, REMINDER_FORMAT) }
const chipClass =
  'rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-50'
const linkClass = 'text-xs text-slate-400 hover:text-slate-200 hover:underline'

/** "Remind me" for an event marked Follow-Up: shows the reminder, or offers quick choices. */
function FollowUpReminder({ event }: { event: CalendarEvent }) {
  const setReminder = useAppStore((s) => s.setFollowUpReminder)
  const notificationsOn = useAppStore((s) => s.settings?.notificationsEnabled ?? true)
  const [editing, setEditing] = useState(false)
  const [custom, setCustom] = useState<string | null>(null) // datetime-local value while picking a time
  const [error, setError] = useState<string | null>(null)
  const at = event.followUpAt

  const save = (date: Date | null): void => {
    if (date && date.getTime() <= Date.now()) return setError('Pick a time in the future')
    setError(null)
    setEditing(false)
    setCustom(null)
    void setReminder(event.id, date ? date.toISOString() : null)
  }

  if (at && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs">
        <span className={`flex items-center gap-1.5 ${event.followUpReminded ? 'text-slate-500' : 'text-amber-300'}`}>
          <BellIcon size={13} />
          {event.followUpReminded ? 'Reminded' : 'Remind me'} {reminderFmt.format(new Date(at))}
        </span>
        <button className={linkClass} onClick={() => setEditing(true)}>
          {event.followUpReminded ? 'Remind again' : 'Change'}
        </button>
        <button className={linkClass} onClick={() => save(null)}>
          Remove
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 pl-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <BellIcon size={13} /> Remind me:
        </span>
        {custom === null ? (
          <>
            {FOLLOW_UP_CHOICES.map((c) => (
              <button
                key={c.days}
                className={chipClass}
                title={reminderFmt.format(daysFromNowAtNine(c.days))}
                onClick={() => save(daysFromNowAtNine(c.days))}
              >
                {c.label}
              </button>
            ))}
            <button className={chipClass} onClick={() => setCustom(toLocalInputValue(at ? new Date(at) : daysFromNowAtNine(1)))}>
              Pick time…
            </button>
            {editing && (
              <button className={linkClass} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </>
        ) : (
          <>
            <input
              type="datetime-local"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-200"
              value={custom}
              min={toLocalInputValue(new Date())}
              onChange={(e) => setCustom(e.target.value)}
            />
            <Button className="px-2! py-0.5! text-xs!" disabled={!custom} onClick={() => save(new Date(fromLocalInputValue(custom)))}>
              Set
            </Button>
            <button className={linkClass} onClick={() => setCustom(null)}>
              Cancel
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!notificationsOn && (
        <p className="text-xs text-amber-400">Notifications are off in Settings, so this reminder won't show until you turn them on.</p>
      )}
    </div>
  )
}

/** The selected event on screen: its ring in the calendar (CalendarPage) or its Pipeline card. */
const ANCHOR_SELECTOR = '.fc-event.event-highlighted, [data-details-anchor]'
/** Any event: in the calendar, or a Pipeline card. */
const EVENT_SELECTOR = '.fc-event, [data-pipeline-card]'

/**
 * Where the selected event is drawn: preferably a part of it in the window (an event
 * over several weeks has several), else any part; null while it isn't drawn (yet).
 */
function findAnchor(): DOMRect | null {
  let fallback: DOMRect | null = null
  for (const el of document.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR)) {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    if (rect.bottom > 0 && rect.top < window.innerHeight) return rect
    fallback ??= rect
  }
  return fallback
}

/**
 * Stops the mousedown and click that follow a press, so it doesn't select a time range
 * or open an event. Not tied to the card: it is gone by the time they arrive.
 */
function swallowRestOfClick(): void {
  const stop = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'click') remove()
  }
  const remove = (): void => {
    window.removeEventListener('mousedown', stop, true)
    window.removeEventListener('click', stop, true)
    window.removeEventListener('pointerdown', remove, true)
  }
  window.addEventListener('mousedown', stop, true)
  window.addEventListener('click', stop, true)
  // A drag ends without a click: then the next press is a normal one again.
  window.addEventListener('pointerdown', remove, true)
}

/**
 * Details of the selected event plus its notes, in a card next to the event (like
 * Google Calendar); centered when the event isn't on screen. Escape, the close button
 * or a click outside closes it (in the calendar or Pipeline, that click does nothing else);
 * a click on another event shows that one instead.
 */
export function EventDetailsPanel() {
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const selectEvent = useAppStore((s) => s.selectEvent)
  const calendars = useAppStore((s) => s.calendars)
  const localColor = useAppStore((s) => s.settings?.localEventColor ?? '#10b981')
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const deleteLocalEvent = useAppStore((s) => s.deleteLocalEvent)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const askRecurrenceScope = useAppStore((s) => s.askRecurrenceScope)
  const protonAccounts = useAppStore((s) => s.protonAccounts)
  const settings = useAppStore((s) => s.settings)
  const { event, loading, error } = useEventDetails(selectedEventId)
  const [teamwork, setTeamwork] = useTeamworkShare(event && !event.isLocalEvent ? event.id : null)
  const teamworkInterview = teamwork?.signedIn ? (teamwork.teamwork?.interview ?? null) : null
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Placed every frame, so the card follows the event when the calendar scrolls, redraws
  // it (a status change) or shows it after a jump, and when the card itself grows.
  useLayoutEffect(() => {
    if (!selectedEventId) return
    let frame = 0
    const place = (): void => {
      const card = cardRef.current
      if (card) {
        const next = placeNextTo(findAnchor(), card.getBoundingClientRect())
        setPos((prev) => (prev?.left === next.left && prev.top === next.top ? prev : next))
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [selectedEventId])

  // Escape or a click outside closes the card. Escape not while typing (fields use it
  // themselves); neither while a dialog is open on top. A click on the event itself
  // keeps it open.
  useEffect(() => {
    if (!selectedEventId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || isModalOpen()) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      selectEvent(null)
    }
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (!target || isModalOpen() || cardRef.current?.contains(target)) return
      // On an event (this one or another) the click goes through: it opens that event's details.
      if (target.closest(EVENT_SELECTOR)) return
      // Elsewhere in the calendar or Pipeline the click only closes the card (no new event).
      // In the sidebar or title bar it also does its own thing.
      if (target.closest('main')) {
        e.preventDefault()
        swallowRestOfClick()
      }
      selectEvent(null)
    }
    window.addEventListener('keydown', onKey)
    // Capture: before FullCalendar or the Pipeline cards see the press.
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [selectedEventId, selectEvent])

  // All hooks must run before this early return (React requires the same hook order every render).
  if (!selectedEventId) return null

  const calendar = event?.calendarId ? calendars.find((c) => c.id === event.calendarId) : undefined
  const accountLabel = protonAccounts.find((a) => a.id === calendar?.accountId)?.label
  const meetingUrl = event ? findMeetingUrl(event.location, event.description) : null

  // Which reminder applies: local events have their own; calendar events use the default.
  let reminderText: string | null = null
  if (event && settings?.notificationsEnabled) {
    if (event.isLocalEvent) {
      if (event.reminderMinutes !== null) reminderText = formatReminder(event.reminderMinutes)
    } else if (calendar?.notify) {
      if (event.allDay && settings.allDayReminder !== 'off') {
        reminderText = settings.allDayReminder === 'same-day' ? 'Reminder on the day at 9:00' : 'Reminder the evening before at 18:00'
      } else if (!event.allDay && settings.defaultReminderMinutes >= 0) {
        reminderText = `${formatReminder(settings.defaultReminderMinutes)} (default)`
      }
    }
  }
  const hasMoreDetails = Boolean(event && (meetingUrl || event.description || event.isLocalEvent))
  const color = event?.isLocalEvent ? (event.color ?? localColor) : (calendar?.color ?? '#64748b')

  const body = (
    <div className="space-y-6">
      {loading && !event && <Spinner className="text-slate-500" />}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !event && !error && (
        <p className="text-sm text-slate-400">This event no longer exists. It may have been removed from its calendar.</p>
      )}

      {event && (
        <>
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-1.5">
                <ColorDot color={color} size={12} />
              </span>
              <h2 className="selectable text-lg leading-snug font-semibold">{event.title}</h2>
            </div>

            <div className="space-y-2 pl-6 text-sm text-slate-300">
              <p className="flex items-start gap-2">
                <ClockIcon className="mt-0.5 shrink-0 text-slate-500" />
                <span className="selectable">{formatEventWhen(event)}</span>
              </p>
              {event.recurrence && (
                <p className="flex items-start gap-2">
                  <RepeatIcon className="mt-0.5 shrink-0 text-slate-500" />
                  {describeRecurrence(
                    event.recurrence,
                    event.allDay ? event.startTime : zonedDateString(new Date(event.startTime))
                  )}
                </p>
              )}
              {event.location && (
                <p className="flex items-start gap-2">
                  <MapPinIcon className="mt-0.5 shrink-0 text-slate-500" />
                  <span className="selectable break-words">{linkify(event.location)}</span>
                </p>
              )}
              {reminderText && (
                <p className="flex items-center gap-2">
                  <BellIcon className="shrink-0 text-slate-500" />
                  {reminderText}
                </p>
              )}
              <p className="flex items-center gap-2 text-xs text-slate-500">
                {event.isLocalEvent ? (
                  'Local event (only stored in this app)'
                ) : (
                  <>
                    <LockIcon size={12} /> {calendar?.name ?? 'Calendar'}
                    {accountLabel && ` · ${accountLabel}`} · read-only
                  </>
                )}
              </p>
            </div>
            {/* Who joins (Teamwork interviews), then the guests and their replies, above the status. */}
            {teamworkInterview && <WhoJoins key={teamworkInterview.id} interview={teamworkInterview} />}
            {event.attendees.length > 0 && <GuestList key={event.id} attendees={event.attendees} />}
            <ImportantToggle event={event} />
            <StatusPicker event={event} />
            {!event.isLocalEvent && <TeamworkShare key={event.id} event={event} state={teamwork} setState={setTeamwork} />}
          </section>

          {/* Notes sit right under the event summary so they're visible without scrolling past long descriptions. */}
          <hr className="border-slate-800" />
          <NotesEditor eventId={event.id} />

          {hasMoreDetails && <hr className="border-slate-800" />}
          {hasMoreDetails && (
            <section className="space-y-3">
              {meetingUrl && (
                <div className="pl-6">
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
                  >
                    <ExternalIcon /> Open meeting link
                  </a>
                </div>
              )}

              {event.description && (
                <div className="selectable pl-6 text-sm break-words text-slate-200">
                  {renderDescription(event.description)}
                </div>
              )}

              {event.isLocalEvent && (
                <div className="flex gap-2 pl-6">
                  <Button onClick={() => openEventEditor({ mode: 'edit', event })}>Edit event</Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (event.seriesId) {
                        // Repeating: the scope dialog doubles as the confirmation.
                        void askRecurrenceScope('delete').then((scope) => {
                          if (scope) void deleteLocalEvent(event.id, scope)
                        })
                        return
                      }
                      void askConfirm({
                        title: 'Delete event?',
                        message: `"${event.title}" and its meeting notes will be permanently deleted.`,
                        confirmLabel: 'Delete event',
                        danger: true
                      }).then((ok) => {
                        if (ok) void deleteLocalEvent(event.id)
                      })
                    }}
                  >
                    Delete event
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Event details"
      // no-drag: near the top the card can cover the title bar, whose drag area would swallow clicks.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden', WebkitAppRegion: 'no-drag' } as CSSProperties}
      className="fixed z-40 flex max-h-[70vh] w-[26rem] max-w-[calc(100vw-16px)] flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
    >
      <div className="flex justify-end px-2 pt-2">
        <Button variant="ghost" className="px-1.5!" onClick={() => selectEvent(null)} aria-label="Close details">
          <XIcon />
        </Button>
      </div>
      <div className="overflow-y-auto px-5 pb-5">{body}</div>
    </div>
  )
}
