import { useCallback, useEffect, useState } from 'react'
import type { OverviewGroup, TeamworkView } from '@shared/types'
import { TeamDayBoard } from './TeamDayBoard'

const GROUP_KEY = 'overview.group'
const VIEW_KEY = 'overview.view'
const ALL = 'all'

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Overview accounts, Day view → Team: one group's day (picked from the groups
 * the account sees), by caller (and Unassigned) or by bidder (who brought each
 * interview in), read-only.
 */
export function OverviewDayBoard({
  from,
  to,
  timeZone,
  hourHeight
}: {
  from: string
  to: string
  timeZone: string | undefined
  hourHeight: number
}) {
  const [groups, setGroups] = useState<OverviewGroup[] | null>(null)
  const [groupId, setGroupId] = useState<string | null>(() => stored(GROUP_KEY))
  const [view, setView] = useState<TeamworkView>(() => (stored(VIEW_KEY) === 'bidders' ? 'bidders' : 'callers'))

  useEffect(() => {
    const load = (): void => {
      void window.api.overview
        .groups()
        .then(setGroups)
        .catch(() => setGroups([]))
    }
    load()
    return window.api.caller.onChanged(load)
  }, [])

  // All groups at once (the default), or one.
  const allGroups = groupId === null || groupId === ALL
  const current = allGroups ? null : (groups?.find((g) => g.id === groupId) ?? null)
  const boardId = current?.id ?? ALL
  const pickGroup = (id: string): void => {
    setGroupId(id)
    try {
      localStorage.setItem(GROUP_KEY, id)
    } catch {
      // Remembering the choice is a convenience only.
    }
  }
  const pickView = (next: TeamworkView): void => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // As above.
    }
  }
  const source = useCallback(
    (a: string, b: string) => window.api.overview.board(boardId, view, a, b),
    [boardId, view]
  )

  if (groups && groups.length === 0) {
    return (
      <p className="m-4 rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
        No groups yet. The platform admin picks which groups this account sees.
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Group" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            role="radio"
            aria-checked={allGroups || !current}
            onClick={() => pickGroup(ALL)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              allGroups || !current ? 'border-transparent bg-slate-600 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            All groups
          </button>
          {(groups ?? []).map((g) => {
            const on = current?.id === g.id
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickGroup(g.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  on ? 'border-transparent text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                }`}
                style={on ? { background: `color-mix(in srgb, ${g.color} 70%, #0f172a)` } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: g.color }} aria-hidden />
                {g.label}
              </button>
            )
          })}
        </div>
        <div role="radiogroup" aria-label="Show by" className="ml-auto flex items-center gap-px rounded-md bg-slate-800 p-0.5">
          {(['callers', 'bidders'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => pickView(v)}
              title={v === 'callers' ? 'A column per caller, and Unassigned' : 'A column per bidder: who brought each interview in'}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                view === v ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'callers' ? 'Callers' : 'Bidders'}
            </button>
          ))}
        </div>
      </div>
      {groups && <TeamDayBoard key={`${boardId}:${view}`} from={from} to={to} timeZone={timeZone} hourHeight={hourHeight} source={source} />}
    </div>
  )
}
