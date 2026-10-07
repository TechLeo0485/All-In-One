/** Height of one hour in Week/Day views, in px (Settings slider and Ctrl + mouse wheel). */
export const DEFAULT_HOUR_HEIGHT = 60
export const MIN_HOUR_HEIGHT = 30
export const MAX_HOUR_HEIGHT = 200
/** Slider and Ctrl + wheel step. */
export const HOUR_HEIGHT_STEP = 5

export function clampHourHeight(px: number): number {
  const rounded = Math.round(px / HOUR_HEIGHT_STEP) * HOUR_HEIGHT_STEP
  return Math.min(MAX_HOUR_HEIGHT, Math.max(MIN_HOUR_HEIGHT, rounded))
}
