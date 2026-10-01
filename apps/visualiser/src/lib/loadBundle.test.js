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
