import { PRESET_COLORS } from '@shared/colors'

/** Preset swatches plus a native picker for custom colors. `null` = nothing selected. */
export function ColorPicker({ value, onChange }: { value: string | null; onChange: (color: string) => void }) {
  const selected = value?.toLowerCase() ?? null
  const isCustom = selected !== null && !PRESET_COLORS.includes(selected)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          onClick={() => onChange(color)}
          className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-slate-900 transition ${
            selected === color ? 'ring-2 ring-slate-300' : 'hover:scale-110'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
      <label
        title="Custom color"
        className={`relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-slate-700 ring-offset-2 ring-offset-slate-900 ${
          isCustom ? 'ring-2 ring-slate-300' : ''
        }`}
        style={{
          background: isCustom ? selected! : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'
        }}
      >
        <input
          type="color"
          value={value ?? '#3b82f6'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}
