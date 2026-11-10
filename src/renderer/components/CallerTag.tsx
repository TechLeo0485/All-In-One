import type { CallerTag } from '@shared/types'

/** Dark or white text, whichever reads better on the color (#rrggbb). */
function textOn(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 0.6 ? '#0f172a' : '#ffffff'
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

/**
 * Who takes a Teamwork interview, at the end of its calendar event, as on the
 * Teamwork website: the caller's first name in
 * their color, "You" for the member's own, a dashed "Unassigned" otherwise.
 */
export function CallerTagChip({ tag, compact = false }: { tag: CallerTag; compact?: boolean }) {
  const { caller } = tag
  if (!caller) {
    return (
      <span
        className="ml-auto shrink-0 rounded-sm border border-dashed border-amber-400/80 bg-slate-950/60 px-1 text-[9px] leading-[13px] font-semibold text-amber-200"
        title="No caller yet"
      >
        {compact ? '?' : 'Unassigned'}
      </span>
    )
  }
  const color = /^#[0-9a-f]{6}$/i.test(caller.color) ? caller.color : '#7c3aed'
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-[9px] leading-[13px] font-bold shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
      style={{ background: color, color: textOn(color) }}
      title={`Caller: ${caller.name}`}
    >
      <span className="max-w-[7rem] truncate">{caller.mine ? 'You' : firstName(caller.name)}</span>
    </span>
  )
}
