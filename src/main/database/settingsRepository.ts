import type { AppSettings } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, normalizeStatuses } from '@shared/eventStatus'
import { DEFAULT_SHORTCUT } from '@shared/shortcut'
import { getDb } from './connection'

export const DEFAULT_SETTINGS: AppSettings = {
  showLocalEvents: true,
  localEventColor: '#10b981',
  hiddenCalendarIds: [],
  notificationsEnabled: true,
  defaultReminderMinutes: 10,
  allDayReminder: 'same-day',
  notificationSound: true,
  notificationsPausedUntil: '',
  closeToTray: true,
  launchAtStartup: false,
  globalShortcut: DEFAULT_SHORTCUT,
  autoSyncMinutes: 30,
  eventStatuses: DEFAULT_EVENT_STATUSES
}

/** Keys for internal app state kept in the same table (never exposed as settings). */
const INTERNAL_PREFIX = 'internal:'

/** Parsed settings; read several times per reminder tick, cleared by update(). */
let cached: AppSettings | null = null

/**
 * Settings are stored as JSON-encoded values in a key/value table so new settings
 * can be added without a migration. Unknown or corrupt values fall back to defaults.
 */
export const settingsRepository = {
  get(): AppSettings {
    cached ??= load()
    return {
      ...cached,
      hiddenCalendarIds: [...cached.hiddenCalendarIds],
      eventStatuses: cached.eventStatuses.map((s) => ({ ...s }))
    }
  },

  /** Drops ids of calendars that no longer exist from the hidden list. */
  pruneHiddenCalendars(existingIds: string[]): void {
    const hidden = this.get().hiddenCalendarIds
    const kept = hidden.filter((id) => existingIds.includes(id))
    if (kept.length !== hidden.length) this.update({ hiddenCalendarIds: kept })
  },

  /** Internal JSON state (e.g. which reminders were already shown). */
  getInternal<T>(key: string, fallback: T): T {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(INTERNAL_PREFIX + key) as
      | { value: string }
      | undefined
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  },

  setInternal(key: string, value: unknown): void {
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(INTERNAL_PREFIX + key, JSON.stringify(value))
  },

  update(patch: Partial<AppSettings>): AppSettings {
    const db = getDb()
    const stmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
    db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (key in DEFAULT_SETTINGS && value !== undefined) stmt.run(key, JSON.stringify(value))
      }
    })()
    cached = null
    return this.get()
  }
}

function load(): AppSettings {
  const rows = getDb()
    .prepare(`SELECT key, value FROM settings WHERE key NOT LIKE '${INTERNAL_PREFIX}%'`)
    .all() as { key: string; value: string }[]
  const settings: AppSettings = { ...DEFAULT_SETTINGS }
  carryOverStatusColors(rows)
  for (const { key, value } of rows) {
    if (!(key in DEFAULT_SETTINGS)) continue
    try {
      const parsed = JSON.parse(value)
      const k = key as keyof AppSettings
      const fallback = DEFAULT_SETTINGS[k]
      const sameShape = Array.isArray(fallback) ? Array.isArray(parsed) : typeof parsed === typeof fallback
      if (sameShape) {
        ;(settings as unknown as Record<string, unknown>)[k] = parsed
      }
    } catch {
      // ignore corrupt value, keep default
    }
  }
  settings.eventStatuses = normalizeStatuses(settings.eventStatuses)
  return settings
}

/**
 * The first status version only had fixed statuses with a color each
 * ("statusColors"); keep colors picked there when the editable list is first loaded.
 */
function carryOverStatusColors(rows: { key: string; value: string }[]): void {
  const old = rows.find((r) => r.key === 'statusColors')
  if (!old || rows.some((r) => r.key === 'eventStatuses')) return
  try {
    const colors = JSON.parse(old.value) as Record<string, unknown>
    const statuses = DEFAULT_EVENT_STATUSES.map((s) =>
      typeof colors?.[s.id] === 'string' ? { ...s, color: colors[s.id] as string } : s
    )
    rows.push({ key: 'eventStatuses', value: JSON.stringify(statuses) })
  } catch {
    // unreadable: defaults
  }
}
