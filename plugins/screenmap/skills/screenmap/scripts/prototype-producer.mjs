import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { validatePrototype } from './prototype-capture.mjs'

export function attachPrototype(nodes, axes, records, screensByAxis) {
  for (const axis of axes) {
    const nested = axes.length > 1 || nodes.some((n) => n.captures)
    for (const node of nodes) {
      const capture = nested ? node.captures?.[axis] : node.capture
      if (!capture) continue
      for (const state of [capture, ...(capture.states ?? [])]) {
        const entry = records.find((r) => r?.node === node.id && r.variant === axis && (r.state ?? '') === (state.name ?? ''))
        if (!entry || !state.screenshot) continue
        const file = path.join(screensByAxis[axis], path.basename(state.screenshot))
        if (!fs.existsSync(file)) continue
        const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
        const valid = validatePrototype(entry, sha, nodes, nested ? axis : null, node.id)
        if (valid) state.prototype = valid
      }
      if (nested && axis === axes[0]) node.capture = capture
    }
  }
}
