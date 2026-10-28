// node --test src/lib   (from apps/visualiser)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowResolution } from './loadBundle.js'

// A react-navigation screen absent from the linking config is packed with
// urlPath: null (docs/scrmap-format.md). It can only be reached by tapping,
// which flows record through the sidecar's `screen` field.
const map = {
  nodes: [
    { id: 'Feed', urlPath: '/feed' },
    { id: 'Profile', urlPath: '/profile/:userId' },
    { id: 'Onboarding', urlPath: null },
  ],
  flows: [
    {
      name: 'nav-onboarding',
      route: 'Onboarding',
      steps: [
        { action: 'open_url', url: 'rndemo://feed' },
        { action: 'tap', target: 'Get started', screen: 'Onboarding' },
        { action: 'screenshot', file: 'Onboarding.png' },
      ],
    },
    {
      name: 'dl-profile',
      route: 'Profile',
      steps: [{ action: 'open_url', url: 'rndemo://profile/42?tab=posts' }, { action: 'wait', seconds: 2 }],
    },
  ],
}

test('a node without a URL does not crash flow resolution', () => {
  assert.doesNotThrow(() => flowResolution(map))
})

test('URL-less nodes are still reached through a step\'s screen field', () => {
  const { paths, nodeAtStep } = flowResolution(map)
  assert.deepEqual(paths['nav-onboarding'], ['Feed', 'Onboarding'])
  assert.deepEqual(nodeAtStep['nav-onboarding'], ['Feed', 'Onboarding', 'Onboarding'])
})

test('deep links still resolve against nodes that have a URL pattern', () => {
  const { paths } = flowResolution(map)
  assert.deepEqual(paths['dl-profile'], ['Profile'])
})

test('a deep link never resolves to a URL-less node', () => {
  const { paths } = flowResolution({
    nodes: [{ id: 'Onboarding', urlPath: null }],
    flows: [{ name: 'root', route: null, steps: [{ action: 'open_url', url: 'rndemo://' }] }],
  })
  assert.deepEqual(paths.root, [])
})

// Variants axis: pack-map --variants writes `captures` keyed by variant id.
test('withVariant swaps capture to the chosen variant and variantsOf lists them', async () => {
  const { variantsOf, withVariant } = await import('./loadBundle.js')
  const cap = (id) => ({ status: 'ok', screenshot: `screens/${id}/Feed.png`, states: [] })
  const bundle = {
    manifest: { variants: [{ id: 'en-light', label: 'en-light' }, { id: 'ar-dark', label: 'Arabic · dark' }] },
    map: { nodes: [{ id: 'Feed', capture: cap('en-light'), captures: { 'en-light': cap('en-light'), 'ar-dark': cap('ar-dark') } }] },
  }
  assert.deepEqual(variantsOf(bundle).map((v) => v.id), ['en-light', 'ar-dark'])
  assert.equal(withVariant(bundle, 'ar-dark').map.nodes[0].capture.screenshot, 'screens/ar-dark/Feed.png')
  assert.deepEqual(variantsOf({ manifest: {} }), [])
  const plain = { manifest: {}, map: { nodes: [] } }
  assert.equal(withVariant(plain, 'x'), plain)
})

// Packed bundle with variants loads end to end (needs `zip`, as pack-map does).
test('pack-map --variants output loads through loadBundle', async () => {
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const { loadBundle, variantsOf } = await import('./loadBundle.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scrmap-variants-'))
  const out = path.join(root, '.screenmap', 'out')
  for (const v of ['en-light', 'ar-dark']) fs.mkdirSync(path.join(out, 'screens', v), { recursive: true })
  fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify({ appName: 'T', routes: [{ id: 'feed', slug: 'feed', urlPath: '/feed' }], edges: [] }))
  for (const v of ['en-light', 'ar-dark']) fs.writeFileSync(path.join(out, 'screens', v, 'feed.png'), 'x')
  const packer = path.join(import.meta.dirname, '../../../../plugins/screenmap/skills/screenmap/scripts/pack-map.mjs')
  const file = path.join(root, 't.scrmap')
  execFileSync('node', [packer, root, '--variants', 'en-light,ar-dark', '--out', file])
  const b = await loadBundle(fs.readFileSync(file))
  assert.deepEqual(variantsOf(b).map((v) => v.id), ['en-light', 'ar-dark'])
  assert.equal(b.map.nodes[0].captures['ar-dark'].screenshot, 'screens/ar-dark/feed.png')
  assert.throws(() => execFileSync('node', [packer, root, '--variants', 'a', '--platforms', 'ios,android'], { stdio: 'pipe' }))
  fs.rmSync(root, { recursive: true, force: true })
})
