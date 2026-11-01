import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { packBaseline } from '../../../../action/cli/lib/bundle.mjs'
import { loadBundle } from './loadBundle.js'

const hash = (text) => createHash('sha256').update(text).digest('hex')
test('both producers preserve verified base and named-state links; the loader rejects changed image bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-pack-'))
  try {
    const out = path.join(root, '.screenmap/out'), screens = path.join(out, 'screens')
    fs.mkdirSync(screens, { recursive: true })
    for (const [name, bytes] of Object.entries({ 'home.png': 'base', 'home--more.png': 'menu', 'profile.png': 'profile', 'profile--edit.png': 'edit' })) fs.writeFileSync(path.join(screens, name), bytes)
    const graph = { routes: [{ id: 'home', slug: 'home' }, { id: 'profile', slug: 'profile' }], edges: [] }
    fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph))
    const links = [{ label: 'Edit', to: 'profile', targetState: 'edit', rect: [0.1, 0.2, 0.3, 0.4] }, { label: 'Back', action: 'back', fallbackTo: 'home', rect: [0, 0, 0.1, 0.1] }]
    const records = [
      { node: 'home', variant: 'ios', sourceSha256: hash('base'), links: [...links, { label: 'Unknown fallback', action: 'back', fallbackTo: 'missing', rect: [0, 0, 0.1, 0.1] }, { label: 'Malformed fallback', action: 'back', fallbackTo: 123, rect: [0, 0, 0.1, 0.1] }, { label: 'Fallback on link', to: 'profile', fallbackTo: 'home', rect: [0, 0, 0.1, 0.1] }, { label: 'Bad', to: 'profile', targetState: 'missing', rect: [0, 0, 0.1, 0.1] }], scroll: { next: 'more' }, viewport: { width: 390, height: 844 } },
      { node: 'home', variant: 'ios', state: 'more', sourceSha256: hash('menu'), links: [links[1]], scroll: { previous: '$base' }, viewport: { width: -1, height: 844 } },
    ]
    fs.writeFileSync(path.join(out, 'hotspots.json'), JSON.stringify({ version: 1, captures: records }))
    const one = path.join(root, 'one.scrmap'), two = path.join(root, 'two.scrmap')
    const packer = path.resolve(import.meta.dirname, '../../../../plugins/screenmap/skills/screenmap/scripts/pack-map.mjs')
    execFileSync('node', [packer, root, '--out', one])
    packBaseline({ graph, platforms: [{ platform: 'ios', screensDir: screens }], hotspots: records, appName: 'test', out: two })
    const first = await loadBundle(fs.readFileSync(one)), second = await loadBundle(fs.readFileSync(two))
    const a = first.map.nodes[0].capture, b = second.map.nodes[0].capture
    assert.deepEqual(a.prototype, b.prototype)
    assert.deepEqual(a.states[0].prototype, b.states[0].prototype)
    assert.deepEqual(a.prototype.links, links)
    assert.equal(a.prototype.scroll.next, 'more')
    assert.equal(a.states[0].prototype.scroll.previous, '$base')
    assert.deepEqual(a.prototype.viewport, { width: 390, height: 844 })
    assert.equal(a.states[0].prototype.viewport, undefined)
    const files = unzipSync(fs.readFileSync(one))
    files['screens/home--more.png'] = new TextEncoder().encode('changed')
    const tampered = await loadBundle(zipSync(files))
    assert.equal(tampered.map.nodes[0].capture.states[0].prototype, undefined)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
