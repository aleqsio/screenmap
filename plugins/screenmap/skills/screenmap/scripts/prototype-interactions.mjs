import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { validatePrototype, summarizeInteractions, sameInteractionControl } from './prototype-capture.mjs'

const kinds = new Set(['back', 'close', 'menu', 'navigate', 'dismiss', 'other'])
const frameValid = (rect) => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0 && rect[0] + rect[2] <= 1 && rect[1] + rect[3] <= 1
const sameOutcome = (a, b) => ['action', 'to', 'targetState', 'fallbackTo', 'scope'].every((key) => (a[key] ?? null) === (b[key] ?? null))

export function attachInteractions(nodes, axes, records, screensByAxis) {
  const unknownSources = []
  records = Array.isArray(records) ? records : []
  const known = new Set()
  for (const axis of axes) {
    const nested = axes.length > 1 || nodes.some((node) => node.captures)
    for (const node of nodes) {
      const capture = nested ? node.captures?.[axis] : node.capture
      if (!capture) continue
      for (const state of [capture, ...(capture.states ?? [])]) {
        const key = JSON.stringify([node.id, axis, state.name ?? null])
        known.add(key)
        const matches = records.filter((record) => record?.node === node.id && record.variant === axis && (record.state ?? null) === (state.name ?? null))
        const entry = matches[0]
        const file = state.screenshot ? path.join(screensByAxis[axis], path.basename(state.screenshot)) : null
        const sha = file && fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
        const invalid = !sha ? 'missing-screenshot' : !entry ? 'missing-inventory' : matches.length > 1 ? 'duplicate-inventory' : entry.sourceSha256 !== sha ? 'stale-inventory' : !Array.isArray(entry.controls) ? 'invalid-controls' : null
        const report = { status: invalid ? 'missing' : 'complete', sourceSha256: entry?.sourceSha256 ?? null, controls: [] }
        if (invalid) report.reason = invalid
        if (!invalid) {
          const ids = new Set()
          for (const control of entry.controls) {
            const item = { id: typeof control?.id === 'string' ? control.id : '', label: typeof control?.label === 'string' ? control.label : '', rect: frameValid(control?.rect) ? control.rect : null, kind: kinds.has(control?.kind) ? control.kind : 'other', status: 'unresolved' }
            let reason = typeof control?.id !== 'string' || !control.id.trim() || ids.has(control.id) ? 'invalid-control-id' : typeof control.label !== 'string' || !control.label.trim() ? 'missing-label' : !frameValid(control.rect) ? 'invalid-frame' : !kinds.has(control.kind) ? 'unknown-kind' : null
            ids.add(control?.id)
            if (!reason) {
              const outcome = control.outcome
              if (typeof outcome?.reason === 'string' && outcome.reason.trim()) reason = outcome.reason
              else if (!outcome || typeof outcome !== 'object') reason = 'unobserved-outcome'
              else {
                const candidate = { label: control.label, rect: control.rect, ...(control.kind === 'close' && outcome.action === 'back' ? { scope: 'screen' } : {}), ...Object.fromEntries(['action', 'to', 'targetState', 'fallbackTo'].filter((key) => outcome[key] !== undefined).map((key) => [key, outcome[key]])) }
                const valid = validatePrototype({ sourceSha256: sha, links: [candidate] }, sha, nodes, nested ? axis : null, node.id)
                if (!valid?.links.length) reason = 'invalid-or-missing-destination'
                else {
                  const existing = state.prototype?.links ?? []
                  const authored = existing.find((link) => sameInteractionControl(link, candidate))
                  if (authored && !sameOutcome(authored, candidate)) reason = 'authored-conflict'
                  else {
                    if (!authored) state.prototype = { ...(state.prototype ?? {}), sourceSha256: sha, links: [...existing, candidate] }
                    item.status = 'linked'
                  }
                }
              }
            }
            if (reason) { item.reason = reason; report.status = 'partial' }
            report.controls.push(item)
          }
        }
        state.interactions = report
      }
      if (nested && axis === axes[0]) node.capture = capture
    }
  }
  for (const record of records) {
    if (!known.has(JSON.stringify([record?.node, record?.variant, record?.state ?? null]))) unknownSources.push({ node: record?.node, variant: record?.variant, ...(record?.state ? { state: record.state } : {}), reason: 'unknown-or-uncaptured-source' })
  }
  return summarizeInteractions(nodes, axes, unknownSources)
}
