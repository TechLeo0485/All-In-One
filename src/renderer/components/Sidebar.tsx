import { useEffect, useMemo, useRef, useState } from 'react'
import { LOCAL_EVENTS_KEY, useAppStore, type EventCounts, type PeriodStats, type View } from '../stores/appStore'
import { formatAge, formatRelative } from '../utils/dates'
import { isProtonStale } from '../utils/proton'
import { DEFAULT_EVENT_STATUSES } from '@shared/eventStatus'
import type { EventStatusDef, ProtonAccount } from '@shared/types'
import { useNow } from '../hooks/useNow'
import { useMediaQuery } from '../hooks/useMediaQuery'
import {
  AlertIcon,
  CalendarIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  KanbanIcon,
  LayersIcon,
  PanelLeftIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon
} from './icons'
import { Button, ColorDot, Spinner } from './ui'
import { AppLogo } from './AppLogo'
import { SearchBox } from './SearchBox'
import { APP_NAME } from '@shared/brand'

function CalendarRow({
  name,
  color,
  visible,
  error,
  onToggle,
  onSync,
  syncing = false,
  syncTitle,
  counts
}: {
  name: string
  color: string
  visible: boolean
  error?: string | null
  onToggle: () => void
  /** Omitted for rows that can't be synced (local events). */
  onSync?: () => void
  syncing?: boolean
  syncTitle?: string
  /** Events in the period the calendar shows; omitted while the calendar page isn't open. */
  counts?: EventCounts
}) {
  const iconButton = 'shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:hover:bg-transparent'
  // The hover buttons take the place of the counts.
  const onHover = 'hidden group-focus-within:block group-hover:block'
  return (
    <li className="group flex items-center rounded-md pr-1 hover:bg-slate-800">
      <button
        onClick={onToggle}
        title={visible ? `Hide ${name}` : `Show ${name}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2 text-left text-sm"
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
        {counts && <RowCounts counts={counts} dim={!visible} />}
      </button>
      <button onClick={onToggle} title={visible ? `Hide ${name}` : `Show ${name}`} className={`${iconButton} ${onHover}`}>
        {visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
      </button>
      {onSync && (
        <button
          onClick={onSync}
          disabled={syncing}
          title={syncTitle ?? `Sync ${name}`}
          // Stays visible while syncing so the spinner shows progress.
          className={`${iconButton} ${syncing ? '' : onHover}`}
        >
          {syncing ? <Spinner /> : <RefreshIcon size={14} />}
        </button>
      )}
    </li>
  )
}

const NO_EVENTS: EventCounts = { total: 0, done: 0, scheduled: 0, statuses: {} }

/** Colors of the three counts, shared by the period summary and the rows. */
const COUNT_STYLES = { total: 'text-slate-200', done: 'text-emerald-400', scheduled: 'text-sky-400' }

/** "12 8 4": total, done, scheduled (the summary above the list labels them). */
function RowCounts({ counts, dim }: { counts: EventCounts; dim: boolean }) {
  const { total, done, scheduled } = counts
  return (
    <span
      title={`${total} ${total === 1 ? 'event' : 'events'}: ${done} done, ${scheduled} scheduled`}
      className={`flex shrink-0 gap-1.5 pr-1 text-[11px] tabular-nums group-focus-within:hidden group-hover:hidden ${dim ? 'opacity-50' : ''}`}
    >
      {total === 0 ? (
        <span className="text-slate-600">0</span>
      ) : (
        <>
          <span className={COUNT_STYLES.total}>{total}</span>
          <span className={COUNT_STYLES.done}>{done}</span>
          <span className={COUNT_STYLES.scheduled}>{scheduled}</span>
        </>
      )}
    </span>
  )
}

/** Card above the calendar list: totals of the visible calendars and local events for the shown week/month/day. */
function PeriodSummary({ stats, counts, statusDefs }: { stats: PeriodStats; counts: EventCounts; statusDefs: EventStatusDef[] }) {
  const { total, done, scheduled } = counts
  // Picked statuses (Follow-Up, Passed, ...) in the Settings order; only those in use.
  const statusCounts = statusDefs.flatMap((s) => (counts.statuses[s.id] ? [{ ...s, count: counts.statuses[s.id] }] : []))
  const items = [
    { label: 'Total', value: total, style: COUNT_STYLES.total },
    { label: 'Done', value: done, style: COUNT_STYLES.done },
    { label: 'Scheduled', value: scheduled, style: COUNT_STYLES.scheduled }
  ]
  return (
    <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/40 px-3 pt-2 pb-2.5" title="Events of the visible calendars and local events">
      <div className="truncate text-[11px] text-slate-500">{stats.label}</div>
      <div className="mt-1.5 grid grid-cols-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className={`text-lg leading-tight font-semibold tabular-nums ${item.style}`}>{item.value}</div>
            <div className="text-[10px] tracking-wide text-slate-500 uppercase">{item.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      {statusCounts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
          {statusCounts.map((s) => (
            <span key={s.id} className="flex items-center gap-1">
              <ColorDot color={s.color} size={6} />
              <span className="font-semibold text-slate-200 tabular-nums">{s.count}</span>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function NavButton({ view, label, icon, compact = false }: { view: View; label: string; icon: React.ReactNode; compact?: boolean }) {
  const current = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const active = current === view
  if (compact) {
    return (
      <button
        onClick={() => setView(view)}
        title={label}
        aria-label={label}
        className={`flex h-9 w-9 items-center justify-center rounded-md ${
          active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`}
      >
        {icon}
      </button>
    )
  }
  return (
    <button
      onClick={() => setView(view)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
        active ? 'bg-slate-800 font-medium text-white' : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

/** Below this window width the sidebar is an icon rail; the full one opens as a drawer over the calendar. */
const NARROW_QUERY = '(max-width: 1099px)'
const COLLAPSED_KEY = 'sidebar.collapsed'

/**
 * Wide window: the full sidebar, which the user may collapse to the rail (remembered).
 * Narrow window: always the rail; expanding it slides the full sidebar over the
 * calendar until something is picked, Escape or a click outside.
 */
export function Sidebar() {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Opened from the rail's search button (or Ctrl+F): the search box takes the focus.
  const [focusSearch, setFocusSearch] = useState(false)
  const rail = narrow || collapsed

  const saveCollapsed = (value: boolean): void => {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
    setCollapsed(value)
  }
  const expand = (search: boolean): void => {
    setFocusSearch(search)
    if (narrow) setDrawerOpen(true)
    else saveCollapsed(false)
  }
  const expandRef = useRef(expand)
  expandRef.current = expand

  useEffect(() => {
    if (!rail) setDrawerOpen(false)
  }, [rail])

  // The search box (and its own Ctrl+F) only exists in the full sidebar, so the rail opens it.
  useEffect(() => {
    if (!rail || drawerOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        expandRef.current(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rail, drawerOpen])

  // The drawer is for one action: changing page, opening an event or the editor closes it.
  useEffect(() => {
    if (!drawerOpen) return
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.view !== prev.view || s.selectedEventId !== prev.selectedEventId || (s.eventEditor && !prev.eventEditor)) {
        setDrawerOpen(false)
      }
    })
    // Escape in the search box clears it first (SearchBox); the next one closes the drawer.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  if (!rail) {
    return (
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <SidebarContent focusSearch={focusSearch} toggleTitle="Collapse sidebar" onToggle={() => saveCollapsed(true)} />
      </aside>
    )
  }
  return (
    <>
      <SidebarRail onExpand={expand} />
      {drawerOpen && (
        <>
          <div className="absolute inset-0 z-[45] bg-black/40" onMouseDown={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 z-[45] flex w-64 flex-col border-r border-slate-800 bg-slate-900 shadow-2xl">
            <SidebarContent focusSearch={focusSearch} toggleTitle="Close sidebar" onToggle={() => setDrawerOpen(false)} />
          </aside>
        </>
      )}
    </>
  )
}

/** Refresh-everything state, shared by the full sidebar and the rail. */
function useRefreshAll() {
  const syncStatus = useAppStore((s) => s.syncStatus)
  const accounts = useAppStore((s) => s.protonAccounts)
  const syncAll = useAppStore((s) => s.syncAll)
  const syncAllProtonAccounts = useAppStore((s) => s.syncAllProtonAccounts)
  const accountSyncing = accounts.some((a) => a.status === 'syncing')
  const refreshEverything = (): void => {
    void syncAll()
    void syncAllProtonAccounts()
  }
  return { syncStatus, accounts, accountSyncing, busy: syncStatus.running || accountSyncing, refreshEverything }
}

/** Icons only: expand, new event, search, refresh and the pages. */
function SidebarRail({ onExpand }: { onExpand: (focusSearch: boolean) => void }) {
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const setView = useAppStore((s) => s.setView)
  const calendars = useAppStore((s) => s.calendars)
  const { accounts, busy, refreshEverything } = useRefreshAll()
  // The full sidebar shows these warnings per calendar; here a dot says "look inside".
  const needsAttention =
    accounts.some((a) => a.status === 'login-required' || a.status === 'error') || calendars.some((c) => c.enabled && c.lastSyncError)
  const railButton = 'relative flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200'

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-800 bg-slate-900 py-3">
      <button onClick={() => onExpand(false)} title="Expand sidebar" aria-label="Expand sidebar" className={railButton}>
        <PanelLeftIcon size={18} />
        {needsAttention && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-400" />}
      </button>
      <button
        onClick={() => {
          setView('calendar')
          openEventEditor({ mode: 'create', defaults: {} })
        }}
        title="New local event"
        aria-label="New local event"
        className="my-1 flex h-9 w-9 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-500"
      >
        <PlusIcon size={18} />
      </button>
      <button onClick={() => onExpand(true)} title="Search events (Ctrl+F)" aria-label="Search events" className={railButton}>
        <SearchIcon size={18} />
      </button>
      <button
        onClick={refreshEverything}
        disabled={busy}
        title="Refresh all calendars and Proton accounts"
        aria-label="Refresh all calendars"
        className={`${railButton} disabled:opacity-60`}
      >
        {busy ? <Spinner /> : <RefreshIcon size={18} />}
      </button>

      <nav className="mt-auto flex flex-col items-center gap-1 border-t border-slate-800 pt-3">
        <NavButton compact view="calendar" label="Calendar" icon={<CalendarIcon size={18} />} />
        <NavButton compact view="pipeline" label="Pipeline" icon={<KanbanIcon size={18} />} />
        <NavButton compact view="calendars" label="Manage calendars" icon={<LayersIcon size={18} />} />
        <NavButton compact view="settings" label="Settings" icon={<SettingsIcon size={18} />} />
      </nav>
    </aside>
  )
}

function SidebarContent({ focusSearch, toggleTitle, onToggle }: { focusSearch: boolean; toggleTitle: string; onToggle: () => void }) {
  const now = useNow() // keeps "Last sync … ago" and the stale-sync badges current
  const calendars = useAppStore((s) => s.calendars)
  const settings = useAppStore((s) => s.settings)
  const toggleVisibility = useAppStore((s) => s.toggleCalendarVisibility)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const setView = useAppStore((s) => s.setView)
  const syncOne = useAppStore((s) => s.syncOne)
  const protonAction = useAppStore((s) => s.protonAction)
  const { syncStatus, accounts, accountSyncing, busy, refreshEverything } = useRefreshAll()

  const periodStats = useAppStore((s) => s.periodStats)
  const hidden = settings?.hiddenCalendarIds ?? []
  const showLocal = settings?.showLocalEvents ?? true
  const enabled = useMemo(() => calendars.filter((c) => c.enabled), [calendars])

  // Totals of what the calendar shows: visible calendars plus local events (unless hidden).
  const summary = useMemo(() => {
    if (!periodStats) return null
    const keys = enabled.filter((c) => !hidden.includes(c.id)).map((c) => c.id)
    if (showLocal) keys.push(LOCAL_EVENTS_KEY)
    const sum: EventCounts = { total: 0, done: 0, scheduled: 0, statuses: {} }
    for (const key of keys) {
      const c = periodStats.counts[key]
      if (!c) continue
      sum.total += c.total
      sum.done += c.done
      sum.scheduled += c.scheduled
      for (const [id, n] of Object.entries(c.statuses)) sum.statuses[id] = (sum.statuses[id] ?? 0) + n
    }
    return sum
  }, [periodStats, enabled, hidden, showLocal])

  // Group calendars under their Proton account (5+ accounts get crowded otherwise).
  const groups = useMemo(() => {
    const result: { key: string; title: string | null; alert?: string; account?: ProtonAccount; items: typeof enabled }[] = []
    for (const a of accounts) {
      const items = enabled.filter((c) => c.accountId === a.id)
      const alert = a.status === 'login-required' ? 'Login needed' : a.status === 'error' ? 'Sync failed' : undefined
      if (items.length || alert) result.push({ key: a.id, title: a.label, alert, account: a, items })
    }
    const other = enabled.filter((c) => !c.accountId || !accounts.some((a) => a.id === c.accountId))
    if (other.length) result.push({ key: 'other', title: result.length ? 'Other calendars' : null, items: other })
    return result
  }, [accounts, enabled])

  return (
    <>
      <div className="flex items-center gap-2.5 pt-4 pr-3 pb-3 pl-4">
        <AppLogo size={32} />
        <span className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{APP_NAME}</span>
        <button
          onClick={onToggle}
          title={toggleTitle}
          aria-label={toggleTitle}
          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <PanelLeftIcon />
        </button>
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
          <SearchBox autoFocus={focusSearch} />
        </div>
      </div>

      <div className="mt-5 flex-1 overflow-y-auto px-3">
        {periodStats && summary && <PeriodSummary stats={periodStats} counts={summary} statusDefs={settings?.eventStatuses ?? DEFAULT_EVENT_STATUSES} />}
        <div className="mb-1 flex items-center justify-between px-2">
          <h3>
            <button
              onClick={() => setView('calendar')}
              title="Show the calendar"
              className="-mx-1 rounded px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-200"
            >
              Calendars
            </button>
          </h3>
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
              <div className="flex items-center gap-1 px-2 pt-1 pb-0.5">
                <button
                  onClick={() => group.key !== 'other' && setView('calendars')}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-medium text-slate-400"
                  title={group.key !== 'other' ? 'Manage this Proton account' : undefined}
                >
                  <span className="truncate">{group.title}</span>
                  {group.alert && (
                    <span className="flex shrink-0 items-center gap-0.5 text-amber-400">
                      <AlertIcon size={11} /> {group.alert}
                    </span>
                  )}
                </button>
                {group.account && isProtonStale(group.account, now) && (
                  // Proton only syncs on request: a gentle nudge once the data gets old.
                  <button
                    onClick={() => void protonAction('syncAccount', group.key)}
                    title={`${group.account.lastExportAt ? `Last synced ${formatAge(group.account.lastExportAt, now)}` : 'Never synced'}. Click to sync now.`}
                    className="flex shrink-0 items-center gap-1 rounded px-1 text-[10px] text-amber-300/80 hover:bg-slate-800 hover:text-amber-200"
                  >
                    <ClockIcon size={10} />
                    {group.account.lastExportAt ? formatAge(group.account.lastExportAt, now) : 'never synced'}
                  </button>
                )}
              </div>
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
                  // Proton downloads a whole account in one export, so its calendars sync per account.
                  onSync={() => void (c.accountId ? protonAction('syncAccount', c.accountId) : syncOne(c.id))}
                  syncing={
                    syncStatus.syncingIds.includes(c.id) || accounts.some((a) => a.id === c.accountId && a.status === 'syncing')
                  }
                  syncTitle={c.accountId ? `Sync ${group.title ?? 'this Proton account'}` : `Sync ${c.name}`}
                  counts={periodStats ? (periodStats.counts[c.id] ?? NO_EVENTS) : undefined}
                />
              ))}
            </ul>
          </div>
        ))}

        <ul className="space-y-0.5">
          {settings && (
            <CalendarRow
              name="Local events"
              counts={periodStats ? (periodStats.counts[LOCAL_EVENTS_KEY] ?? NO_EVENTS) : undefined}
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
        <NavButton view="pipeline" label="Pipeline" icon={<KanbanIcon />} />
        <NavButton view="calendars" label="Manage calendars" icon={<LayersIcon />} />
        <NavButton view="settings" label="Settings" icon={<SettingsIcon />} />
      </nav>
    </>
  )
}
