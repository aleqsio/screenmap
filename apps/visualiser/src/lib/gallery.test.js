import { test } from 'node:test'
import assert from 'node:assert/strict'
import { galleryFrames } from './gallery.js'

test('gallery walks every existing base and named image in route/state order for only the exact selected profile', () => {
  const bundle = { images: new Map(['home.png', 'a.png', 'z.png', 'error.png', 'arabic.png'].map((file) => [file, 'bytes'])), map: { nodes: [
    { id: 'home', captures: {
      english: { screenshot: 'home.png', states: [{ name: 'z-menu', screenshot: 'z.png' }, { name: 'a-lower', screenshot: 'a.png' }, { name: 'missing', screenshot: 'absent.png' }] },
      arabic: { screenshot: 'arabic.png', states: [] },
    } },
    { id: 'error', captures: { english: { screenshot: 'error.png', status: 'error-boundary', states: [] } } },
    { id: 'not-captured', captures: { english: { screenshot: 'absent.png', states: [] } } },
  ] } }
  const frames = galleryFrames(bundle, { id: 'english' })
  assert.deepEqual(frames.map(({ screen, state }) => [screen, state]), [['home', null], ['home', 'a-lower'], ['home', 'z-menu'], ['error', null]])
  assert.equal(frames[3].capture.status, 'error-boundary')
  assert.deepEqual(galleryFrames(bundle, { id: 'arabic' }).map(({ screen, state }) => [screen, state]), [['home', null]])
  assert.deepEqual(galleryFrames(bundle, { id: 'uncaptured-os' }), [])
  assert.deepEqual(galleryFrames(bundle, null), [])
})
