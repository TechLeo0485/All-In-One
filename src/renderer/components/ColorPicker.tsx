import { PRESET_COLORS } from '../utils/colors'

/** Preset swatches plus a native picker for custom colors. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const isCustom = !PRESET_COLORS.includes(value.toLowerCase())
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          onClick={() => onChange(color)}
          className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-slate-900 transition ${
            value.toLowerCase() === color ? 'ring-2 ring-slate-300' : 'hover:scale-110'
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
          background: isCustom ? value : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'
        }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}
