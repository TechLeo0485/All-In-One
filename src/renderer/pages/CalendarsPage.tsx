import { useState } from 'react'
import type { CalendarSource } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { formatRelative } from '../utils/dates'
import { useNow } from '../hooks/useNow'
import { isFileSource, isGoogleCalendarUrl, isOutlookCalendarUrl } from '@shared/sources'
import { fileNameFromUrl, filePathFromUrl, maskShareUrl } from '../utils/sources'
import { CalendarSourceDialog } from '../components/CalendarSourceDialog'
import { AlertIcon, PlusIcon, RefreshIcon } from '../components/icons'
import { Button, ColorDot, Spinner, Toggle } from '../components/ui'

/** Exports older than this get a gentle "might be outdated" hint. */
const STALE_EXPORT_MS = 7 * 86_400_000

function CalendarCard({ calendar, onEdit }: { calendar: CalendarSource; onEdit: () => void }) {
  // Select only this card's data so a status push doesn't re-render every card.
  // Only this calendar's own sync counts; another calendar syncing must not spin this card.
  const syncing = useAppStore((s) => s.syncStatus.syncingIds.includes(calendar.id))
  const result = useAppStore((s) => s.syncStatus.results.find((r) => r.calendarId === calendar.id))
  const updateCalendar = useAppStore((s) => s.updateCalendar)
  const removeCalendar = useAppStore((s) => s.removeCalendar)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const syncOne = useAppStore((s) => s.syncOne)
  const pickIcsFile = useAppStore((s) => s.pickIcsFile)
  const account = useAppStore((s) => s.protonAccounts.find((a) => a.id === calendar.accountId))
  const setView = useAppStore((s) => s.setView)
  const isAccount = Boolean(calendar.accountId)
  const isFile = !isAccount && isFileSource(calendar.sourceUrl)
  const exportedAt = result?.sourceModifiedAt
  const isStale = exportedAt ? Date.now() - new Date(exportedAt).getTime() > STALE_EXPORT_MS : false

  const updateFromFile = async (): Promise<void> => {
    const url = await pickIcsFile()
    if (!url) return
    if (url === calendar.sourceUrl) void syncOne(calendar.id) // same file, re-read it
    else await updateCalendar(calendar.id, { sourceUrl: url }) // new file, sync starts automatically
  }

  return (
    <li className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
      <span className="mt-1.5">
        <ColorDot color={calendar.color} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className={`truncate font-medium ${calendar.enabled ? '' : 'text-slate-500'}`}>{calendar.name}</h3>
          {!calendar.enabled && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">Disabled</span>}
        </div>
        {isAccount ? (
          <p className="truncate text-xs text-slate-500">
            Proton account ·{' '}
            <button className="hover:underline" onClick={() => setView('accounts')}>
              {account?.label ?? 'unknown'}
            </button>
            {calendar.protonCalendarName && calendar.protonCalendarName !== calendar.name && ` · “${calendar.protonCalendarName}” in Proton`}
          </p>
        ) : isFile ? (
          <p className="truncate text-xs text-slate-500" title={filePathFromUrl(calendar.sourceUrl)}>
            Exported file · {fileNameFromUrl(calendar.sourceUrl)}
          </p>
        ) : (
          <p className="truncate text-xs text-slate-500" title="URL hidden because it contains an access token">
            {isGoogleCalendarUrl(calendar.sourceUrl)
              ? 'Google Calendar'
              : isOutlookCalendarUrl(calendar.sourceUrl)
                ? 'Outlook'
                : 'Share link'}{' '}
            · {maskShareUrl(calendar.sourceUrl)}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          {isAccount ? (
            <>Downloaded from Proton {formatRelative(account?.lastExportAt ?? calendar.lastSyncedAt)}</>
          ) : isFile && exportedAt ? (
            <span className={isStale ? 'text-amber-300' : ''}>
              Exported {formatRelative(exportedAt)}
              {isStale && ' (may be outdated: export again to update)'}
            </span>
          ) : (
            <>Last successful sync: {formatRelative(calendar.lastSyncedAt)}</>
          )}
          {result?.ok && ` · ${result.eventCount} events`}
        </p>
        {calendar.lastSyncError && (
          <p className="selectable mt-1 flex items-start gap-1.5 text-xs text-amber-300">
            <AlertIcon size={14} className="shrink-0" />
            <span>
              {calendar.lastSyncError}
              <span className="text-slate-500"> · showing cached events</span>
            </span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Toggle
          checked={calendar.enabled}
          label={calendar.enabled ? 'Disable calendar' : 'Enable calendar'}
          onChange={(enabled) => void updateCalendar(calendar.id, { enabled })}
        />
        {!isAccount && (
          <Button
            variant="ghost"
            title={isFile ? 'Re-read file' : 'Sync now'}
            disabled={syncing}
            onClick={() => void syncOne(calendar.id)}
          >
            {syncing ? <Spinner /> : <RefreshIcon />}
          </Button>
        )}
        {isFile && <Button onClick={() => void updateFromFile()}>Update from file…</Button>}
        <Button onClick={onEdit}>Edit</Button>
        {/* Account calendars come back on the next export; disabling them is the way to hide them. */}
        {!isAccount && (
          <Button
            variant="danger"
            onClick={() => {
              void askConfirm({
                title: 'Remove calendar?',
                message: `"${calendar.name}" and the notes on its events will be removed from this app. Nothing is changed in Proton.`,
                confirmLabel: 'Remove',
                danger: true
              }).then((ok) => {
                if (ok) void removeCalendar(calendar.id)
              })
            }}
          >
            Remove
          </Button>
        )}
      </div>
    </li>
  )
}

export function CalendarsPage() {
  useNow() // keeps relative times current
  const calendars = useAppStore((s) => s.calendars)
  const syncAll = useAppStore((s) => s.syncAll)
  const running = useAppStore((s) => s.syncStatus.running)
  const setView = useAppStore((s) => s.setView)
  const [dialog, setDialog] = useState<{ calendar?: CalendarSource } | null>(null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">Calendars</h1>
            <p className="mt-1 text-sm text-slate-400">
              Calendars from{' '}
              <button className="text-blue-400 hover:underline" onClick={() => setView('accounts')}>
                connected Proton accounts
              </button>{' '}
              appear here after you sync them. You can also add an exported .ics file, a share link, a Google Calendar or an Outlook calendar. All are
              read-only.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void syncAll()} disabled={running}>
              {running ? <Spinner /> : <RefreshIcon />} Refresh all
            </Button>
            <Button variant="primary" onClick={() => setDialog({})}>
              <PlusIcon /> Add calendar
            </Button>
          </div>
        </div>

        {calendars.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center">
            <p className="font-medium">No calendars yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Export a calendar from Proton (Settings → Import/export → Download ICS) and add the file here.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setDialog({})}>
              <PlusIcon /> Add your first calendar
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {calendars.map((c) => (
              <CalendarCard key={c.id} calendar={c} onEdit={() => setDialog({ calendar: c })} />
            ))}
          </ul>
        )}
      </div>

      {dialog && <CalendarSourceDialog calendar={dialog.calendar} onClose={() => setDialog(null)} />}
    </div>
  )
}
