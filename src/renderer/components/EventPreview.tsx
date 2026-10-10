import { useLayoutEffect, useRef, useState } from 'react'
import type { EventStatusDef } from '@shared/types'
import { CalendarIcon, ClockIcon, MapPinIcon } from './icons'
import { ColorDot } from './ui'

export interface EventPreviewData {
  /** The hovered event element: the card is placed next to it. */
  anchor: HTMLElement
  title: string
  color: string
  when: string
  calendarName: string
  location: string
  status?: EventStatusDef
}

const MARGIN = 8
const GAP = 8

/**
 * Hover card for a calendar event (CalendarPage): the full title, time, calendar,
 * location and status, which narrow Week/Month cells cut off. Sits to the right of the
 * event, else to the left, else below; never under the pointer (pointer-events: none).
 */
export function EventPreview({ data }: { data: EventPreviewData }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const rect = data.anchor.getBoundingClientRect()
    const maxLeft = window.innerWidth - box.width - MARGIN
    const maxTop = window.innerHeight - box.height - MARGIN
    let left = rect.right + GAP
    let top = rect.top
    if (left > maxLeft) left = rect.left - GAP - box.width
    if (left < MARGIN) {
      // No room on either side: below the event (or above it near the bottom).
      left = Math.min(Math.max(MARGIN, rect.left), maxLeft)
      top = rect.bottom + GAP > maxTop ? rect.top - GAP - box.height : rect.bottom + GAP
    }
    setPos({ left, top: Math.min(Math.max(MARGIN, top), maxTop) })
  }, [data])

  return (
    <div
      ref={ref}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className="pointer-events-none fixed z-40 w-64 rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-sm"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5">
          <ColorDot color={data.color} size={10} />
        </span>
        <div className="line-clamp-3 text-sm leading-snug font-semibold break-words text-slate-100">{data.title || '(No title)'}</div>
      </div>
      <div className="mt-2 space-y-1 pl-[18px] text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <ClockIcon size={12} className="shrink-0" />
          {data.when}
        </div>
        {data.location && (
          <div className="flex items-center gap-1.5">
            <MapPinIcon size={12} className="shrink-0" />
            <span className="truncate">{data.location}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <CalendarIcon size={12} className="shrink-0" />
          <span className="truncate">{data.calendarName}</span>
        </div>
        {data.status && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-700 px-1.5 py-px text-[11px] text-slate-300">
            <ColorDot color={data.status.color} size={6} />
            {data.status.label}
          </span>
        )}
      </div>
    </div>
  )
}
