import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { packBaseline, packDiff, readBaseline } from '../../../../action/cli/lib/bundle.mjs'
import { loadBundle } from './loadBundle.js'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const button = (id, kind, outcome, rect = [0.04, 0.07, 0.12, 0.06]) => ({ id, label: id, rect, kind, outcome })
const packer = path.resolve(import.meta.dirname, '../../../../plugins/screenmap/skills/screenmap/scripts/pack-map.mjs')
const recorder = path.join(path.dirname(packer), 'record-interactions.mjs')

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-interactions-'))
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

test('first-map pack derives exact RTL menu, dismiss and Back hotspots from runtime inventories without authored hotspots', async () => {
  await fixture(async ({ root, out }) => {
    const graph = { routes: [{ id: 'dashboard', slug: 'dashboard' }, { id: 'wallet', slug: 'wallet' }], edges: [] }
    prepare(out, graph, { en: { 'dashboard.png': 'home-en', 'dashboard--menu.png': 'menu-en', 'wallet.png': 'wallet-en' }, ar: { 'dashboard.png': 'home-ar', 'dashboard--menu.png': 'menu-ar', 'wallet.png': 'wallet-ar' } })
    const captures = ['en', 'ar'].flatMap((variant) => {
      const rect = variant === 'ar' ? [0.84, 0.07, 0.12, 0.06] : [0.04, 0.07, 0.12, 0.06]
      return [
        { node: 'dashboard', variant, sourceSha256: hash(`home-${variant}`), controls: [button('Open menu', 'menu', { to: 'dashboard', targetState: 'menu' }, rect)] },
        { node: 'dashboard', variant, state: 'menu', sourceSha256: hash(`menu-${variant}`), controls: [button('Dismiss menu', 'dismiss', { to: 'dashboard' }, rect), button('Wallet', 'navigate', { to: 'wallet' }, [0.2, 0.2, 0.6, 0.1])] },
        { node: 'wallet', variant, sourceSha256: hash(`wallet-${variant}`), controls: [button('Close', 'close', { action: 'back', fallbackTo: 'dashboard' }, rect)] },
      ]
    })
    for (const capture of captures) {
      const controls = path.join(root, 'observed-controls.json')
      fs.writeFileSync(controls, JSON.stringify(capture.controls))
      execFileSync('node', [recorder, root, '--node', capture.node, '--variant', capture.variant, '--controls', controls, ...(capture.state ? ['--state', capture.state] : [])])
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'interactions.json'), 'utf8')).captures, captures)
    const originalInventory = fs.readFileSync(path.join(out, 'interactions.json'), 'utf8')
    const malformed = path.join(root, 'bad-controls.json')
    fs.writeFileSync(malformed, JSON.stringify([button('bad frame', 'close', { action: 'back' }, [0.9, 0.1, 0.5, 0.2])]))
    assert.throws(() => execFileSync('node', [recorder, root, '--node', 'wallet', '--variant', 'ar', '--controls', malformed], { stdio: 'pipe' }), /Invalid normalized frame/)
    assert.equal(fs.readFileSync(path.join(out, 'interactions.json'), 'utf8'), originalInventory)
    const bundlePath = path.join(root, 'first.scrmap')
    execFileSync('node', [packer, root, '--variants', 'en,ar', '--out', bundlePath])
    const { map } = await loadBundle(fs.readFileSync(bundlePath))
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'interaction-coverage.json'), 'utf8')).status, 'complete')
    assert.equal(JSON.parse(new TextDecoder().decode(unzipSync(fs.readFileSync(bundlePath))['interaction-coverage.json'])).status, 'complete')
    assert.equal(map.interactionCoverage.status, 'complete')
    assert.equal(map.interactionCoverage.linked, 8)
    assert.deepEqual(map.nodes[0].captures.ar.prototype.links[0].rect, [0.84, 0.07, 0.12, 0.06])
    assert.equal(map.nodes[0].captures.en.prototype.links[0].targetState, 'menu')
    assert.equal(map.nodes[0].captures.en.states[0].prototype.links[0].to, 'dashboard')
    assert.equal(map.nodes[1].captures.ar.prototype.links[0].fallbackTo, 'dashboard')
    assert.equal(map.nodes[1].captures.ar.prototype.links[0].scope, 'screen')
    const files = unzipSync(fs.readFileSync(bundlePath))
    files['screens/en/dashboard.png'] = new TextEncoder().encode('tampered')
    const changed = await loadBundle(zipSync(files))
    assert.equal(changed.map.interactionCoverage.status, 'partial')
    assert.equal(changed.map.interactionCoverage.linked, 7)
    assert.equal(changed.map.nodes[0].captures.en.prototype, undefined)
    assert.equal(changed.map.nodes[0].captures.en.interactions.reason, 'stale-inventory')
    assert.equal(changed.map.nodes[0].captures.en.interactions.controls[0].status, 'unresolved')
  })
})

test('CI pack auto-loads generic inventories for a second app and preserves authored overlapping hotspots', async () => {
  await fixture(async ({ root, out }) => {
    const graph = { routes: [{ id: 'library', slug: 'library' }, { id: 'book', slug: 'book' }], edges: [] }
    prepare(out, graph, { ios: { 'library.png': 'books', 'book.png': 'reader' } })
    const captures = [
      { node: 'library', variant: 'ios', sourceSha256: hash('books'), controls: [button('Open book', 'navigate', { to: 'book' })] },
      { node: 'book', variant: 'ios', sourceSha256: hash('reader'), controls: [button('Back', 'back', { action: 'back', fallbackTo: 'library' })] },
    ]
    const authored = { label: 'Curated book link', to: 'book', rect: [0.03, 0.06, 0.14, 0.08] }
    fs.writeFileSync(path.join(out, 'interactions.json'), JSON.stringify({ version: 1, captures }))
    const bundlePath = path.join(root, 'ci.scrmap')
    packBaseline({ graph, platforms: [{ platform: 'ios', screensDir: path.join(out, 'screens/ios') }], flowsDir: path.join(out, 'flows'), hotspots: [{ node: 'library', variant: 'ios', sourceSha256: hash('books'), links: [authored] }], appName: 'Reader', out: bundlePath })
    const { map } = await loadBundle(fs.readFileSync(bundlePath))
    assert.equal(map.interactionCoverage.status, 'complete')
    assert.deepEqual(map.nodes[0].capture.prototype.links, [authored])
    assert.equal(map.nodes[1].capture.prototype.links[0].fallbackTo, 'library')
    const prior = readBaseline(bundlePath, path.join(root, 'previous'))
    assert.deepEqual(prior.interactions, captures)
    const reused = path.join(root, 'reused.scrmap')
    packBaseline({ graph: prior.graph, platforms: [{ platform: 'ios', screensDir: prior.screensDir }], interactions: prior.interactions, appName: 'Reader', out: reused })
    assert.equal((await loadBundle(fs.readFileSync(reused))).map.interactionCoverage.status, 'complete')
    fs.writeFileSync(path.join(prior.screensDir, 'library.png'), 'new-library')
    packBaseline({ graph: prior.graph, platforms: [{ platform: 'ios', screensDir: prior.screensDir }], interactions: prior.interactions, appName: 'Reader', out: reused })
    assert.equal((await loadBundle(fs.readFileSync(reused))).map.nodes[0].capture.interactions.reason, 'stale-inventory')
  })
})

test('stale images, uncaptured targets and unobserved controls remain explicit unresolved coverage', async () => {
  await fixture(async ({ root, out }) => {
    const graph = { routes: [{ id: 'player', slug: 'player' }, { id: 'old', slug: 'old' }, { id: 'uncaptured', slug: 'uncaptured' }], edges: [] }
    prepare(out, graph, { ios: { 'player.png': 'player-error', 'old.png': 'changed' } })
    const interactions = [
      { node: 'player', variant: 'ios', sourceSha256: hash('player-error'), controls: [button('More', 'menu', { to: 'player', targetState: 'missing-menu' }), button('Retry', 'other', { reason: 'network-action-not-simulated' }), button('Open missing', 'navigate', { to: 'uncaptured' })] },
      { node: 'old', variant: 'ios', sourceSha256: hash('old'), controls: [button('Back', 'back', { action: 'back', fallbackTo: 'player' })] },
      { node: 'removed', variant: 'ios', sourceSha256: hash('removed'), controls: [] },
    ]
    const bundlePath = path.join(root, 'partial.scrmap')
    packBaseline({ graph, platforms: [{ platform: 'ios', screensDir: path.join(out, 'screens/ios') }], interactions, appName: 'Player', out: bundlePath })
    const { map } = await loadBundle(fs.readFileSync(bundlePath))
    assert.equal(map.interactionCoverage.status, 'partial')
    assert.equal(map.nodes[0].capture.interactions.status, 'partial')
    assert.deepEqual(map.nodes[0].capture.interactions.controls.map((c) => c.reason), ['invalid-or-missing-destination', 'network-action-not-simulated', 'invalid-or-missing-destination'])
    assert.equal(map.nodes[0].capture.prototype, undefined)
    assert.equal(map.nodes[1].capture.interactions.reason, 'stale-inventory')
    assert.equal(map.nodes[1].capture.prototype, undefined)
    assert.equal(map.nodes[2].capture.interactions.reason, 'missing-screenshot')
    assert.ok(map.interactionCoverage.unresolvedCaptures.some((c) => c.node === 'removed' && c.reason === 'unknown-or-uncaptured-source'))
  })
})


test('a broad dismissal area does not swallow a small control; conflicting authored destinations stay unresolved', async () => {
  await fixture(async ({ root, out }) => {
    const graph = { routes: [{ id: 'inbox', slug: 'inbox' }, { id: 'message', slug: 'message' }], edges: [] }
    prepare(out, graph, { ios: { 'inbox.png': 'inbox', 'message.png': 'message' } })
    const interactions = [
      { node: 'inbox', variant: 'ios', sourceSha256: hash('inbox'), controls: [button('Open', 'navigate', { to: 'message' })] },
      { node: 'message', variant: 'ios', sourceSha256: hash('message'), controls: [button('Close', 'close', { action: 'back', fallbackTo: 'inbox' })] },
    ]
    const hotspots = [
      { node: 'inbox', variant: 'ios', sourceSha256: hash('inbox'), links: [{ label: 'Backdrop', to: 'inbox', rect: [0, 0, 1, 1] }] },
      { node: 'message', variant: 'ios', sourceSha256: hash('message'), links: [{ label: 'Curated close', to: 'inbox', rect: [0.04, 0.07, 0.12, 0.06] }] },
    ]
    const bundlePath = path.join(root, 'conflict.scrmap')
    packBaseline({ graph, platforms: [{ platform: 'ios', screensDir: path.join(out, 'screens/ios') }], interactions, hotspots, appName: 'Inbox', out: bundlePath })
    const { map } = await loadBundle(fs.readFileSync(bundlePath))
    assert.equal(map.nodes[0].capture.prototype.links.length, 2)
    assert.equal(map.nodes[0].capture.prototype.links[1].to, 'message')
    assert.equal(map.nodes[1].capture.interactions.controls[0].reason, 'authored-conflict')
    assert.equal(map.nodes[1].capture.prototype.links.length, 1)
    assert.equal(map.interactionCoverage.status, 'partial')
  })
})


for (const platforms of [['ios'], ['ios', 'android']]) test(`diff producer retains per-side observed menu and Back actions on ${platforms.join('+')}`, async () => {
  await fixture(async ({ root }) => {
    const diffDir = path.join(root, 'diff')
    const graph = { routes: [{ id: 'main', slug: 'main', urlPath: '/main' }, { id: 'detail', slug: 'detail', urlPath: '/detail' }, { id: 'uncaptured', slug: 'uncaptured', urlPath: '/uncaptured' }], edges: [] }
    for (const side of ['base', 'head']) {
      const out = path.join(diffDir, side)
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph))
      const captures = platforms.flatMap((platform) => {
        const screens = path.join(out, 'screens', ...(platforms.length > 1 ? [platform] : []))
        fs.mkdirSync(screens, { recursive: true })
        for (const file of ['main.png', 'main--menu.png', 'detail.png']) fs.writeFileSync(path.join(screens, file), `${side}-${file}`)
        const rect = side === 'head' ? [0.84, 0.07, 0.12, 0.06] : [0.04, 0.07, 0.12, 0.06]
        return [
        { node: 'main', variant: platform, sourceSha256: hash(`${side}-main.png`), controls: [button('More', 'menu', { to: 'main', targetState: 'menu' }, rect)] },
        { node: 'main', variant: platform, state: 'menu', sourceSha256: hash(`${side}-main--menu.png`), controls: [button('Dismiss', 'dismiss', { to: 'main' }, [0.02, 0.2, 0.96, 0.3])] },
        { node: 'detail', variant: platform, sourceSha256: hash(`${side}-detail.png`), controls: [button('Close', 'close', { action: 'back', fallbackTo: 'main' }, rect)] },
        ]
      })
      fs.writeFileSync(path.join(out, 'interactions.json'), JSON.stringify({ version: 1, captures }))
    }
    fs.writeFileSync(path.join(diffDir, 'changed-files.txt'), 'app/main.tsx\n')
    fs.writeFileSync(path.join(diffDir, 'suspects.json'), JSON.stringify({ capture: [{ id: 'main', slug: 'main', status: 'M', side: 'both', reason: 'changed' }, { id: 'detail', slug: 'detail', status: 'M', side: 'both', reason: 'changed' }], broadFiles: [] }))
    const bundlePath = path.join(root, 'navigation.diff.scrmap')
    packDiff({ diffDir, platforms: platforms.map((platform) => ({ platform })), out: bundlePath })
    const { map } = await loadBundle(fs.readFileSync(bundlePath))
    assert.equal(map.nodes[0].capture.prototype.links[0].targetState, 'menu')
    assert.equal(map.nodes[0].captureBase.prototype.links[0].targetState, 'menu')
    assert.equal(map.nodes[0].capture.states[0].prototype.links[0].to, 'main')
    assert.equal(map.nodes[1].capture.prototype.links[0].fallbackTo, 'main')
    assert.equal(map.nodes[1].capture.prototype.links[0].rect[0], 0.84)
    assert.equal(map.nodes[1].captureBase.prototype.links[0].rect[0], 0.04)
    assert.equal(map.nodes[2].capture.interactions.reason, 'missing-screenshot')
    const files = unzipSync(fs.readFileSync(bundlePath))
    assert.equal(map.interactionCoverage.linked, 3 * platforms.length)
    assert.equal(map.interactionCoverage.missing, platforms.length)
    assert.equal(JSON.parse(new TextDecoder().decode(files['head/interactions.json'])).captures.length, 3 * platforms.length)
    files[platforms.length > 1 ? 'head/screens/ios/detail.png' : 'head/screens/detail.png'] = new TextEncoder().encode('changed-after-pack')
    const stale = await loadBundle(zipSync(files))
    assert.equal(stale.map.nodes[1].capture.prototype, undefined)
    assert.equal(stale.map.nodes[1].capture.interactions.reason, 'stale-inventory')
    assert.equal(stale.map.nodes[1].captureBase.interactions.status, 'complete')
    assert.equal(stale.map.interactionCoverage.linked, 3 * platforms.length - 1)
  })
})
