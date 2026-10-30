import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { packBaseline, readBaseline } from '../lib/bundle.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const button = (id, kind, outcome, rect) => ({ id, label: id, rect, kind, outcome })

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'interaction-merge-'))
  try {
    const out = path.join(root, '.screenmap/out')
    fs.mkdirSync(out, { recursive: true })
    await run({ root, out })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function prepare(out, graph, axes) {
  fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph))
  for (const [axis, files] of Object.entries(axes)) {
    const dir = path.join(out, 'screens', axis)
    fs.mkdirSync(dir, { recursive: true })
    for (const [file, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), bytes)
  }
}

test('CLI merge retains only each input platform inventories and revalidates their image bindings', async () => {
  await fixture(async ({ root, out }) => {
    const graph = { routes: [{ id: 'reader', slug: 'reader' }], edges: [] }
    prepare(out, graph, { ios: { 'reader.png': 'left-control' }, android: { 'reader.png': 'right-control' } })
    const inputs = []
    for (const platform of ['ios', 'android']) {
      const rect = platform === 'ios' ? [0.04, 0.07, 0.12, 0.06] : [0.84, 0.07, 0.12, 0.06]
      const interactions = [{ node: 'reader', variant: platform, sourceSha256: hash(platform === 'ios' ? 'left-control' : 'right-control'), controls: [button('Back', 'back', { action: 'back', fallbackTo: 'reader' }, rect)] }]
      const file = path.join(root, `${platform}.scrmap`)
      packBaseline({ graph, platforms: [{ platform, screensDir: path.join(out, 'screens', platform) }], interactions, appName: 'Reader', out: file })
      inputs.push(`${platform}=${file}`)
    }
    const merged = path.join(root, 'merged.scrmap')
    const cli = path.resolve(import.meta.dirname, '../screenmap-ci.mjs')
    execFileSync('node', [cli, 'merge', '--inputs', inputs.join(','), '--work', path.join(root, 'merge'), '--out', merged])
    const files = readBaseline(merged, path.join(root, 'merged-source'))
    const { map } = files
    assert.equal(map.interactionCoverage.status, 'complete')
    assert.equal(map.interactionCoverage.linked, 2)
    assert.equal(map.nodes[0].captures.ios.prototype.links[0].rect[0], 0.04)
    assert.equal(map.nodes[0].captures.android.prototype.links[0].rect[0], 0.84)
    assert.equal(files.interactions.length, 2)
  })
})
