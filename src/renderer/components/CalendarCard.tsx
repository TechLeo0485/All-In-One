import type { CalendarSource } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { formatRelative } from '../utils/dates'
import { isFileSource, isGoogleCalendarUrl, isOutlookCalendarUrl, isProtonCalendarUrl } from '@shared/sources'
import { fileNameFromUrl, filePathFromUrl, maskShareUrl } from '../utils/sources'
import { AlertIcon, RefreshIcon } from './icons'
import { Button, ColorDot, Spinner, Toggle } from './ui'

/** Exports older than this get a gentle "might be outdated" hint. */
const STALE_EXPORT_MS = 7 * 86_400_000

/**
 * One calendar on the Manage calendars page. Calendars of a Proton account are shown
 * `nested` inside their account card, which owns syncing (Proton exports per account).
 */
export function CalendarCard({
  calendar,
  nested = false,
  onEdit
}: {
  calendar: CalendarSource
  nested?: boolean
  onEdit: () => void
}) {
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
    <li
      className={`flex items-start gap-4 rounded-xl border p-4 ${
        nested ? 'border-slate-800/70 bg-slate-950/40 py-3' : 'border-slate-800 bg-slate-900 shadow-sm'
      }`}
    >
      <span className="mt-1.5">
        <ColorDot color={calendar.color} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className={`truncate font-medium ${calendar.enabled ? '' : 'text-slate-500'}`}>{calendar.name}</h3>
          {!calendar.enabled && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">Disabled</span>}
        </div>
        {isAccount ? (
          calendar.protonCalendarName &&
          calendar.protonCalendarName !== calendar.name && (
            <p className="truncate text-xs text-slate-500">“{calendar.protonCalendarName}” in Proton</p>
          )
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
                : isProtonCalendarUrl(calendar.sourceUrl)
                  ? 'Proton share link'
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
