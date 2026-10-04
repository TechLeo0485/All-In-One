import { useMemo } from 'react'
import { useAppStore, type View } from '../stores/appStore'
import { formatRelative } from '../utils/dates'
import { useNow } from '../hooks/useNow'
import { AlertIcon, CalendarIcon, EyeIcon, EyeOffIcon, LayersIcon, PlusIcon, RefreshIcon, SettingsIcon } from './icons'
import { Button, ColorDot, Spinner } from './ui'
import { AppLogo } from './AppLogo'
import { SearchBox } from './SearchBox'
import { APP_NAME } from '@shared/brand'

function CalendarRow({
  name,
  color,
  visible,
  error,
  onToggle
}: {
  name: string
  color: string
  visible: boolean
  error?: string | null
  onToggle: () => void
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        title={visible ? `Hide ${name}` : `Show ${name}`}
        className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-800"
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded border-2"
          style={{ borderColor: color, backgroundColor: visible ? color : 'transparent' }}
        />
        <span className={`flex-1 truncate ${visible ? 'text-slate-200' : 'text-slate-500'}`}>{name}</span>
        {error && (
          <span title={`Last sync failed: ${error}`} className="text-amber-400">
            <AlertIcon size={14} />
          </span>
        )}
        <span className="text-slate-500 opacity-0 group-hover:opacity-100">
          {visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
        </span>
      </button>
    </li>
  )
}

function NavButton({ view, label, icon }: { view: View; label: string; icon: React.ReactNode }) {
  const current = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  return (
    <button
      onClick={() => setView(view)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
        current === view ? 'bg-slate-800 font-medium text-white' : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

export function Sidebar() {
  useNow() // keeps "Last sync … ago" current
  const calendars = useAppStore((s) => s.calendars)
  const settings = useAppStore((s) => s.settings)
  const syncStatus = useAppStore((s) => s.syncStatus)
  const toggleVisibility = useAppStore((s) => s.toggleCalendarVisibility)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const syncAll = useAppStore((s) => s.syncAll)
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const setView = useAppStore((s) => s.setView)
  const accounts = useAppStore((s) => s.protonAccounts)
  const syncAllProtonAccounts = useAppStore((s) => s.syncAllProtonAccounts)

  const hidden = settings?.hiddenCalendarIds ?? []
  const enabled = useMemo(() => calendars.filter((c) => c.enabled), [calendars])
  const accountSyncing = accounts.some((a) => a.status === 'syncing')
  const busy = syncStatus.running || accountSyncing

  // Group calendars under their Proton account (5+ accounts get crowded otherwise).
  const groups = useMemo(() => {
    const result: { key: string; title: string | null; alert?: string; items: typeof enabled }[] = []
    for (const a of accounts) {
      const items = enabled.filter((c) => c.accountId === a.id)
      const alert = a.status === 'login-required' ? 'Login needed' : a.status === 'error' ? 'Sync failed' : undefined
      if (items.length || alert) result.push({ key: a.id, title: a.label, alert, items })
    }
    const other = enabled.filter((c) => !c.accountId || !accounts.some((a) => a.id === c.accountId))
    if (other.length) result.push({ key: 'other', title: result.length ? 'Other calendars' : null, items: other })
    return result
  }, [accounts, enabled])

  const refreshEverything = (): void => {
    void syncAll()
    void syncAllProtonAccounts()
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <AppLogo size={32} />
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <div className="px-3">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => {
            setView('calendar')
            openEventEditor({ mode: 'create', defaults: {} })
          }}
        >
          <PlusIcon /> New local event
        </Button>
        <div className="mt-2">
          <SearchBox />
        </div>
      </div>

      <div className="mt-5 flex-1 overflow-y-auto px-3">
        <div className="mb-1 flex items-center justify-between px-2">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Calendars</h3>
          <button
            onClick={refreshEverything}
            disabled={busy}
            title="Refresh all calendars and Proton accounts"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? <Spinner /> : <RefreshIcon size={14} />}
          </button>
        </div>

        {groups.map((group) => (
          <div key={group.key} className="mb-2">
            {group.title && (
              <button
                onClick={() => group.key !== 'other' && setView('calendars')}
                className="flex w-full items-center gap-1.5 px-2 pt-1 pb-0.5 text-left text-[11px] font-medium text-slate-400"
                title={group.key !== 'other' ? 'Manage this Proton account' : undefined}
              >
                <span className="truncate">{group.title}</span>
                {group.alert && (
                  <span className="flex shrink-0 items-center gap-0.5 text-amber-400">
                    <AlertIcon size={11} /> {group.alert}
                  </span>
                )}
              </button>
            )}
            <ul className="space-y-0.5">
              {group.items.map((c) => (
                <CalendarRow
                  key={c.id}
                  name={c.name}
                  color={c.color}
                  visible={!hidden.includes(c.id)}
                  error={c.lastSyncError}
                  onToggle={() => void toggleVisibility(c.id)}
                />
              ))}
            </ul>
          </div>
        ))}

        <ul className="space-y-0.5">
          {settings && (
            <CalendarRow
              name="Local events"
              color={settings.localEventColor}
              visible={settings.showLocalEvents}
              onToggle={() => void updateSettings({ showLocalEvents: !settings.showLocalEvents })}
            />
          )}
        </ul>

        {enabled.length === 0 && (
          <p className="mt-2 px-2 text-xs text-slate-500">
            No calendars yet.{' '}
            <button className="text-blue-400 hover:underline" onClick={() => setView('calendars')}>
              Add a calendar
            </button>
          </p>
        )}

        <p className="mt-3 flex items-center gap-1.5 px-2 text-xs text-slate-500">
          <ColorDot color={busy ? '#3b82f6' : '#475569'} size={6} />
          {accountSyncing
            ? 'Downloading from Proton…'
            : syncStatus.running
              ? `Syncing ${syncStatus.syncingIds.length === 1 ? '1 calendar' : `${syncStatus.syncingIds.length} calendars`}…`
              : `Last sync ${formatRelative(syncStatus.lastRunAt)}`}
        </p>
      </div>

      <nav className="space-y-0.5 border-t border-slate-800 p-3">
        <NavButton view="calendar" label="Calendar" icon={<CalendarIcon />} />
        <NavButton view="calendars" label="Manage calendars" icon={<LayersIcon />} />
        <NavButton view="settings" label="Settings" icon={<SettingsIcon />} />
      </nav>
    </aside>
  )
}
