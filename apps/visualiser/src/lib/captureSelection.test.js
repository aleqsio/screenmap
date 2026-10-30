import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureProfiles, selectionOf, resolveProfile, captureForProfile, readPanes } from './captureSelection.js'

test('legacy captures preserve unknown OS and opaque identity; independent axes never substitute another capture', () => {
  const profiles = captureProfiles({ app: { platform: 'ios-simulator', device: 'iPhone 27' }, variants: [{ id: 'en-light' }, { id: 'ar-dark' }, { id: 'custom-a' }, { id: 'custom-b' }] })
  assert.equal(profiles[0].osVersion, null)
  assert.equal(resolveProfile(profiles, { ...selectionOf(profiles[0]), language: 'ar' }), null)
  assert.equal(resolveProfile(profiles, { ...selectionOf(profiles[0]), osVersion: '27' }), null)
  assert.equal(resolveProfile(profiles, selectionOf(profiles[3])).id, 'custom-b')
  assert.equal(resolveProfile(profiles, { platform: 'ios', osVersion: '', language: '', appearance: '' }), null)
  const node = { capture: { screenshot: 'first.png' }, captures: { 'en-light': { screenshot: 'english.png', states: [{ name: 'menu', screenshot: 'menu.png' }] } } }
  assert.equal(captureForProfile(node, profiles[1]), null)
  assert.equal(captureForProfile(node, profiles[0], 'uncaptured'), null)
  assert.equal(captureForProfile(node, profiles[0], 'menu').screenshot, 'menu.png')
})

test('pane configuration round-trips explicit OS versions and bounds malformed URL data', () => {
  const panes = [
    { platform: 'ios', osVersion: '18', language: 'en', appearance: 'light', variant: 'ios18' },
    { platform: 'android', osVersion: '16', language: 'ar', appearance: 'dark', variant: 'android16' },
  ]
  assert.deepEqual(readPanes(JSON.stringify(panes)), panes)
  assert.deepEqual(readPanes('invalid'), [])
  assert.deepEqual(readPanes('{}'), [])
  assert.equal(readPanes(JSON.stringify([...panes, ...panes, ...panes])).length, 4)
})

test('availability counts actual saved base/state images and compatible choices for the current Visit', async () => {
  const { captureAvailability, compatibleCaptureCount, availabilityCombinations } = await import('./captureSelection.js')
  const manifest = { app: { platform: 'ios-simulator' }, variants: [{ id: 'en-light' }, { id: 'en-dark' }, { id: 'ar-dark' }] }
  const bundle = { manifest, images: new Map([['light.png', 'bytes'], ['dark.png', 'bytes'], ['menu.png', 'bytes']]), map: { nodes: [
    { id: 'home', captures: {
      'en-light': { screenshot: 'light.png', states: [] },
      'en-dark': { screenshot: 'dark.png', states: [{ name: 'menu', screenshot: 'menu.png' }, { name: 'absent', screenshot: 'not-in-bundle.png' }] },
      'ar-dark': { screenshot: 'not-in-bundle.png', states: [] },
    } },
  ] } }
  const profiles = captureProfiles(manifest)
  const availability = captureAvailability(bundle, profiles, 'home', 'menu')
  assert.deepEqual(availability.map(({ baseCount, stateCount, currentAvailable }) => ({ baseCount, stateCount, currentAvailable })), [
    { baseCount: 1, stateCount: 0, currentAvailable: false },
    { baseCount: 1, stateCount: 1, currentAvailable: true },
    { baseCount: 0, stateCount: 0, currentAvailable: false },
  ])
  assert.equal(compatibleCaptureCount(availability, selectionOf(profiles[0]), 'appearance', 'dark'), 1)
  assert.equal(compatibleCaptureCount(availability, selectionOf(profiles[1]), 'language', 'ar'), 0)
  assert.equal(captureAvailability(bundle, profiles, 'missing')[1].currentAvailable, false)
  assert.equal(captureAvailability(bundle, profiles, null)[0].currentAvailable, true)
  assert.equal(captureAvailability(bundle, profiles, null)[2].currentAvailable, false)
  const missingArabicLight = availabilityCombinations(availability).find((profile) => profile.language === 'ar' && profile.appearance === 'light')
  assert.equal(missingArabicLight.unconfigured, true)
  assert.equal(missingArabicLight.baseCount, 0)
  assert.equal(missingArabicLight.currentAvailable, false)
})
