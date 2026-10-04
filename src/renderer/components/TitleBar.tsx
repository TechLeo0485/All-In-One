import type { CSSProperties } from 'react'
import { APP_NAME } from '@shared/brand'
import { AppLogo } from './AppLogo'

/** Must match titleBarOverlay.height in the main process (src/main/index.ts). */
const TITLE_BAR_HEIGHT = 32

/**
 * Draggable title bar. The window has no native title bar (so no system menu
 * behind the app icon); Windows draws minimize/maximize/close on the right.
 */
export function TitleBar() {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 pl-3 text-xs text-slate-300 select-none"
      // env(titlebar-area-width) leaves room for the window buttons.
      style={{ height: TITLE_BAR_HEIGHT, WebkitAppRegion: 'drag', paddingRight: 'calc(100% - env(titlebar-area-width, 100%))' } as CSSProperties}
    >
      <AppLogo size={16} />
      <span>{APP_NAME}</span>
    </div>
  )
}
