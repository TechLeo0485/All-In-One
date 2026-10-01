// Generates All-In-One's icons: a calendar page drawn in code (no source artwork).
// Run with: npm run icons   (plain Node, no extra dependencies)
//
// Outputs (resources/):
//   icon.png       256px app icon: window, installer, notifications, About
//   tray-16..48    tray icons: fewer, bigger day cells so they stay readable at 16 px
//   identity.png   64px icon registered with Windows for the notification header
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// Colors as [r, g, b] (Tailwind palette, matching the app's blue-600 accent).
const PAGE = [248, 250, 252] // slate-50
const OUTLINE = [203, 213, 225] // slate-300
const HEADER = [37, 99, 235] // blue-600
const RING = [51, 65, 85] // slate-700
const CELL = [203, 213, 225] // slate-300
const TODAY = [59, 130, 246] // blue-500

/** True if (x, y) lies inside the rounded rectangle (all in 0..1 icon units). */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/**
 * The calendar's shapes, back to front. `cols` x `rows` day cells; small icons
 * use fewer cells and no outline so the shape stays legible.
 */
function shapes({ cols, rows, outline }) {
  const list = []
  const page = [0.08, 0.13, 0.92, 0.93, 0.13]
  if (outline) list.push({ color: OUTLINE, rect: page })
  const inset = outline ? 0.025 : 0
  list.push({ color: PAGE, rect: [page[0] + inset, page[1] + inset, page[2] - inset, page[3] - inset, page[4] - inset] })
  list.push({ color: HEADER, rect: page, clipBottom: 0.38 })

  // Day grid below the header; the second cell is "today".
  const [gx0, gy0, gx1, gy1] = [0.18, 0.47, 0.82, 0.85]
  const gap = 0.06
  const cw = (gx1 - gx0 - gap * (cols - 1)) / cols
  const ch = (gy1 - gy0 - gap * (rows - 1)) / rows
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = gx0 + col * (cw + gap)
      const y = gy0 + row * (ch + gap)
      const today = row === 0 && col === 1
      list.push({ color: today ? TODAY : CELL, rect: [x, y, x + cw, y + ch, Math.min(cw, ch) * 0.25] })
    }
  }

  // Binder rings over the top edge.
  for (const cx of [0.32, 0.68]) list.push({ color: RING, rect: [cx - 0.045, 0.05, cx + 0.045, 0.25, 0.045] })
  return list
}

/** Renders the icon at `size` px with 8x8 supersampling, returning RGBA pixels. */
function render(size, detail) {
  const ss = 8
  const list = shapes(detail)
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Accumulate premultiplied color over the subsamples.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size
          const y = (py + (sy + 0.5) / ss) / size
          let color = null
          for (const s of list) {
            if (s.clipBottom !== undefined && y > s.clipBottom) continue
            if (inRoundRect(x, y, ...s.rect)) color = s.color
          }
          if (!color) continue
          r += color[0]
          g += color[1]
          b += color[2]
          a++
        }
      }
      const o = (py * size + px) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        out[o + 3] = Math.round((a / (ss * ss)) * 255)
      }
    }
  }
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/** Encodes RGBA pixels as an 8-bit RGBA PNG. */
function toPng(size, detail) {
  const rgba = render(size, detail)
  const raw = Buffer.alloc(size * (size * 4 + 1)) // each row: filter byte 0 + pixels
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const full = { cols: 3, rows: 2, outline: true }
const simple = { cols: 2, rows: 2, outline: false }

mkdirSync('resources', { recursive: true })
writeFileSync('resources/icon.png', toPng(256, full))
for (const size of [16, 24, 32, 48]) writeFileSync(`resources/tray-${size}.png`, toPng(size, size <= 24 ? simple : full))
// Windows notification-header icon (registered as the app identity). Windows only
// renders small, simple PNGs there.
writeFileSync('resources/identity.png', toPng(64, full))

console.log('Icons written to resources/')
