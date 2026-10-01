import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { XIcon } from './icons'

/* Small set of reusable primitives so pages share consistent styling. */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400',
  secondary: 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 disabled:text-slate-500',
  danger: 'bg-transparent text-red-400 border border-red-500/30 hover:bg-red-500/10 disabled:text-red-900',
  ghost: 'text-slate-300 hover:bg-slate-800 disabled:text-slate-600'
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass} {...props} />
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export function ColorDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ backgroundColor: color, width: size, height: size }} />
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg'
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-full w-full ${width} flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" className="px-1.5!" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}
