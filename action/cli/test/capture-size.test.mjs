import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { downscaleAll } from '../lib/bundle.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCFsAAAAASUVORK5CYII=', 'base64')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('downscale preserves finalized PNG bytes and interaction source hash across repeated baseline passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenmap-final-size-'))
  try {
    const dir = path.join(root, 'ios')
    fs.mkdirSync(dir)
    const file = path.join(dir, 'final.png')
    fs.writeFileSync(file, png)
    downscaleAll(root)
    downscaleAll(root)
    assert.equal(sha(fs.readFileSync(file)), sha(png))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
