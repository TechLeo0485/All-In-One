const MARGIN = 8
const GAP = 8

/**
 * Where to put a floating card of `size` next to `anchor` (viewport coordinates): to
 * its right, else its left, else below it (above it near the bottom), always inside
 * the window. Without an anchor the card is centered.
 */
export function placeNextTo(anchor: DOMRect | null, size: { width: number; height: number }): { left: number; top: number } {
  const maxLeft = window.innerWidth - size.width - MARGIN
  const maxTop = window.innerHeight - size.height - MARGIN
  if (!anchor) return { left: Math.max(MARGIN, maxLeft / 2 + MARGIN / 2), top: Math.max(MARGIN, maxTop / 2 + MARGIN / 2) }
  let left = anchor.right + GAP
  let top = anchor.top
  if (left > maxLeft) left = anchor.left - GAP - size.width
  if (left < MARGIN) {
    // No room on either side: below the anchor (or above it near the bottom).
    left = Math.min(Math.max(MARGIN, anchor.left), maxLeft)
    top = anchor.bottom + GAP > maxTop ? anchor.top - GAP - size.height : anchor.bottom + GAP
  }
  return { left: Math.max(MARGIN, left), top: Math.min(Math.max(MARGIN, top), Math.max(MARGIN, maxTop)) }
}
