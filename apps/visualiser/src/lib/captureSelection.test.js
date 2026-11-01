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
