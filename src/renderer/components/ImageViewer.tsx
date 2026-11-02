import { useEffect, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from './icons'
import { useModalLayer } from './ui'

/**
 * Full-window image viewer, like in chat apps: the picture fitted to the window on a
 * dark backdrop. Click the picture to see it at full size (scrolls if bigger), click
 * the backdrop, X or Escape to close; with several images, arrows or ←/→ step through.
 *
 * It is a modal layer, so the details card behind it ignores the clicks and Escape.
 */
export function ImageViewer({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const [zoomed, setZoomed] = useState(false)
  const isTopmost = useModalLayer(onClose)
  const many = images.length > 1

  const step = (by: number): void => {
    setIndex((i) => (i + by + images.length) % images.length)
    setZoomed(false)
  }

  useEffect(() => {
    if (!many) return
    const onKey = (e: KeyboardEvent): void => {
      if (!isTopmost()) return
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const closeOnBackdrop = (e: MouseEvent): void => {
    if (e.target === e.currentTarget) onClose()
  }
  const roundButton = 'flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-slate-200 hover:bg-black/80 hover:text-white'

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Image" className="fixed inset-0 z-[60] bg-black/90">
      <div
        onClick={closeOnBackdrop}
        className={`absolute inset-0 overflow-auto ${zoomed ? '' : 'flex items-center justify-center'} px-16 pt-12 pb-6`}
      >
        <img
          src={images[index]}
          alt=""
          draggable={false}
          onClick={() => setZoomed((z) => !z)}
          className={
            zoomed
              ? 'm-auto block max-w-none cursor-zoom-out'
              : 'max-h-full max-w-full cursor-zoom-in rounded-md object-contain shadow-2xl'
          }
        />
      </div>
      {/* Below the title bar: the window's own minimize/close buttons sit at the very top. */}
      <div className="pointer-events-none absolute inset-x-0 top-10 flex items-center justify-between px-4">
        <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-slate-300">
          {many ? `${index + 1} / ${images.length}` : ''}
          {many && ' · '}
          {zoomed ? 'Click the image to fit it' : 'Click the image for full size'}
        </span>
        <button type="button" aria-label="Close" onClick={onClose} className={`pointer-events-auto ${roundButton}`}>
          <XIcon size={20} />
        </button>
      </div>
      {many && (
        <>
          <button type="button" aria-label="Previous image" onClick={() => step(-1)} className={`absolute top-1/2 left-3 -translate-y-1/2 ${roundButton}`}>
            <ChevronLeftIcon size={22} />
          </button>
          <button type="button" aria-label="Next image" onClick={() => step(1)} className={`absolute top-1/2 right-3 -translate-y-1/2 ${roundButton}`}>
            <ChevronRightIcon size={22} />
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
