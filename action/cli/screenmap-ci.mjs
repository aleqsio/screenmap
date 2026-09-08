#!/usr/bin/env node
// screenmap-ci — the deterministic core of the screenmap GitHub Action.
//
//   screenmap-ci baseline --project <dir> [--previous <file.scrmap>] [--full] [--out <file>]
//                      [--only id,id] [--limit N] [--no-agent] [--no-sim]
//   screenmap-ci pr       --project <dir> --baseline <file.scrmap> [--base <sha>] [--head <sha>]
//                      [--pr <n> --title <t> --url <u>] [--out <file>] [--no-agent]
//   screenmap-ci status   --state pending|no-baseline|failed --pr <n> [--post] [--run-url U] [--repo-url U]
//                      interim states for the sticky comment the result later replaces
//   screenmap-ci comment  --summary <pr-summary.json> [--map-url U] [--changes-url U] [--artifact-url U] [--shots-base U]
//                      [--post --repo owner/name --pr <n>]
//   screenmap-ci publish  --repo owner/name [--branch screenmaps] --files src=dest[,src=dest…] --message "…"
//   screenmap-ci flows-pr --repo owner/name --flows <dir> [--base main] --title "…" [--body "…"]
//   screenmap-ci flows-adopt --project <dir> [--from .screenmap/out/flows] [--to .screenmap/flows] [--force]
//                      move locally recorded flows into the directory CI replays from
//   screenmap-ci resolve-app --project <dir> [--platform ios|android] [--profile <name>]
//                      (EAS: reuse-by-fingerprint or build)
//   screenmap-ci merge --inputs ios=a.scrmap,android=b.scrmap --out combined.scrmap
//                      fold per-platform baselines into one multi-platform map
//
// baseline and pr capture on every platform in config.platforms (default
// ["ios"]); --platform <name> narrows a run to one of them, which is how the
// Action splits iOS and Android across two runners.
//
// Runs locally too: the same commands the Action runs, against your own
// simulator or emulator. See docs/ci.md.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, loadConfig, platformConfig, readJson, writeJson, ensureDir, exists, log, sh, deepLinkFor } from './lib/util.mjs'
import { openSession } from './lib/device.mjs'
import { readBaseline, parseRoutes, computeSuspects, packBaseline, packDiff, downscaleAll, baselineSide, platformsIn } from './lib/bundle.mjs'
import { loadFlows, replayFlow, verifyLanding, verifyDeepLink } from './lib/replay.mjs'
import { argentAvailable, argentVersion } from './lib/argent.mjs'
import { runAgent, agentInfo } from './lib/agent.mjs'
import { ocrBackend } from './lib/ocr.mjs'
import { upsertStickyComment, publishToBranch, openFlowsPR, repoSlug } from './lib/github.mjs'

const { opts, positional } = parseArgs(process.argv.slice(2))
const cmd = positional[0]

const git = (args, cwd) => { try { return sh('git', args, { cwd }) } catch { return null } }
const copyShots = (fromDir, toDir, slug) => {
  if (!exists(fromDir)) return 0
  ensureDir(toDir)
  let n = 0
  for (const f of fs.readdirSync(fromDir)) {
    const base = f.replace(/\.\w+$/, '')
    if (base === slug || base.startsWith(slug + '--')) { fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f)); n++ }
  }
  return n
}

// Capture a list of routes on the live session: committed flow replay first,
// deep link otherwise, agent for what's left (budgeted). Shared by both jobs.
async function captureRoutes({ project, config, scheme, session, routes, flows, outDir, work, agentMode, prContext, agentEnabled }) {
  const result = { replay: [], deeplink: [], agent: [], failed: [], unflowed: [], drifted: [], unverified: [] }
  const canReplay = flows.size > 0 && argentAvailable()
  if (flows.size > 0 && !canReplay) log('argent not available — committed flows will not be replayed this run')
  for (const r of routes) {
    const f = flows.get(r.id)
    let done = false
    if (canReplay && f) {
      const recs = [f.nav ?? f.visit, ...f.others].filter(Boolean)
      await session.relaunch() // every replay starts from a clean app
      let wrote = 0, broke = null
      for (const rec of recs) {
        const { ok, written } = await replayFlow(rec, { device: session, outDir, tmpDir: path.join(work, 'tmp') })
        wrote += written.length
        if (!ok) { broke = rec.name; log(`replay ${rec.name} failed — falling back`); break }
      }
      const shot = path.join(outDir, `${r.slug}.png`)
      if (!broke && wrote > 0 && exists(shot)) {
        const primary = f.nav ?? f.visit ?? recs[0]
        const v = await verifyLanding({
          shot, rec: primary, device: session,
          probe: async () => { try { await session.relaunch(); const p = path.join(work, 'tmp', `${r.slug}.deeplink.png`); await session.visit(deepLinkFor(scheme, r, config.params), p, r.params?.length ? config.waits.network : config.waits.transition); return p } catch { return null } },
        })
        if (v.ok) { result.replay.push(r.id); done = true; log(`replay ${primary.name} ✓ (${v.method}${v.score != null ? ` ${v.score}` : ''})`) }
        else {
          log(`replay ${primary.name} drifted (${v.method} ${v.score}) — deep-link capture instead; flow queued for re-recording`)
          result.drifted.push({ route: r.id, flows: recs.map((x) => x.name), method: v.method, score: v.score })
          for (const fn of fs.readdirSync(outDir)) if (fn === `${r.slug}.png` || fn.startsWith(r.slug + '--')) fs.rmSync(path.join(outDir, fn), { force: true })
          result.unflowed.push({ ...r, reason: (r.reason ? r.reason + '; ' : '') + 'flow drifted' })
          await session.relaunch()
        }
      } else if (broke) {
        result.drifted.push({ route: r.id, flows: [broke], method: 'replay-error', score: null })
        result.unflowed.push({ ...r, reason: (r.reason ? r.reason + '; ' : '') + 'flow replay failed' })
        await session.relaunch()
      }
    }
    if (!done) {
      try {
        const wait = (r.params?.length ? config.waits.network : config.waits.transition)
        const shot = path.join(outDir, `${r.slug}.png`)
        await session.visit(deepLinkFor(scheme, r, config.params), shot, wait)
        result.deeplink.push(r.id)
        // A resolved deep link is not an arrived one. Check it the same way a
        // replay is checked, so a route that quietly renders its not-found
        // state stops being reported as the screen.
        const v = await verifyDeepLink({
          shot, rec: f?.visit ?? f?.nav ?? null,
          probeBogus: r.params?.length
            ? async () => {
                try {
                  await session.relaunch()
                  const p = path.join(work, 'tmp', `${r.slug}.bogus.png`)
                  const bogus = Object.fromEntries(r.params.map((n) => [n, 'zzscreenmapzz']))
                  await session.visit(deepLinkFor(scheme, r, bogus), p, config.waits.network)
                  await session.relaunch()
                  return p
                } catch { return null }
              }
            : null,
        })
        if (v.ok === false) {
          log(`deep link for ${r.id} could not be verified (${v.method} ${v.score}) — queued for the agent`)
          result.unverified.push({ route: r.id, method: v.method, score: v.score })
          // regardless of whether a flow exists: a committed flow that could not
          // replay left us here, and its capture is no more trustworthy
          result.unflowed.push({ ...r, reason: (r.reason ? r.reason + '; ' : '') + `deep link did not arrive (${v.method})` })
        } else if (!f) result.unflowed.push(r)
      } catch (e) {
        log(`deep link failed for ${r.id}: ${e.message}`)
        result.failed.push(r.id)
        if (!f) result.unflowed.push(r)
      }
    }
  }
  // Agent lane, within budget. Which screens it sees comes from the effort
  // preset (fast | balanced | thorough — see EFFORTS in lib/util.mjs), or from
  // agent.scan set explicitly.
  //
  // Captures that failed verification are already in result.unflowed with a
  // reason, whatever the effort, so every mode now detects a deep link that did
  // not arrive. The presets decide how much is re-checked speculatively on top:
  // scan=params hands over every parameterised route rather than only the ones
  // OCR could condemn, which still catches an app that renders the same shell
  // for any id.
  const scan = config.agent.scan
  const unflowedIds = new Set(result.unflowed.map((r) => r.id))
  const extra =
    scan === 'all' ? routes.filter((r) => !unflowedIds.has(r.id))
    : scan === 'params' ? routes.filter((r) => !unflowedIds.has(r.id) && r.params?.length)
    : []
  const candidates = [
    ...result.unflowed,
    ...extra.map((r) => ({ ...r, reason: scan === 'all' ? `re-checked (effort=${config.effort})` : "deep link guesses this route's param" })),
  ]
  if (agentEnabled && candidates.length) {
    const agentDir = ensureDir(path.join(work, 'agent'))
    const screens = candidates.map((r) => ({ id: r.id, urlPath: r.urlPath, slug: r.slug, file: r.file, deepLink: deepLinkFor(scheme, r, config.params), reason: r.reason }))
    if (extra.length) log(`effort=${config.effort} (scan=${scan}): ${result.unflowed.length} flowless + ${extra.length} re-checked`)
    const a = runAgent({
      projectDir: project, config, screens, scheme, udid: session.id, bundleId: session.appId,
      platform: session.platform, deviceName: session.deviceName,
      outScreensDir: path.join(agentDir, 'screens'), outFlowsDir: path.join(agentDir, 'flows'),
      notesPath: path.join(agentDir, 'notes.json'), summaryPath: path.join(agentDir, 'summary.json'),
      mode: agentMode, prContext,
    })
    result.agentRun = a
    // the comment footer says why the agent sat out; the log should too, or a
    // run that quietly explored nothing looks identical to one that had nothing
    // to explore
    if (!a.ran) log(`agent: not run — ${a.reason} (${result.unflowed.length} screen(s) had no flow)`)
    if (a.ran) {
      // agent captures supersede deep-link ones for the screens it handled
      for (const id of a.summary.captured ?? []) {
        const r = routes.find((x) => x.id === id)
        if (r && copyShots(path.join(agentDir, 'screens'), outDir, r.slug) > 0) result.agent.push(id)
      }
      result.recordedFlowsDir = exists(path.join(agentDir, 'flows')) && fs.readdirSync(path.join(agentDir, 'flows')).length ? path.join(agentDir, 'flows') : null
      result.notes = readJson(path.join(agentDir, 'notes.json'), null)
    }
  } else {
    result.agentRun = { ran: false, reason: agentEnabled ? 'no screens without a flow' : 'disabled (--no-agent)', ...agentInfo(config) }
  }
  return result
}

async function baseline() {
  const project = path.resolve(opts.project ?? '.')
  const config = loadConfig(project)
  const work = path.join(project, '.screenmap', 'out', 'ci', 'baseline')
  fs.rmSync(work, { recursive: true, force: true }); ensureDir(work)
  const graph = parseRoutes(project, path.join(work, 'graph.json'))
  const scheme = config.scheme ?? graph.scheme
  if (!scheme) throw new Error('no deep-link scheme: set scheme in .screenmap/config.json')
  const commit = opts.commit ?? git(['rev-parse', 'HEAD'], project)
  const ref = opts.ref ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], project)
  const appName = config.appName ?? path.basename(project)
  const platforms = opts.platform ? [String(opts.platform)] : config.platforms
  const multi = platforms.length > 1

  // Which screens changed is static analysis — the same answer on every
  // platform — so the suspect set is computed once and each platform then
  // decides reuse against its own side of the previous bundle.
  let prev = null, suspect = null, prevCommit = null
  if (opts.previous && exists(opts.previous) && !opts.full) {
    prev = readBaseline(opts.previous, path.join(work, 'prev'))
    prevCommit = prev.manifest.source?.commit
    const changed = prevCommit ? git(['diff', '--name-only', prevCommit, 'HEAD'], project) : null
    if (changed === null) {
      log('previous baseline commit not in history — doing a full capture')
      prev = null
    } else {
      const suspects = computeSuspects({ diffDir: path.join(work, 'diff'), baseGraph: prev.graph, headGraph: graph, changedFiles: changed.split('\n').filter(Boolean), projectDir: project, depth: config.suspects.depth, broadCap: config.suspects.broadCap })
      suspect = new Set(suspects.capture.filter((c) => c.status !== 'D').map((c) => c.id))
    }
  }

  const flowDirs = [config.flowsDir, '.screenmap/out/flows']
  const flows = loadFlows(project, flowDirs)
  const flowsDirForPack = flowDirs.map((d) => path.resolve(project, d)).find((d) => exists(d)) ?? path.resolve(project, config.flowsDir)

  const sides = []
  for (const platform of platforms) {
    const pc = platformConfig(config, platform)
    const screensDir = ensureDir(path.join(work, 'screens', platform))
    const captureStatus = {}
    let routes = graph.routes
    let reused = 0
    if (prev) {
      const side = baselineSide(prev, platform)
      const prevById = new Map(prev.map.nodes.map((n) => [n.id, n]))
      routes = []
      for (const r of graph.routes) {
        const c = side.capture(prevById.get(r.id))
        // a platform turned on since the last baseline has no side of its own,
        // so nothing is reusable and it captures in full
        const stale = suspect.has(r.id) || !side.exists || !c?.screenshot || ['error-boundary', 'loading', 'missing'].includes(c?.status)
        if (stale) routes.push({ ...r, reason: suspect.has(r.id) ? 'changed since baseline' : 'no usable previous capture' })
        else { copyShots(side.dir, screensDir, r.slug); reused++; if (side.status[r.id]) captureStatus[r.id] = side.status[r.id] }
      }
      log(`incremental baseline (${platform}): ${routes.length} to capture, ${reused} reused from ${prevCommit.slice(0, 7)}`)
    }
    if (opts.only) { const only = new Set(String(opts.only).split(',')); routes = routes.filter((r) => only.has(r.id)) }
    if (opts.limit) routes = routes.slice(0, Number(opts.limit))

    let cap = { replay: [], deeplink: [], agent: [], failed: [], unflowed: [] }
    let deviceName = pc.device
    if (routes.length && !opts['no-sim']) {
      const session = await openSession({ projectDir: project, config: pc, scheme, platform })
      deviceName = session.deviceName
      try {
        cap = await captureRoutes({ project, config: pc, scheme, session, routes, flows, outDir: screensDir, work: path.join(work, platform), agentMode: 'baseline', agentEnabled: !opts['no-agent'] })
      } finally { session.close() }
    }
    for (const id of cap.failed) captureStatus[id] = { status: 'missing', note: `deep link failed in CI (${platform})` }
    downscaleAll(screensDir)
    sides.push({ platform, device: deviceName, screensDir, cap, captureStatus, reused })
  }

  const out = path.resolve(opts.out ?? path.join(work, `${appName}-${(commit ?? 'local').slice(0, 7)}.scrmap`))
  packBaseline({
    graph, flowsDir: flowsDirForPack, appName, commit, ref, out,
    platforms: sides.map((s) => ({ platform: s.platform, device: s.device, screensDir: s.screensDir })),
    captureStatus: multi ? Object.fromEntries(sides.map((s) => [s.platform, s.captureStatus])) : sides[0].captureStatus,
  })
  const sum = (f) => sides.reduce((n, s) => n + f(s), 0)
  const summary = {
    kind: 'baseline', app: appName, commit, ref, bundle: out, total: graph.routes.length,
    reused: sum((s) => s.reused),
    platforms: sides.map((s) => ({
      platform: s.platform, device: s.device, reused: s.reused,
      captured: { replay: s.cap.replay.length, deeplink: s.cap.deeplink.length, agent: s.cap.agent.length, failed: s.cap.failed },
      unflowed: s.cap.unflowed.map((r) => r.id), drifted: s.cap.drifted ?? [], agent: s.cap.agentRun ?? { ran: false },
    })),
    // the first platform stays the headline one so existing consumers (the PR
    // comment, the shot renderer) keep reading the fields they always read
    device: sides.map((s) => s.device).filter(Boolean).join(' · ') || null,
    argent: argentVersion(), ocr: ocrBackend(),
    captured: {
      replay: sum((s) => s.cap.replay.length), deeplink: sum((s) => s.cap.deeplink.length),
      agent: sum((s) => s.cap.agent.length), failed: sides.flatMap((s) => s.cap.failed),
    },
    unflowed: [...new Set(sides.flatMap((s) => s.cap.unflowed.map((r) => r.id)))],
    drifted: sides.flatMap((s) => s.cap.drifted ?? []),
    agent: sides[0].cap.agentRun ?? { ran: false },
    recordedFlowsDir: sides.map((s) => s.cap.recordedFlowsDir).find(Boolean) ?? null,
  }
  writeJson(path.join(work, 'summary.json'), summary)
  console.log(JSON.stringify(summary, null, 2))
}
async function pr() {
  const project = path.resolve(opts.project ?? '.')
  const config = loadConfig(project)
  if (!opts.baseline || !exists(opts.baseline)) throw new Error('--baseline <file.scrmap> is required (the base-side map)')
  const work = path.join(project, '.screenmap', 'out', 'ci', 'pr')
  fs.rmSync(work, { recursive: true, force: true }); ensureDir(work)
  const base = readBaseline(opts.baseline, path.join(work, 'base-bundle'))
  const headGraph = parseRoutes(project, path.join(work, 'head-graph.json'))
  const scheme = config.scheme ?? headGraph.scheme ?? base.graph.scheme
  const baseSha = opts.base ?? base.manifest.source?.commit ?? null
  const headSha = opts.head ?? git(['rev-parse', 'HEAD'], project)
  const appName = config.appName ?? base.manifest.app?.name ?? path.basename(project)
  const platforms = opts.platform ? [String(opts.platform)] : config.platforms
  const multi = platforms.length > 1
  let changed = opts['changed-files'] ? fs.readFileSync(opts['changed-files'], 'utf8').split('\n').filter(Boolean) : null
  if (!changed && baseSha) changed = (git(['diff', '--name-only', `${baseSha}...${headSha}`], project) ?? git(['diff', '--name-only', baseSha, headSha], project) ?? '').split('\n').filter(Boolean)
  if (!changed) throw new Error('cannot determine changed files: pass --changed-files <list> or make sure the base commit is fetched')

  const diffDir = path.join(work, 'diff')
  const suspects = computeSuspects({ diffDir, baseGraph: base.graph, headGraph, changedFiles: changed, projectDir: project, depth: config.suspects.depth, broadCap: config.suspects.broadCap })
  writeJson(path.join(diffDir, 'pr.json'), { number: opts.pr ? Number(opts.pr) : undefined, title: opts.title, url: opts.url, baseSha, headSha, baseRef: opts['base-ref'] ?? base.manifest.source?.ref ?? null, headRef: opts['head-ref'] ?? null })

  const headRoutes = suspects.capture.filter((c) => c.side !== 'base').map((c) => ({ ...headGraph.routes.find((r) => r.id === c.id), reason: `${c.status}: ${c.reason}${c.via?.length ? ' via ' + c.via.join(', ') : ''}` })).filter((r) => r.id)
  const flows = loadFlows(project, [config.flowsDir, '.screenmap/out/flows'])
  const prContext = `${opts.title ?? ''} — changed files: ${changed.slice(0, 40).join(', ')}${changed.length > 40 ? ` (+${changed.length - 40})` : ''}`

  const sides = []
  const baseStatusByPlatform = {}, headStatusByPlatform = {}
  for (const platform of platforms) {
    const pc = platformConfig(config, platform)
    const sub = multi ? [platform] : []
    // base side comes from the baseline — nothing is captured twice
    const prevSide = baselineSide(base, platform)
    const baseSubset = {}
    for (const c of suspects.capture.filter((c) => c.side !== 'head')) {
      copyShots(prevSide.dir, path.join(diffDir, 'base', 'screens', ...sub), c.slug)
      if (prevSide.status[c.id]) baseSubset[c.id] = prevSide.status[c.id]
    }
    baseStatusByPlatform[platform] = baseSubset

    // head side: capture suspects on the PR head
    let cap = { replay: [], deeplink: [], agent: [], failed: [], unflowed: [] }
    let deviceName = pc.device
    const headScreens = path.join(diffDir, 'head', 'screens', ...sub)
    if (headRoutes.length && !opts['no-sim']) {
      const session = await openSession({ projectDir: project, config: pc, scheme, platform })
      deviceName = session.deviceName
      try {
        cap = await captureRoutes({
          project, config: pc, scheme, session, routes: headRoutes, flows, outDir: headScreens, work: path.join(work, platform),
          agentMode: 'pr', agentEnabled: !opts['no-agent'], prContext,
        })
      } finally { session.close() }
    }
    // notes are about the change, not the device — the first platform to
    // produce them wins rather than each overwriting the last
    if (cap.notes && !exists(path.join(diffDir, 'notes.json'))) writeJson(path.join(diffDir, 'notes.json'), cap.notes)
    const headStatus = {}
    for (const id of cap.failed) headStatus[id] = { status: 'missing', note: `deep link failed in CI (${platform})` }
    headStatusByPlatform[platform] = headStatus
    downscaleAll(headScreens)
    sides.push({ platform, device: deviceName, cap })
  }
  writeJson(path.join(diffDir, 'base', 'capture-status.json'), multi ? baseStatusByPlatform : baseStatusByPlatform[platforms[0]])
  writeJson(path.join(diffDir, 'head', 'capture-status.json'), multi ? headStatusByPlatform : headStatusByPlatform[platforms[0]])

  const out = path.resolve(opts.out ?? path.join(work, `${appName}-${opts.pr ? `pr${opts.pr}` : (headSha ?? 'head').slice(0, 7)}.diff.scrmap`))
  packDiff({ diffDir, platforms: sides.map((s) => ({ platform: s.platform, device: s.device })), out })
  const diff = readJson(path.join(diffDir, 'diff.json'))
  const sum = (f) => sides.reduce((n, s) => n + f(s), 0)
  const summary = {
    kind: 'pr', app: appName, pr: opts.pr ? Number(opts.pr) : null, title: opts.title ?? null, baseSha, headSha, bundle: out,
    baselineGeneratedAt: base.manifest.generatedAt,
    device: sides.map((s) => s.device).filter(Boolean).join(' · ') || null,
    argent: argentVersion(), ocr: ocrBackend(),
    platforms: sides.map((s) => ({
      platform: s.platform, device: s.device,
      captured: { replay: s.cap.replay.length, deeplink: s.cap.deeplink.length, agent: s.cap.agent.length, failed: s.cap.failed },
      drifted: s.cap.drifted ?? [], unverified: s.cap.unverified ?? [], agent: s.cap.agentRun ?? { ran: false },
    })),
    suspects: { added: suspects.capture.filter((c) => c.status === 'A').length, modified: suspects.capture.filter((c) => c.status === 'M').length, removed: suspects.capture.filter((c) => c.status === 'D').length, broadFiles: suspects.broadFiles },
    captured: {
      replay: sum((s) => s.cap.replay.length), deeplink: sum((s) => s.cap.deeplink.length),
      agent: sum((s) => s.cap.agent.length), failed: sides.flatMap((s) => s.cap.failed),
    },
    agent: sides[0].cap.agentRun ?? { ran: false },
    recordedFlowsDir: sides.map((s) => s.cap.recordedFlowsDir).find(Boolean) ?? null,
    drifted: sides.flatMap((s) => s.cap.drifted ?? []),
    unverified: sides.flatMap((s) => s.cap.unverified ?? []),
    diff: { nodes: diff.nodes, dismissed: diff.dismissed ?? [], edges: diff.edges, states: (diff.states ?? []).filter((s) => s.reason !== 'hint') },
    // base first so head wins on collision: a removed route only exists on the
    // base side, and without it the comment prints its bare id ("grind")
    // where every other row shows a path ("/grind")
    routes: Object.fromEntries([...base.graph.routes, ...headGraph.routes].map((r) => [r.id, r.urlPath])),
    shots: collectShots(diffDir, [...headGraph.routes, ...base.graph.routes], [...diff.nodes.map((d) => d.id), ...(diff.dismissed ?? []).map((d) => d.id)], multi ? platforms[0] : null),
  }
  writeJson(path.join(work, 'summary.json'), summary)
  console.log(JSON.stringify(summary, null, 2))
}

// Paths the PR comment's images are published under. The comment shows ONE
// platform — a side-by-side strip of both would not fit GitHub's table — so a
// multi-platform run passes the platform whose screens the comment should show
// (the first captured), and the bundle still carries every platform.
function collectShots(diffDir, routes, ids, platform = null) {
  const slugOf = new Map(routes.map((r) => [r.id, r.slug]))
  const sub = platform ? [platform] : []
  const rel = (side, f) => [side, 'screens', ...sub, f].join('/')
  const out = {}
  for (const id of new Set(ids)) {
    const slug = slugOf.get(id)
    if (!slug) continue
    const entry = { states: {} }
    for (const side of ['head', 'base']) {
      const dir = path.join(diffDir, side, 'screens', ...sub)
      if (!exists(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        const stem = f.replace(/\.\w+$/, '')
        if (stem === slug) entry[side] = rel(side, f)
        else if (stem.startsWith(slug + '--')) {
          const name = stem.slice(slug.length + 2)
          ;(entry.states[name] ??= {})[side] = rel(side, f)
        }
      }
    }
    if (entry.head || entry.base || Object.keys(entry.states).length) out[id] = entry
  }
  return out
}

// The PR comment. GitHub gives us tables, <img>, <details> and task lists —
// and strips every style attribute — so the layout is a table and anything that
// wants to look like screenmap has to arrive as a picture.
const MARK = { A: '🟩', M: '🟨', D: '🟥', U: '⬜' }
const TAG = { A: 'new', M: 'changed', D: 'removed' }
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const STRIP_MAX = 6
const CONTEXT_MAX = 2 // cleared suspects that ride along in the strip for context
const SHOT_W = 190 // px; the strip is the headline, so the screens carry it
// Without an agent in the loop there is no written note, so the raw reason has
// to carry the row. Say it the way a reviewer would.
const REASON = {
  'route-added': 'new route on this branch',
  'route-removed': 'route gone from this branch',
  'file-touched': 'its own source changed',
  'import-touched': 'something it imports changed',
}
const why = (d) => d.note ?? [REASON[d.reason] ?? d.reason, d.via?.length ? `(${d.via.slice(0, 2).map((f) => f.split('/').pop()).join(', ')}${d.via.length > 2 ? ', …' : ''})` : ''].filter(Boolean).join(' ')
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const say = (n) => WORDS[n] ?? String(n)

// A sentence about this pull request, not a changelog for the tool.
function headline({ A, M, D }) {
  const total = A.length + M.length + D.length
  if (!total) return 'No screen is affected by this pull request'
  const noun = total === 1 ? 'screen' : 'screens'
  if (A.length && !M.length && !D.length) return `${say(A.length)} new ${noun} in this pull request`
  if (D.length && !A.length && !M.length) return `${say(D.length)} ${noun} removed in this pull request`
  return `${say(total)} ${noun} changed in this pull request`
}

function renderComment(s, { mapUrl, changesUrl, artifactUrl, shotUrl, shotsBase, viewer = 'https://app.screenmap.dev' }) {
  const n = s.diff.nodes
  const A = n.filter((x) => x.status === 'A'), M = n.filter((x) => x.status === 'M'), D = n.filter((x) => x.status === 'D')
  const dismissed = s.diff.dismissed ?? []
  const route = (id) => s.routes[id] ?? id
  const states = (id) => (s.diff.states ?? []).filter((x) => x.node === id)
  const bareState = (id) => states(id).find((x) => x.name === '')
  const movedStates = (id) => states(id).filter((x) => x.name !== '' && ['A', 'M', 'D'].includes(x.status))

  const link = mapUrl || changesUrl
    ? `${viewer}/?${[mapUrl && `map=${encodeURIComponent(mapUrl)}`, changesUrl && `changes=${encodeURIComponent(changesUrl)}`].filter(Boolean).join('&')}`
    : null
  const nodeLink = (id) => (link ? `${link}&node=${encodeURIComponent(id)}` : null)
  const url = (rel) => (shotsBase && rel ? shotsBase.replace(/\/$/, '') + '/' + rel : null)

  // Which capture speaks for this screen. A screen whose bare capture is
  // identical but whose bottom sheet moved must show the sheet — otherwise the
  // strip is a row of pictures that all look unchanged.
  const capture = (id, status) => {
    const sh = s.shots?.[id]
    if (!sh) return null
    const side = status === 'D' ? 'base' : 'head'
    if (bareState(id)?.status === 'unchanged') {
      const moved = movedStates(id)[0]
      const rel = moved && sh.states?.[moved.name]?.[side]
      if (rel) return { rel, state: moved.name, note: moved.note ?? null }
    }
    return sh[side] ? { rel: sh[side], state: null, note: null } : null
  }

  const entries = [
    ...[...A, ...M, ...D].map((d) => ({ id: d.id, status: d.status, note: why(d) })),
    ...dismissed.map((d) => ({ id: d.id, status: 'U', note: why(d) })),
  ].map((e) => {
    const cap = capture(e.id, e.status)
    return { ...e, cap, note: cap?.note ?? e.note, tag: cap?.state ? `${cap.state} state` : (TAG[e.status] ?? 'unaffected') }
  })

  const lines = [`### ${headline({ A, M, D })}`, '']

  // the strip: the screens themselves, one cell each, captioned by route
  const withShot = entries.filter((e) => url(e.cap?.rel))
  const changedShots = withShot.filter((e) => e.status !== 'U')
  const shown = [...changedShots, ...withShot.filter((e) => e.status === 'U').slice(0, Math.max(0, Math.min(CONTEXT_MAX, STRIP_MAX - changedShots.length)))].slice(0, STRIP_MAX)
  if (shown.length) {
    const cells = shown.map((e) => {
      const img = `<img src="${url(e.cap.rel)}" width="${SHOT_W}" alt="${esc(route(e.id))}">`
      const href = nodeLink(e.id)
      return `<td align="center" valign="top">${href ? `<a href="${href}">${img}</a>` : img}<br><code>${esc(route(e.id))}</code><br><sub>${MARK[e.status]} ${esc(e.tag)}</sub></td>`
    })
    lines.push('<table><tr>', ...cells, '</tr></table>', '')
    if (entries.length > shown.length) lines.push(`<sub>${entries.length - shown.length} more in the list below.</sub>`, '')
  } else if (shotUrl) {
    lines.push(link ? `[![changed screens](${shotUrl})](${link})` : `![changed screens](${shotUrl})`, '')
  }

  // the ledger: route on the left, what changed on it on the right
  if (entries.length) {
    lines.push('<table>')
    for (const e of entries) {
      const name = `<code>${esc(route(e.id))}</code>${e.cap?.state ? ` <sub>· ${esc(e.cap.state)}</sub>` : ''}`
      const href = nodeLink(e.id)
      lines.push(`<tr><td>${MARK[e.status]} ${href ? `<a href="${href}">${name}</a>` : name}</td><td>${e.note ? esc(e.note) : ''}</td></tr>`)
    }
    lines.push('</table>', '')
  } else {
    lines.push('_Static analysis reaches no screen from the files this pull request touches._', '')
  }

  if (link) lines.push(`**[Open screenmap viewer for this PR →](${link})**`, '')

  const pairs = entries.filter((e) => e.status === 'M' && url(s.shots?.[e.id]?.base) && e.cap && url(e.cap.rel))
    .map((e) => {
      const sh = s.shots[e.id]
      const before = e.cap.state ? sh.states?.[e.cap.state]?.base : sh.base
      return before ? { ...e, before } : null
    }).filter(Boolean)
  if (pairs.length) {
    lines.push('<details><summary>Before and after</summary>', '', '<table>', '<tr><td></td><td align="center"><sub>before</sub></td><td align="center"><sub>after</sub></td></tr>')
    for (const e of pairs) {
      lines.push(`<tr><td valign="middle"><code>${esc(route(e.id))}</code>${e.cap.state ? `<br><sub>· ${esc(e.cap.state)}</sub>` : ''}</td><td><img src="${url(e.before)}" width="${SHOT_W}" alt="${esc(route(e.id))} before"></td><td><img src="${url(e.cap.rel)}" width="${SHOT_W}" alt="${esc(route(e.id))} after"></td></tr>`)
    }
    lines.push('</table>', '', '</details>')
  }

  const eA = s.diff.edges.filter((e) => e.status === 'A'), eD = s.diff.edges.filter((e) => e.status === 'D')
  if (eA.length || eD.length) {
    lines.push('<details><summary>' + [eA.length && `${eA.length} new route${eA.length === 1 ? '' : 's'}`, eD.length && `${eD.length} route${eD.length === 1 ? '' : 's'} gone`].filter(Boolean).join(' · ') + '</summary>', '')
    for (const e of [...eA, ...eD]) lines.push(`- ${MARK[e.status]} \`${route(e.from)}\` → \`${route(e.to)}\`${e.raw && e.raw !== route(e.to) ? ` — \`${e.raw}\`` : ''}`)
    lines.push('', '</details>')
  }

  // things that went wrong get to be seen, not buried in the footnote
  const warn = []
  if (s.captured.failed?.length) warn.push(`${s.captured.failed.length} screen${s.captured.failed.length === 1 ? '' : 's'} could not be captured — deep link failed in CI.`)
  // they were never explored at all, so do not imply they were tried and failed
  if (s.agent?.ran && s.agent.overBudget?.length) warn.push(`${s.agent.overBudget.length} screen${s.agent.overBudget.length === 1 ? '' : 's'} were over the agent budget and went unexplored — raise \`agent_max_screens\` or \`effort\` to include them.`)
  // "queued to be re-recorded" was only ever true when an agent could do the
  // re-recording. With no key nothing is queued anywhere and the same warning
  // returns on every PR, so say what actually has to happen instead.
  if (s.drifted?.length) {
    const names = s.drifted.map((d) => `\`${d.flows[0]}\``).join(', ')
    warn.push(
      s.agent?.hasKey
        ? `${s.drifted.length} committed flow${s.drifted.length === 1 ? '' : 's'} drifted (${names}) — captured by deep link instead. The next baseline run re-records ${s.drifted.length === 1 ? 'it' : 'them'} and opens a flows PR.`
        : `${s.drifted.length} committed flow${s.drifted.length === 1 ? '' : 's'} drifted (${names}) — captured by deep link instead. Nothing re-records ${s.drifted.length === 1 ? 'it' : 'them'} without an agent key, so ${s.drifted.length === 1 ? 'this flow' : 'these flows'} stays broken: re-record locally with \`/screenmap\`, adopt with \`screenmap-ci flows-adopt\`, and commit.`
    )
  }
  if (warn.length) lines.push('', '> [!WARNING]', ...warn.map((w) => `> ${w}`))

  if (s.recordedFlowsDir) lines.push('', '> [!NOTE]', '> New flows were recorded for screens that had none. A flows PR will follow after merge.')

  // provenance: worth keeping, not worth reading first
  const a = s.agent ?? {}
  let agentDesc = 'off'
  if (a.provider) {
    agentDesc = a.provider
    if (a.keyEnv) agentDesc += a.hasKey ? ` · ${a.keyEnv}` : ` · ${a.keyEnv} not set`
    else if (a.keyEnv === null && a.hasKey === null) agentDesc += ' · no LLM key configured'
  }
  const foot = [
    `Captured on ${s.device ?? 'simulator'}${s.platforms?.length > 1 ? ` (${s.platforms.map((p) => p.platform).join(' + ')})` : ''}: ${s.captured.replay} by flow replay${s.argent ? ` (argent ${s.argent})` : ''}, ${s.captured.deeplink} by deep link, ${s.captured.agent} by agent (${agentDesc}).`,
    // tesseract reads roughly two thirds of the words Vision does, which makes
    // a drift or verification warning likelier to be the OCR's fault than the
    // app's. Say which backend read the screens whenever it is not Vision.
    s.ocr && s.ocr !== 'vision' ? `Screen text read with ${s.ocr === 'tesseract' ? 'tesseract (lower recall than Vision — verification warnings here are less certain)' : s.ocr}.` : null,
    s.baselineGeneratedAt ? `Compared against baseline \`${(s.baseSha ?? '').slice(0, 7)}\` from ${new Date(s.baselineGeneratedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.` : null,
    `${A.length} added · ${M.length} changed · ${D.length} removed · ${dismissed.length} suspect${dismissed.length === 1 ? '' : 's'} cleared by looking.`,
    s.suspects.broadFiles?.length ? `${s.suspects.broadFiles.length} broadly-imported changed file${s.suspects.broadFiles.length === 1 ? '' : 's'} excluded from suspect marking.` : null,
    // a capture OCR could not vouch for is worth saying out loud: it is the
    // difference between "this is the screen" and "this is what the deep link
    // rendered"
    // Careful what this claims. The bogus-param probe only proves the route
    // renders the same thing for a real value and a nonsense one, which happens
    // both when the param failed to resolve AND when the screen quietly falls
    // back to a default. Saying "not-found" is wrong in the second case, and
    // the second case is common.
    s.unverified?.length
      ? `${s.unverified.length} capture${s.unverified.length === 1 ? '' : 's'} could not be verified (${s.unverified.map((u) => `\`${route(u.route)}\``).join(', ')}): the route renders the same screen for a real parameter and a nonsense one, so this may not be the screen you expect. Set a real value in \`params\`, or record a flow with landmarks.`
      : null,
    artifactUrl ? `[Download the bundle](${artifactUrl}).` : null,
  ].filter(Boolean)
  lines.push('', '<details><summary>How these were captured</summary>', '', ...foot.map((f) => `- ${f}`), '', '</details>')

  return lines.join('\n')
}

async function comment() {
  const s = readJson(opts.summary)
  const body = renderComment(s, { mapUrl: opts['map-url'], changesUrl: opts['changes-url'], artifactUrl: opts['artifact-url'], shotUrl: opts['shot-url'], shotsBase: opts['shots-base'], viewer: opts.viewer })
  if (opts.post) {
    const repo = opts.repo ?? repoSlug()
    const number = Number(opts.pr ?? s.pr)
    const how = upsertStickyComment({ repo, number, body })
    log(`comment ${how} on ${repo}#${number}`)
  } else console.log(body)
}

// Interim states for the same sticky comment the result later replaces. A PR
// run takes ~12 minutes, so without this the PR sits silent and a reviewer has
// no idea a map is coming; and when there is no baseline the job used to finish
// green having said nothing at all, which reads as "no screens changed".
const STATUS_BODIES = {
  pending: ({ runUrl }) =>
    [`### 🗺️ screenmap · mapping the screens this PR touches`, '',
     'Capturing on a simulator now — this comment is replaced with the screens when it finishes, usually in about 12 minutes.',
     runUrl ? `\n<sub>[Follow the run →](${runUrl})</sub>` : null].filter((l) => l !== null).join('\n'),

  'no-baseline': ({ baselineWorkflow = 'screenmap-baseline.yml', branch = 'screenmaps', repoUrl }) =>
    [`### 🗺️ screenmap · no baseline map yet`, '',
     `There is no map of the base branch on \`${branch}\`, so there is nothing to compare this PR against.`,
     '',
     '**To fix:** run the baseline workflow once on the default branch — Actions → **screenmap · baseline** → *Run workflow*.' +
       (repoUrl ? ` [Open it →](${repoUrl}/actions/workflows/${baselineWorkflow})` : ''),
     '',
     'Push to this PR again afterwards and the map will appear here.'].join('\n'),

  // The baseline is a prerequisite we can satisfy ourselves, so the default is
  // to start it rather than hand the reader a chore. It maps the whole app, so
  // it is slower than the PR runs that follow.
  'baseline-started': ({ runUrl, minutes = 20 }) =>
    [`### 🗺️ screenmap · building the first map`, '',
     `This repo had no baseline to compare against, so one is being built from the default branch now. It maps every screen, so it takes longer than a normal run — roughly ${minutes} minutes.`,
     '',
     'This PR is mapped automatically as soon as it finishes. Nothing for you to do.',
     runUrl ? `\n<sub>[Follow the baseline run →](${runUrl})</sub>` : null].filter((l) => l !== null).join('\n'),

  failed: ({ runUrl }) =>
    [`### 🗺️ screenmap · run failed`, '',
     'The map could not be built for this commit, so there are no screens to show. The last successful map, if there was one, is unaffected.',
     runUrl ? `\n<sub>[See the failing run →](${runUrl})</sub>` : null].filter((l) => l !== null).join('\n'),
}

async function status() {
  const state = opts.state
  const render = STATUS_BODIES[state]
  if (!render) { console.error(`usage: screenmap-ci status --state <${Object.keys(STATUS_BODIES).join('|')}> [--pr N] [--run-url U]`); process.exit(1) }
  const body = render({
    runUrl: opts['run-url'] || null,
    repoUrl: opts['repo-url'] || null,
    branch: opts.branch,
    baselineWorkflow: opts['baseline-workflow'],
    minutes: opts.minutes,
  })
  if (!opts.post) { console.log(body); return }
  const repo = opts.repo ?? repoSlug()
  const number = Number(opts.pr)
  // never let a status update be the thing that fails a run
  try {
    const how = upsertStickyComment({ repo, number, body })
    log(`status comment (${state}) ${how} on ${repo}#${number}`)
  } catch (e) { log(`status comment (${state}) skipped: ${e.message}`) }
}

// The local skill records into .screenmap/out/flows and tells you to gitignore
// that directory; CI replays from config.flowsDir (.screenmap/flows). Nothing
// moved them across, so "record locally, replay deterministically in CI" did
// not actually work without copying files by hand.
async function flowsAdopt() {
  const project = path.resolve(opts.project ?? '.')
  const config = loadConfig(project)
  const from = path.resolve(project, opts.from ?? path.join('.screenmap', 'out', 'flows'))
  const to = path.resolve(project, opts.to ?? config.flowsDir)
  if (!exists(from)) { console.error(`nothing to adopt: ${path.relative(project, from)} does not exist`); process.exit(1) }
  const names = fs.readdirSync(from).filter((f) => /\.(ya?ml|json)$/.test(f))
  if (!names.length) { console.error(`nothing to adopt: no flows in ${path.relative(project, from)}`); process.exit(1) }
  ensureDir(to)
  const adopted = [], skipped = []
  for (const n of names) {
    const dest = path.join(to, n)
    // a committed flow is reviewed code; replacing one silently is not our call
    if (exists(dest) && !opts.force && fs.readFileSync(dest).compare(fs.readFileSync(path.join(from, n))) !== 0) { skipped.push(n); continue }
    fs.copyFileSync(path.join(from, n), dest)
    adopted.push(n)
  }
  console.log(JSON.stringify({ from: path.relative(project, from), to: path.relative(project, to), adopted, skipped }, null, 2))
  if (skipped.length) console.error(`${skipped.length} flow(s) already exist and differ — pass --force to overwrite: ${skipped.join(', ')}`)
  if (adopted.length) console.error(`adopted ${adopted.length} file(s) into ${path.relative(project, to)} — review and commit them`)
}

async function publish() {
  const repo = opts.repo ?? repoSlug()
  // a src that is a directory publishes every file under it, keeping the tree
  const files = String(opts.files).split(',').flatMap((pair) => {
    const [src, dest] = pair.split('=')
    if (!exists(src) || !fs.statSync(src).isDirectory()) return [{ src, dest }]
    const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : [{ src: path.join(dir, e.name), dest: `${dest}/${rel}${e.name}` }])
    return walk(src)
  })
  const res = publishToBranch({ repo, branch: opts.branch ?? 'screenmaps', files, message: opts.message ?? 'screenmap-ci: publish bundles', cwd: path.resolve(opts.cwd ?? '.') })
  console.log(JSON.stringify(res, null, 2))
}

async function flowsPr() {
  const repo = opts.repo ?? repoSlug()
  const url = openFlowsPR({ repo, base: opts.base ?? 'main', flowsSrcDir: opts.flows, flowsDestDir: opts.dest ?? '.screenmap/flows', title: opts.title ?? 'screenmap: record flows for new screens', body: opts.body ?? 'Flows recorded by the screenmap agent for screens that had no committed flow. Review the taps, then merge so future runs replay them deterministically.', cwd: path.resolve(opts.cwd ?? '.') })
  console.log(JSON.stringify({ url }))
}

async function shot() {
  const { takeShot } = await import('./lib/shot.mjs')
  const out = path.resolve(opts.out ?? 'screenmap-shot.png')
  await takeShot({ mapFile: path.resolve(opts.map), changesFile: opts.changes ? path.resolve(opts.changes) : null, out, viewer: opts.viewer || undefined })
  console.log(JSON.stringify({ shot: out }))
}

async function resolveAppCmd() {
  const { resolveApp, DEFAULT_PROFILES } = await import('./lib/eas.mjs')
  const project = path.resolve(opts.project ?? '.')
  const platform = String(opts.platform ?? 'ios')
  const res = resolveApp({
    projectDir: project, platform,
    profile: opts.profile ?? DEFAULT_PROFILES[platform] ?? DEFAULT_PROFILES.ios,
    workDir: path.resolve(opts.work ?? path.join(project, '.screenmap', 'out', 'ci', 'eas', platform)),
  })
  console.log(JSON.stringify(res, null, 2))
}

// Fold single-platform baselines into one multi-platform map. iOS has to run on
// a macOS runner and Android is only worth doing on Linux, so the two platforms
// are captured by separate jobs; this is what makes their output one bundle
// rather than two the reader has to hold side by side.
//
// The graph, edges and flows come from the FIRST input: they are static
// analysis of the same commit, so every input agrees on them, and picking one
// beats reconciling identical copies.
async function merge() {
  if (!opts.inputs) throw new Error('--inputs ios=a.scrmap,android=b.scrmap is required')
  const parsed = String(opts.inputs).split(',').map((pair) => {
    const i = pair.indexOf('=')
    if (i < 0) throw new Error(`--inputs entry "${pair}" must be <platform>=<file.scrmap>`)
    return { platform: pair.slice(0, i).trim(), file: path.resolve(pair.slice(i + 1).trim()) }
  })
  const work = ensureDir(path.resolve(opts.work ?? path.join(process.cwd(), '.screenmap-merge')))
  const sides = []
  let first = null
  const captureStatus = {}
  for (const { platform, file } of parsed) {
    if (!exists(file)) { log(`merge: skipping ${platform} — ${file} not found`); continue }
    const b = readBaseline(file, path.join(work, platform))
    first ??= b
    const side = baselineSide(b, platform)
    // Refuse a bundle that does not carry the platform it is being merged as.
    // Two artifact paths swapped in a workflow is an easy mistake to make and an
    // impossible one to spot afterwards: the map would show iOS screenshots
    // under the Android switch and look entirely plausible.
    if (!side.exists) {
      throw new Error(`merge: ${file} does not carry ${platform} captures (it holds ${platformsIn(b.manifest).join(', ')}) — check the --inputs mapping`)
    }
    // a single-platform input has its screens at screens/, a multi-platform one
    // at screens/<platform>/ — baselineSide answers for both
    sides.push({ platform, device: b.manifest.app?.device ?? null, screensDir: side.dir })
    captureStatus[platform] = side.status
  }
  if (!sides.length) throw new Error('merge: none of the inputs existed')
  if (sides.length === 1) log(`merge: only ${sides[0].platform} was available — writing a single-platform map`)
  const out = path.resolve(opts.out ?? path.join(work, 'merged.scrmap'))
  packBaseline({
    graph: first.graph, platforms: sides, flowsDir: first.flowsDir,
    captureStatus: sides.length > 1 ? captureStatus : captureStatus[sides[0].platform],
    appName: opts.app ?? first.manifest.app?.name ?? 'app',
    commit: opts.commit ?? first.manifest.source?.commit ?? null,
    ref: opts.ref ?? first.manifest.source?.ref ?? null,
    out,
  })
  console.log(JSON.stringify({ kind: 'merge', bundle: out, platforms: sides.map((s) => ({ platform: s.platform, device: s.device })) }, null, 2))
}

const commands = { baseline, pr, comment, status, publish, 'flows-pr': flowsPr, 'flows-adopt': flowsAdopt, 'resolve-app': resolveAppCmd, merge, shot }
if (!commands[cmd]) { console.error('usage: screenmap-ci <baseline|pr|comment|status|publish|flows-pr|flows-adopt|resolve-app|merge|shot> [options]'); process.exit(1) }
commands[cmd]().catch((e) => { console.error('[screenmap-ci] failed:', e.message); process.exit(1) })
