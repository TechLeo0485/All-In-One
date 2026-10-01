import { useAppStore } from '../stores/appStore'
import { AlertIcon, XIcon } from './icons'

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-2.5 text-sm shadow-lg ${
            t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-700 text-white ring-1 ring-white/10'
          }`}
        >
          {t.kind === 'error' && <AlertIcon className="mt-0.5 shrink-0" />}
          <span className="selectable">{t.message}</span>
          <button className="ml-2 shrink-0 opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
