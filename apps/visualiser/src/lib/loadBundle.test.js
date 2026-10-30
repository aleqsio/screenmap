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
  const { createHash } = await import('node:crypto')
  const { loadBundle, variantsOf } = await import('./loadBundle.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scrmap-variants-'))
  const out = path.join(root, '.screenmap', 'out')
  for (const v of ['en-light', 'ar-dark']) fs.mkdirSync(path.join(out, 'screens', v), { recursive: true })
  fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify({ appName: 'T', routes: [{ id: 'feed', slug: 'feed', urlPath: '/feed' }, { id: 'profile', slug: 'profile', urlPath: '/profile' }], edges: [] }))
  for (const v of ['en-light', 'ar-dark']) { fs.writeFileSync(path.join(out, 'screens', v, 'feed.png'), v === 'en-light' ? 'x' : 'changed'); fs.writeFileSync(path.join(out, 'screens', v, 'profile.png'), 'p') }
  const sha = createHash('sha256').update('x').digest('hex')
  const links = [{ label: 'Profile', to: 'profile', rect: [0.1, 0.2, 0.3, 0.4] }, { label: 'Invalid rectangle', to: 'profile', rect: [0.9, 0, 0.2, 0.1] }, { label: 'Unknown', to: 'unknown', rect: [0, 0, 0.1, 0.1] }]
  fs.writeFileSync(path.join(out, 'hotspots.json'), JSON.stringify({ version: 1, captures: [{ node: 'feed', variant: 'en-light', sourceSha256: sha, links }, { node: 'feed', variant: 'ar-dark', sourceSha256: sha, links }] }))
  const packer = path.join(import.meta.dirname, '../../../../plugins/screenmap/skills/screenmap/scripts/pack-map.mjs')
  const file = path.join(root, 't.scrmap')
  execFileSync('node', [packer, root, '--variants', 'en-light,ar-dark', '--out', file])
  const b = await loadBundle(fs.readFileSync(file))
  assert.deepEqual(variantsOf(b).map((v) => v.id), ['en-light', 'ar-dark'])
  assert.equal(b.map.nodes[0].captures['ar-dark'].screenshot, 'screens/ar-dark/feed.png')
  assert.deepEqual(b.map.nodes[0].captures['en-light'].prototype.links, [links[0]])
  assert.equal(b.map.nodes[0].captures['ar-dark'].prototype, undefined)
  assert.throws(() => execFileSync('node', [packer, root, '--variants', 'a', '--platforms', 'ios,android'], { stdio: 'pipe' }))
  fs.rmSync(root, { recursive: true, force: true })
})

test('packer retains independent capture axes across several OS versions and platforms', async () => {
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const { loadBundle } = await import('./loadBundle.js')
  const { captureProfiles, selectionOf, resolveProfile, captureForProfile } = await import('./captureSelection.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scrmap-capture-axes-'))
  try {
    const descriptors = [
      { id: 'ios18-en-light', platform: 'ios', osVersion: '18', language: 'en', appearance: 'light', device: 'iPhone test' },
      { id: 'ios27-ar-dark', platform: 'ios', osVersion: '27', language: 'ar', appearance: 'dark', device: 'iPhone test' },
      { id: 'android16-en-light', platform: 'android', osVersion: '16', language: 'en', appearance: 'light', device: 'Pixel test' },
    ]
    const out = path.join(root, '.screenmap', 'out')
    for (const descriptor of descriptors) {
      const dir = path.join(out, 'screens', descriptor.id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'home.png'), descriptor.id)
    }
    fs.writeFileSync(path.join(root, '.screenmap', 'config.json'), JSON.stringify({ variants: descriptors }))
    fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify({ routes: [{ id: 'home', slug: 'home', urlPath: '/' }], edges: [] }))
    const packer = path.join(import.meta.dirname, '../../../../plugins/screenmap/skills/screenmap/scripts/pack-map.mjs')
    const file = path.join(root, 'matrix.scrmap')
    execFileSync('node', [packer, root, '--platforms', 'ios,android', '--variants', descriptors.map((item) => item.id).join(','), '--out', file])
    const bundle = await loadBundle(fs.readFileSync(file))
    const profiles = captureProfiles(bundle.manifest)
    for (const descriptor of descriptors) {
      const profile = resolveProfile(profiles, selectionOf(descriptor))
      assert.equal(profile.osVersion, descriptor.osVersion)
      assert.equal(profile.device, descriptor.device)
      assert.equal(captureForProfile(bundle.map.nodes[0], profile).screenshot, `screens/${descriptor.id}/home.png`)
    }
    assert.equal(resolveProfile(profiles, { ...selectionOf(profiles[0]), osVersion: '26' }), null)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
