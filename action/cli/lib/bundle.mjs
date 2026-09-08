// .scrmap / .diff.scrmap helpers: read a baseline bundle, turn its map back
// into a parse-routes-shaped graph, pack a new baseline (reusing screenshots
// for unchanged screens), and call the skill's diff-map.mjs to pack a diff.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJson, ensureDir, log } from './util.mjs'

export const SKILL_SCRIPTS = path.resolve(new URL('../../../plugins/screenmap/skills/screenmap/scripts', import.meta.url).pathname)

export function unzipTo(bundlePath, dir) {
  ensureDir(dir)
  execFileSync('unzip', ['-q', '-o', bundlePath, '-d', dir])
  return dir
}

export function readBaseline(bundlePath, workDir) {
  const dir = unzipTo(bundlePath, workDir)
  const manifest = readJson(path.join(dir, 'manifest.json'))
  const map = readJson(path.join(dir, 'map.json'))
  const graph = fs.existsSync(path.join(dir, 'graph.json')) ? readJson(path.join(dir, 'graph.json')) : graphFromMap(manifest, map)
  return { dir, manifest, map, graph, screensDir: path.join(dir, 'screens'), flowsDir: path.join(dir, 'flows') }
}

// map.json (viewer shape) → graph.json (producer shape) so older baselines
// packed without graph.json still diff
export function graphFromMap(manifest, map) {
  return {
    generatedAt: manifest.generatedAt, projectRoot: null, scheme: manifest.app?.scheme ?? null, mode: manifest.app?.mode ?? null,
    routes: map.nodes.map((n) => ({
      id: n.id, file: n.file, urlPath: n.urlPath, slug: n.slug, params: n.params ?? [], navigator: n.navigator,
      layoutDir: n.group ?? '', presentation: n.presentation ?? null, stateHints: n.stateHints ?? [],
    })),
    edges: map.edges ?? [],
  }
}

// Which platforms a bundle actually carries. A v3 bundle lists them; a v1/v2
// bundle has exactly one, named by the manifest's platform label (and a bundle
// old enough to name nothing predates Android, so it is iOS).
export function platformsIn(manifest) {
  if (Array.isArray(manifest?.app?.platforms) && manifest.app.platforms.length) {
    return manifest.app.platforms.map((p) => p.platform)
  }
  const label = manifest?.app?.platform
  if (label === 'android-emulator') return ['android']
  if (label === 'ios-simulator' || !label) return ['ios']
  return [label]
}

// Read one platform's side of a previous baseline: where its screenshots live,
// how to find a node's capture record, and its capture-status map.
//
// A bundle is only allowed to answer for platforms it actually holds. This is
// the whole point: when a repo turns Android on, its previous baseline is
// iOS-only, and a side that answered anyway would hand every Android screen the
// iOS screenshot — captures that look real, are labelled Android, and are not.
// An absent side reports exists:false, so every route counts as stale and the
// new platform captures in full.
export function baselineSide(prev, platform) {
  const has = platformsIn(prev.manifest)
  if (!has.includes(platform)) {
    return { dir: null, exists: false, capture: () => null, status: {} }
  }
  const multi = has.length > 1
  const dir = multi ? path.join(prev.dir, 'screens', platform) : prev.screensDir
  const rawStatus = readJson(path.join(prev.dir, 'capture-status.json'), {})
  return {
    dir,
    exists: fs.existsSync(dir),
    capture: (node) => (multi ? node?.captures?.[platform] : node?.capture) ?? null,
    status: multi ? rawStatus[platform] ?? {} : rawStatus,
  }
}

export function parseRoutes(projectDir, outPath) {
  execFileSync('node', [path.join(SKILL_SCRIPTS, 'parse-routes.mjs'), projectDir, '--out', outPath], { stdio: ['ignore', 'ignore', 'inherit'] })
  return readJson(outPath)
}

// suspects between two graphs given the changed-file list; reuses diff-map.mjs
export function computeSuspects({ diffDir, baseGraph, headGraph, changedFiles, projectDir, depth, broadCap }) {
  ensureDir(path.join(diffDir, 'base')); ensureDir(path.join(diffDir, 'head'))
  writeJson(path.join(diffDir, 'base', 'graph.json'), baseGraph)
  writeJson(path.join(diffDir, 'head', 'graph.json'), headGraph)
  fs.writeFileSync(path.join(diffDir, 'changed-files.txt'), changedFiles.join('\n') + '\n')
  execFileSync('node', [path.join(SKILL_SCRIPTS, 'diff-map.mjs'), 'suspects', diffDir, '--project', projectDir, '--depth', String(depth), '--broad-cap', String(broadCap)], { stdio: ['ignore', process.stderr, 'inherit'] })
  return readJson(path.join(diffDir, 'suspects.json'))
}

// `platforms` is [{ platform, device }] in capture order; diff-map.mjs takes
// them as parallel comma-separated lists.
export function packDiff({ diffDir, device, platforms, out }) {
  const args = [path.join(SKILL_SCRIPTS, 'diff-map.mjs'), 'pack', diffDir]
  if (platforms?.length) {
    args.push('--platforms', platforms.map((p) => p.platform).join(','))
    args.push('--device', platforms.map((p) => p.device ?? '').join(','))
  } else if (device) args.push('--device', device)
  if (out) args.push('--out', out)
  execFileSync('node', args, { stdio: ['ignore', process.stderr, 'inherit'] })
  return out ?? fs.readdirSync(diffDir).filter((f) => f.endsWith('.diff.scrmap')).map((f) => path.join(diffDir, f))[0]
}

// How a platform is named in the manifest's `app.platform` field.
export const PLATFORM_LABELS = { ios: 'ios-simulator', android: 'android-emulator' }

// Build one platform's capture record for a route: the bare screenshot plus
// its state variants, resolved against that platform's screens directory.
function captureFor(r, cs, shotFiles, prefix) {
  const baseShot = shotFiles.find((f) => f.replace(/\.\w+$/, '') === r.slug)
  const states = shotFiles.filter((f) => f.startsWith(r.slug + '--'))
    .map((f) => ({ name: f.replace(/\.\w+$/, '').slice(r.slug.length + 2), screenshot: prefix + f }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    status: cs.status ?? (baseShot ? 'ok' : 'missing'),
    note: cs.note ?? null,
    needsNavigation: cs.needsNavigation ?? false,
    screenshot: baseShot ? prefix + baseShot : null,
    states,
  }
}

// Pack a baseline .scrmap from loose parts. Mirrors pack-map.mjs but takes
// explicit dirs and adds graph.json + commit metadata (producer extensions;
// viewers ignore unknown files/fields).
//
// `platforms` is [{ platform, device, screensDir }] in capture order. With a
// single platform the output is byte-for-byte the v2 layout it always was —
// `screens/<slug>.png` and one `capture` per node. With more than one, screens
// move into `screens/<platform>/` and each node gains a `captures` map; `capture`
// keeps mirroring the FIRST platform so a v2 viewer still renders the map
// instead of showing every screen as missing.
export function packBaseline({ graph, platforms, screensDir, flowsDir, captureStatus = {}, appName, device, commit, ref, out }) {
  // legacy single-platform call shape
  if (!platforms) platforms = [{ platform: 'ios', device, screensDir }]
  const multi = platforms.length > 1
  // captureStatus is per-platform when multi, flat (iOS-only) when not
  const statusFor = (p) => (multi ? captureStatus[p] ?? {} : captureStatus)

  const sides = platforms.map((p) => {
    const prefix = multi ? `screens/${p.platform}/` : 'screens/'
    const files = fs.existsSync(p.screensDir) ? fs.readdirSync(p.screensDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : []
    return { ...p, prefix, files, status: statusFor(p.platform) }
  })
  const flowFiles = flowsDir && fs.existsSync(flowsDir) ? fs.readdirSync(flowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.meta.json')) : []

  const nodes = graph.routes.map((r) => {
    const per = Object.fromEntries(sides.map((s) => [s.platform, captureFor(r, s.status[r.id] ?? {}, s.files, s.prefix)]))
    return {
      id: r.id, urlPath: r.urlPath, file: r.file ?? null, slug: r.slug, group: r.layoutDir ?? '', navigator: r.navigator ?? null,
      params: r.params ?? [], presentation: r.presentation ?? null, stateHints: r.stateHints ?? [],
      capture: per[sides[0].platform],
      ...(multi ? { captures: per } : {}),
    }
  })
  const map = { nodes, edges: graph.edges ?? [], flows: [] }
  const manifest = {
    formatVersion: multi ? 3 : 2, flowFormat: 'argent', generator: 'screenmap-ci/0.1',
    app: {
      name: appName, scheme: graph.scheme ?? null,
      platform: PLATFORM_LABELS[sides[0].platform] ?? sides[0].platform,
      device: sides[0].device ?? null, mode: graph.mode ?? null,
      ...(multi ? { platforms: sides.map((s) => ({ platform: s.platform, label: PLATFORM_LABELS[s.platform] ?? s.platform, device: s.device ?? null })) } : {}),
    },
    source: { commit: commit ?? null, ref: ref ?? null },
    generatedAt: new Date().toISOString(),
  }
  const stage = fs.mkdtempSync(path.join(path.dirname(out), '.pack-'))
  let shotCount = 0
  try {
    writeJson(path.join(stage, 'manifest.json'), manifest)
    writeJson(path.join(stage, 'map.json'), map)
    writeJson(path.join(stage, 'graph.json'), graph)
    writeJson(path.join(stage, 'capture-status.json'), captureStatus)
    ensureDir(path.join(stage, 'screens')); ensureDir(path.join(stage, 'flows'))
    for (const s of sides) {
      const dest = ensureDir(path.join(stage, 'screens', ...(multi ? [s.platform] : [])))
      for (const f of s.files) { fs.copyFileSync(path.join(s.screensDir, f), path.join(dest, f)); shotCount++ }
    }
    for (const f of flowFiles) fs.copyFileSync(path.join(flowsDir, f), path.join(stage, 'flows', f))
    fs.rmSync(out, { force: true })
    execFileSync('zip', ['-r', '-q', out, 'manifest.json', 'map.json', 'graph.json', 'capture-status.json', 'screens', 'flows'], { cwd: stage })
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
  log(`packed ${out}: ${nodes.length} nodes, ${shotCount} shots across ${sides.map((s) => s.platform).join('+')}, ${flowFiles.length / 2 | 0} flows`)
  return { manifest, map }
}

// Downscale captures to 800px on the long edge before packing. `sips` is
// macOS-only and the Android lane runs on Linux, so fall back through the
// resizers a ubuntu runner actually has — without one, bundles would quietly
// ship full-resolution screenshots and grow several-fold.
let resizer
function findResizer() {
  if (resizer !== undefined) return resizer
  const cands = [
    ['sips', (f) => ['-Z', '800', f]],
    ['magick', (f) => [f, '-resize', '800x800>', f]],
    ['convert', (f) => [f, '-resize', '800x800>', f]],
  ]
  for (const [bin, args] of cands) {
    if (spawnSync('which', [bin], { encoding: 'utf8' }).status === 0) return (resizer = { bin, args })
  }
  log('no image resizer found (sips/magick/convert) — screenshots ship at full size')
  return (resizer = null)
}

export function downscaleAll(dir) {
  if (!fs.existsSync(dir)) return
  const r = findResizer()
  if (!r) return
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) { downscaleAll(p); continue } // per-platform subdirs
    if (/\.png$/i.test(f)) { try { execFileSync(r.bin, r.args(p), { stdio: 'ignore' }) } catch {} }
  }
}
