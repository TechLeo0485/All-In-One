import { useMemo, useState } from 'react'
import type { CalendarSource } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { useNow } from '../hooks/useNow'
import { CalendarCard } from '../components/CalendarCard'
import { CalendarSourceDialog } from '../components/CalendarSourceDialog'
import { ProtonAccountCard } from '../components/ProtonAccountCard'
import { PlusIcon, RefreshIcon } from '../components/icons'
import { Button, Spinner } from '../components/ui'

/**
 * Manage calendars: connected Proton accounts (each with its calendars and its own
 * Sync button) first, then calendars added from a link or an exported file.
 */
export function CalendarsPage() {
  useNow() // keeps relative times current
  const calendars = useAppStore((s) => s.calendars)
  const accounts = useAppStore((s) => s.protonAccounts)
  const syncAll = useAppStore((s) => s.syncAll)
  const syncAllProtonAccounts = useAppStore((s) => s.syncAllProtonAccounts)
  const running = useAppStore((s) => s.syncStatus.running)
  const [dialog, setDialog] = useState<{ calendar?: CalendarSource } | null>(null)

  const busy = running || accounts.some((a) => a.status === 'syncing')
  // Calendars of a removed account (shouldn't happen) stay reachable in the second list.
  const linked = useMemo(
    () => calendars.filter((c) => !c.accountId || !accounts.some((a) => a.id === c.accountId)),
    [calendars, accounts]
  )
  const editCalendar = (calendar: CalendarSource): void => setDialog({ calendar })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Calendars</h1>
            <p className="mt-1 text-sm text-slate-400">
              Connect Proton accounts (free plans work) or add a Proton, Google, Outlook or other ICS link or an exported
              .ics file. All are read-only. Proton only syncs when you click Sync.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              onClick={() => {
                void syncAll()
                void syncAllProtonAccounts()
              }}
              disabled={busy}
              title="Sync all calendars and Proton accounts"
            >
              {busy ? <Spinner /> : <RefreshIcon />} Sync all
            </Button>
            <Button variant="primary" onClick={() => setDialog({})}>
              <PlusIcon /> Add calendar
            </Button>
          </div>
        </div>

        {accounts.length === 0 && linked.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center">
            <p className="font-medium">No calendars yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
              Log in to a Proton account to download all of its calendars, or add a calendar link or an exported .ics
              file.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setDialog({})}>
              <PlusIcon /> Add your first calendar
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {accounts.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Proton accounts</h2>
                <ul className="space-y-3">
                  {accounts.map((a) => (
                    <ProtonAccountCard key={a.id} account={a} onEditCalendar={editCalendar} />
                  ))}
                </ul>
              </section>
            )}
            {linked.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Links and files</h2>
                <ul className="space-y-3">
                  {linked.map((c) => (
                    <CalendarCard key={c.id} calendar={c} onEdit={() => editCalendar(c)} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {accounts.length > 0 && (
          <p className="mt-6 text-xs text-slate-500">
            How Proton sync works: when you click Sync, the app opens Proton's own Import/export page in a hidden window
            using the saved login and clicks “Download ICS” for each calendar, exactly as you would. Nothing runs in the
            background. If Proton changes its website and this stops working, use “Open Proton” and click Download ICS
            yourself; the file is imported automatically.
          </p>
        )}
      </div>

      {dialog && <CalendarSourceDialog calendar={dialog.calendar} onClose={() => setDialog(null)} />}
    </div>
  )
}
