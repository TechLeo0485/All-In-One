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

/** Picks a preset color not yet used, so new calendars are distinguishable by default. */
export function nextUnusedColor(used: string[]): string {
  return PRESET_COLORS.find((c) => !used.includes(c)) ?? PRESET_COLORS[used.length % PRESET_COLORS.length]
}
