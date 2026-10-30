import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  node: { type: 'string' }, variant: { type: 'string', default: 'ios' },
  state: { type: 'string' }, controls: { type: 'string' },
  'out-dir': { type: 'string' }, graph: { type: 'string' },
} })
if (positionals.length !== 1 || !values.node || !values.controls) {
  console.error('Usage: node record-interactions.mjs <project> --node <route-id> --controls <observed.json> [--variant ios|android|variant-id] [--state <name>]')
  process.exit(1)
}
const out = values['out-dir'] ? path.resolve(values['out-dir']) : path.resolve(positionals[0], '.screenmap/out')
const graph = JSON.parse(fs.readFileSync(values.graph ?? path.join(out, 'graph.json'), 'utf8'))
const route = graph.routes.find((route) => route.id === values.node)
if (!route) throw new Error(`Unknown route: ${values.node}`)
for (const value of [route.slug, values.variant, values.state].filter(Boolean)) {
  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') throw new Error(`Invalid capture path segment: ${value}`)
}
const stem = route.slug + (values.state ? `--${values.state}` : '')
const candidates = [path.join(out, 'screens', values.variant), path.join(out, 'screens')]
const screenshot = candidates.flatMap((dir) => ['png', 'jpg', 'jpeg', 'webp'].map((ext) => path.join(dir, `${stem}.${ext}`))).find((file) => fs.existsSync(file))
if (!screenshot) throw new Error(`Capture first: ${stem} (${values.variant})`)
const controls = JSON.parse(fs.readFileSync(values.controls, 'utf8'))
if (!Array.isArray(controls)) throw new Error('Controls must be an array observed on this screenshot')
const ids = new Set()
for (const control of controls) {
  if (!control || typeof control.id !== 'string' || !control.id.trim() || ids.has(control.id)) throw new Error('Each control needs a unique nonempty id')
  ids.add(control.id)
  if (typeof control.label !== 'string' || !control.label.trim()) throw new Error(`Missing label: ${control.id}`)
  if (!['back', 'close', 'menu', 'navigate', 'dismiss', 'other'].includes(control.kind)) throw new Error(`Invalid kind: ${control.id}`)
  const rect = control.rect
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > 1.000001 || rect[1] + rect[3] > 1.000001) throw new Error(`Invalid normalized frame: ${control.id}`)
  const outcome = control.outcome
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) throw new Error(`Record a verified outcome or unresolved reason: ${control.id}`)
  if (outcome.reason !== undefined && (typeof outcome.reason !== 'string' || !outcome.reason.trim() || outcome.to || outcome.action || outcome.targetState || outcome.fallbackTo)) throw new Error(`Reason cannot also declare navigation: ${control.id}`)
  if (!outcome.reason && outcome.action !== 'back' && !(typeof outcome.to === 'string' && outcome.to.trim())) throw new Error(`Record a destination, Back, or reason: ${control.id}`)
}
const file = path.join(out, 'interactions.json')
const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, captures: [] }
if (prior.version !== 1 || !Array.isArray(prior.captures)) throw new Error('Unsupported interactions.json')
const entry = { node: values.node, variant: values.variant, ...(values.state ? { state: values.state } : {}), sourceSha256: createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex'), controls }
prior.captures = prior.captures.filter((capture) => capture.node !== entry.node || capture.variant !== entry.variant || (capture.state ?? '') !== (entry.state ?? ''))
prior.captures.push(entry)
const temporary = `${file}.${process.pid}.tmp`
try {
  fs.writeFileSync(temporary, JSON.stringify(prior, null, 2) + '\n', { flag: 'wx' })
  fs.renameSync(temporary, file)
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
}
console.log(`Recorded ${controls.length} controls: ${entry.node} / ${entry.variant} / ${entry.state ?? 'base'}`)
