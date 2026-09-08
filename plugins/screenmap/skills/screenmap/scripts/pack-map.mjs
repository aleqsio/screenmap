#!/usr/bin/env node
// Packs an .screenmap/out/ working directory into a distributable .scrmap bundle (zip).
// Usage: node pack-map.mjs [projectRoot] [--out <file.scrmap>] [--platforms ios,android]
//
// Screens come from .screenmap/out/screens/. With several platforms they come
// from .screenmap/out/screens/<platform>/ instead, each node gains a `captures`
// map, and the bundle is formatVersion 3.
// See docs/scrmap-format.md for the format contract.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
let projectRoot = '.'
let outPath = null
let platforms = ['ios']
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outPath = args[++i]
  else if (args[i] === '--platforms') platforms = args[++i].split(',').map((s) => s.trim()).filter(Boolean)
  else projectRoot = args[i]
}
const multi = platforms.length > 1
const PLATFORM_LABELS = { ios: 'ios-simulator', android: 'android-emulator' }
projectRoot = path.resolve(projectRoot)
const base = path.join(projectRoot, '.screenmap', 'out')

const graph = JSON.parse(fs.readFileSync(path.join(base, 'graph.json'), 'utf8'))
let captureStatus = {}
try {
  captureStatus = JSON.parse(fs.readFileSync(path.join(base, 'capture-status.json'), 'utf8'))
} catch {}

// v2: flows are argent YAML + .meta.json sidecars, shipped verbatim in the
// bundle (the visualiser parses them client-side). Metas are read here only
// for the device field and the flow count.
const flowsDir = path.join(base, 'flows')
const flowFiles = fs.existsSync(flowsDir)
  ? fs.readdirSync(flowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.meta.json'))
  : []
const flows = flowFiles
  .filter((f) => f.endsWith('.meta.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(flowsDir, f), 'utf8'))
    } catch {
      return null
    }
  })
  .filter(Boolean)

const shotsDirFor = (pf) => path.join(base, 'screens', ...(multi ? [pf] : []))
const shotsByPlatform = Object.fromEntries(platforms.map((pf) => {
  const d = shotsDirFor(pf)
  return [pf, fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : []]
}))

const appName = graph.appName ?? path.basename(graph.projectRoot ?? projectRoot)

// capture-status.json is keyed by platform when several are packed, by route
// id when one is — the same shape the CI packer writes
const statusFor = (pf) => (multi ? captureStatus[pf] ?? {} : captureStatus)
const captureOf = (r, pf) => {
  const cs = statusFor(pf)[r.id] ?? {}
  const shotFiles = shotsByPlatform[pf]
  const prefix = multi ? `screens/${pf}/` : 'screens/'
  const baseShot = shotFiles.find((f) => f.replace(/\.\w+$/, '') === r.slug)
  const states = shotFiles
    .filter((f) => f.startsWith(r.slug + '--'))
    .map((f) => ({ name: f.replace(/\.\w+$/, '').slice(r.slug.length + 2), screenshot: prefix + f }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    status: cs.status ?? (baseShot ? 'ok' : 'missing'),
    note: cs.note ?? null,
    // a route the provider says has no URL is navigation-only by definition
    needsNavigation: cs.needsNavigation ?? r.reach === 'navigation-only',
    screenshot: baseShot ? prefix + baseShot : null,
    states,
  }
}

const nodes = graph.routes.map((r) => {
  const per = Object.fromEntries(platforms.map((pf) => [pf, captureOf(r, pf)]))
  return {
    id: r.id,
    urlPath: r.urlPath ?? null,
    title: r.title ?? r.urlPath ?? r.id,
    reach: r.reach ?? (r.urlPath ? 'deep-link' : 'navigation-only'),
    file: r.file ?? null,
    slug: r.slug,
    group: r.layoutDir ?? '',
    navigator: r.navigator ?? null,
    params: r.params ?? [],
    presentation: r.presentation ?? null,
    stateHints: r.stateHints ?? [],
    // `capture` mirrors the first platform so a pre-multi-platform viewer still
    // renders the map; `captures` is the full set
    capture: per[platforms[0]],
    ...(multi ? { captures: per } : {}),
  }
})

const map = { nodes, edges: graph.edges ?? [], flows: [] }
// A flow sidecar records the device it was recorded on; with several platforms
// prefer the one whose sidecar names that platform, else fall back to any.
const deviceFor = (pf) => flows.find((f) => f.platform === pf && f.device)?.device ?? (multi ? null : flows.find((f) => f.device)?.device ?? null)
const manifest = {
  formatVersion: multi ? 3 : 2,
  flowFormat: 'argent', // flows/*.yaml runnable via `argent flow run`
  generator: 'screenmap/2.0',
  app: {
    name: appName,
    scheme: graph.scheme ?? null,
    platform: PLATFORM_LABELS[platforms[0]] ?? platforms[0],
    device: deviceFor(platforms[0]) ?? (multi ? null : flows.find((f) => f.device)?.device ?? null),
    mode: graph.mode ?? null,
    ...(multi ? { platforms: platforms.map((pf) => ({ platform: pf, label: PLATFORM_LABELS[pf] ?? pf, device: deviceFor(pf) })) } : {}),
  },
  generatedAt: new Date().toISOString(),
}

const stage = fs.mkdtempSync(path.join(base, '.pack-'))
try {
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(stage, 'map.json'), JSON.stringify(map, null, 2))
  fs.mkdirSync(path.join(stage, 'screens'))
  for (const pf of platforms) {
    const dest = path.join(stage, 'screens', ...(multi ? [pf] : []))
    fs.mkdirSync(dest, { recursive: true })
    for (const f of shotsByPlatform[pf]) fs.copyFileSync(path.join(shotsDirFor(pf), f), path.join(dest, f))
  }
  fs.mkdirSync(path.join(stage, 'flows'))
  for (const f of flowFiles) fs.copyFileSync(path.join(flowsDir, f), path.join(stage, 'flows', f))

  const date = new Date().toISOString().slice(0, 10)
  outPath = path.resolve(outPath ?? path.join(base, `${appName}-${date}.scrmap`))
  fs.rmSync(outPath, { force: true })
  execFileSync('zip', ['-r', '-q', outPath, 'manifest.json', 'map.json', 'screens', 'flows'], { cwd: stage })
  const kb = Math.round(fs.statSync(outPath).size / 1024)
  const shotCount = platforms.reduce((n, pf) => n + shotsByPlatform[pf].length, 0)
  console.log(`wrote ${outPath} (${kb} KB, ${nodes.length} nodes, ${map.edges.length} edges, ${flows.length} flows, ${shotCount} screenshots across ${platforms.join('+')})`)
} finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
