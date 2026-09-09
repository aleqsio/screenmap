// Screen text, behind one interface with two backends.
//
//   vision     Apple Vision via native/ocr.swift, compiled once into a cache
//              dir; ~0.5s per capture afterwards. macOS only.
//   tesseract  the `tesseract` binary. The Linux lane: Android captures run on
//              ubuntu runners, where there is no Vision, and without OCR the
//              landing checks, deep-link verification and system-alert
//              dismissal all go dark.
//
// Both emit the SAME item shape — `{ text, x, y, w, h }` with normalized
// coordinates and Vision's **bottom-left** origin — because callers convert to
// tap coordinates with `y = 1 - (y + h / 2)`. Tesseract reports pixels from
// the top-left, so the adapter below does the flip; getting this wrong taps
// the mirror image of the button.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { log } from './util.mjs'

const SRC = new URL('./native/ocr.swift', import.meta.url).pathname

// SCREENMAP_OCR forces a backend: vision | tesseract | off. Mostly for testing
// the Linux path from a Mac — otherwise the best available backend wins.
const forced = () => (process.env.SCREENMAP_OCR || '').toLowerCase() || null

let visionBin
function visionAvailable() {
  if (visionBin !== undefined) return !!visionBin
  if (process.platform !== 'darwin' || !fs.existsSync(SRC)) return !(visionBin = null)
  const dir = path.join(os.homedir(), '.cache', 'screenmap-ci')
  fs.mkdirSync(dir, { recursive: true })
  const bin = path.join(dir, `ocr-${fs.statSync(SRC).size}`)
  if (!fs.existsSync(bin)) {
    log('compiling Vision OCR helper (one-time)…')
    const r = spawnSync('swiftc', ['-O', '-o', bin, SRC], { encoding: 'utf8' })
    if (r.status !== 0) { log('swiftc failed:', (r.stderr || '').slice(-300)); return !(visionBin = null) }
  }
  visionBin = bin
  return true
}

let tessBin
function tesseractAvailable() {
  if (tessBin !== undefined) return !!tessBin
  const r = spawnSync('tesseract', ['--version'], { encoding: 'utf8' })
  return !!(tessBin = r.status === 0 ? 'tesseract' : null)
}

// Which backend a call would use, or null. Resolving this also does the
// one-time compile, so callers can pay that cost at a moment of their choosing
// (openSession does, so it does not land mid-way through the Metro connect
// loop and starve a small runner).
export function ocrBackend() {
  const f = forced()
  if (f === 'off') return null
  if (f === 'vision') return visionAvailable() ? 'vision' : null
  if (f === 'tesseract') return tesseractAvailable() ? 'tesseract' : null
  if (visionAvailable()) return 'vision'
  if (tesseractAvailable()) return 'tesseract'
  return null
}
export const ocrAvailable = () => ocrBackend() !== null

// PNG dimensions from the IHDR chunk — tesseract's TSV reports pixels and says
// nothing about the page size, and this beats shelling out to `sips`/`identify`
// for a value that sits in the first 24 bytes of the file.
function pngSize(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const b = Buffer.alloc(24)
    if (fs.readSync(fd, b, 0, 24, 0) < 24) return null
    if (b.toString('latin1', 1, 4) !== 'PNG' || b.toString('latin1', 12, 16) !== 'IHDR') return null
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  } catch { return null } finally { fs.closeSync(fd) }
}

function ocrVision(png) {
  return execFileSync(visionBin, [png], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

// Tesseract TSV is one row per word; Vision reports whole strings, and the
// callers' word-set comparisons and "tap the button labelled X" lookups both
// assume that granularity. So group words back into their source line
// (block/par/line triple) and union their boxes.
function ocrTesseract(png) {
  const size = pngSize(png)
  if (!size) return []
  // psm 11 (sparse text) reads scattered UI labels far better than the default
  // page-layout mode, which expects paragraphs of prose.
  const r = spawnSync('tesseract', [png, 'stdout', '--psm', '11', '-c', 'tessedit_create_tsv=1'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) { log('tesseract failed:', (r.stderr || '').trim().slice(-300)); return [] }
  const lines = (r.stdout || '').split('\n')
  const head = lines[0]?.split('\t') ?? []
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]))
  if (col.text === undefined || col.left === undefined) return []
  const groups = new Map()
  for (const raw of lines.slice(1)) {
    const f = raw.split('\t')
    if (f.length < head.length) continue
    if (Number(f[col.level]) !== 5) continue // 5 = word
    const text = (f[col.text] ?? '').trim()
    if (!text) continue
    if (Number(f[col.conf]) < 40) continue // low-confidence words are usually icon noise
    const key = `${f[col.block_num]}/${f[col.par_num]}/${f[col.line_num]}`
    const left = Number(f[col.left]), top = Number(f[col.top])
    const width = Number(f[col.width]), height = Number(f[col.height])
    const g = groups.get(key)
    if (!g) groups.set(key, { words: [text], x0: left, y0: top, x1: left + width, y1: top + height })
    else {
      g.words.push(text)
      g.x0 = Math.min(g.x0, left); g.y0 = Math.min(g.y0, top)
      g.x1 = Math.max(g.x1, left + width); g.y1 = Math.max(g.y1, top + height)
    }
  }
  return [...groups.values()].map((g) => ({
    text: g.words.join(' '),
    x: g.x0 / size.w,
    // top-left pixels → Vision's bottom-left normalized origin
    y: 1 - g.y1 / size.h,
    w: (g.x1 - g.x0) / size.w,
    h: (g.y1 - g.y0) / size.h,
  }))
}

export function ocr(pngPath) {
  const backend = ocrBackend()
  if (!backend) return []
  try {
    return backend === 'vision' ? ocrVision(pngPath) : ocrTesseract(pngPath)
  } catch { return [] }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'this', 'that', 'from', 'are', 'was', 'not', 'all', 'any', 'more', 'ago', 'min', 'now', 'new', 'see', 'via'])
export function words(items) {
  const out = new Set()
  for (const it of items) for (const w of it.text.toLowerCase().split(/[^a-z0-9@#']+/)) {
    if (w.length < 3 || /^\d+$/.test(w) || STOP.has(w)) continue
    out.add(w)
  }
  return out
}
export const jaccard = (a, b) => { if (!a.size && !b.size) return 1; let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i) }
export const containment = (needles, hay) => { if (!needles.size) return null; let i = 0; for (const w of needles) if (hay.has(w)) i++; return i / needles.size }

const ALERT_HINTS = [/would like/i, /don['’]t allow/i, /^allow$/i, /allow while using/i, /allow once/i, /^not now$/i, /turn on/i, /^ok$/i,
  // Android's runtime permission dialog wording
  /while using the app/i, /only this time/i, /^deny$/i, /don['’]t allow/i,
  // Android's ANR dialog. hide_error_dialogs should stop these being drawn at
  // all (see android.mjs), but a slow emulator is exactly where they appear and
  // exactly where a capture cannot afford one — it is modal and stays up.
  /isn['’]t responding/i, /has stopped/i, /keeps stopping/i, /^wait$/i, /^close app$/i]
// a system permission/alert is up if several of its tell-tale strings are visible
export function alertButtons(items) {
  const texts = items.map((i) => i.text.trim())
  const hits = texts.filter((t) => ALERT_HINTS.some((re) => re.test(t)))
  if (hits.length < 2) return []
  // most conservative first. "Wait" beats "Close app" on an ANR: the app under
  // test is the thing being mapped, and killing it ends the run.
  const order = [/^wait$/i, /don['’]t allow/i, /^deny$/i, /^not now$/i, /^ok$/i, /only this time/i, /allow once/i, /while using the app/i, /allow while using/i, /^allow$/i, /limit access/i]
  return items.filter((i) => order.some((re) => re.test(i.text.trim()))).sort((a, b) => order.findIndex((re) => re.test(a.text)) - order.findIndex((re) => re.test(b.text)))
}
