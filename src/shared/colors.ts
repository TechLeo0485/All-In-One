/** Calendar color palette, shared by the renderer (pickers) and main (auto-created calendars). */
export const PRESET_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#64748b' // slate
]

/** Teamwork's member palette (and its grey for Unassigned): the colors callers have on the website. */
export const TEAMWORK_COLORS = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
  '#0d9488',
  '#9333ea',
  '#65a30d',
  '#e11d48',
  '#64748b'
]

/** Picks a preset color not yet used, so new calendars are distinguishable by default. */
export function nextUnusedColor(used: string[]): string {
  return PRESET_COLORS.find((c) => !used.includes(c)) ?? PRESET_COLORS[used.length % PRESET_COLORS.length]
}
