#!/usr/bin/env node
// Snapshot tests for the route providers, plus a render check of the static
// HTML fallback against a v2 flow sidecar.
//
//   node fixtures/run-tests.mjs           # check every fixture against its snapshot
//   node fixtures/run-tests.mjs --update  # rewrite the snapshots after an intended change
//
// Each fixture pins both the provider that detection picks and the whole graph,
// so a change that silently re-routes a project to a different provider — or
// quietly drops a route — fails here rather than in someone's capture run.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(HERE, '..', 'plugins', 'screenmap', 'skills', 'screenmap', 'scripts')
const PARSER = path.join(SCRIPTS, 'parse-routes.mjs')
const RENDERER = path.join(SCRIPTS, 'render-map.mjs')
const UPDATE = process.argv.includes('--update')

const FIXTURES = [
  { dir: 'demo-app', provider: 'expo-router' },
  { dir: 'rn-demo-app', provider: 'react-navigation' },
]

// generatedAt and projectRoot are machine- and clock-specific.
function stable(graph) {
  const { generatedAt, projectRoot, ...rest } = graph
  return rest
}

// The static HTML fallback must accept a v2 flow pair (argent YAML plus a
// .meta.json sidecar keyed by step index) — the shape the skill records today.
// Render the fixture with one such flow and check the step annotations made
// it into the page. Returns an error message, or null when the render is fine.
function renderWithV2Flow(root, graph) {
  const target = graph.routes.find((r) => r.reach === 'navigation-only') ?? graph.routes[0]
  const outDir = path.join(root, '.screenmap', 'out')
  const flowsDir = path.join(outDir, 'flows')
  fs.mkdirSync(flowsDir, { recursive: true })
  fs.writeFileSync(
    path.join(flowsDir, 'nav-test.yaml'),
    ['steps:', '  - tool: open-url', '    args:', `      url: "${graph.scheme ?? 'app'}://"`, '  - wait: 2000', '  - tap: "Get started"', '  - wait: 1500', ''].join('\n')
  )
  fs.writeFileSync(
    path.join(flowsDir, 'nav-test.meta.json'),
    JSON.stringify({
      formatVersion: 2,
      name: 'nav-test',
      title: `Navigate to ${target.title ?? target.id}`,
      route: target.id,
      steps: { 2: { target: 'Get started button', screen: target.id, capture: `${target.slug}.png` } },
    })
  )
  const html = path.join(outDir, 'map.html')
  try {
    execFileSync('node', [RENDERER, path.join(outDir, 'graph.json'), '--out', html, '--no-embed'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return `render-map exited ${e.status} on a v2 flow sidecar\n${e.stderr ?? ''}`
  }
  const page = fs.readFileSync(html, 'utf8')
  for (const needle of [`Navigate to ${target.title ?? target.id}`, 'Get started button', `${target.slug}.png`]) {
    if (!page.includes(needle)) return `render-map output is missing "${needle}"`
  }
  return null
}

let failed = 0
for (const { dir, provider } of FIXTURES) {
  const root = path.join(HERE, dir)
  const out = path.join(root, '.screenmap', 'out', 'graph.json')
  let stderr = ''
  try {
    execFileSync('node', [PARSER, root, '--out', out], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    console.error(`FAIL ${dir}: parser exited ${e.status}\n${e.stderr ?? ''}`)
    failed++
    continue
  }
  const graph = stable(JSON.parse(fs.readFileSync(out, 'utf8')))
  const renderError = renderWithV2Flow(root, graph)
  fs.rmSync(path.join(root, '.screenmap'), { recursive: true, force: true })
  if (renderError) {
    console.error(`FAIL ${dir}: ${renderError}`)
    failed++
    continue
  }

  if (graph.mode !== provider) {
    console.error(`FAIL ${dir}: expected provider "${provider}", detection chose "${graph.mode}"`)
    failed++
    continue
  }

  const snapPath = path.join(HERE, dir, 'expected-graph.json')
  const actual = JSON.stringify(graph, null, 2) + '\n'
  if (UPDATE || !fs.existsSync(snapPath)) {
    fs.writeFileSync(snapPath, actual)
    console.log(`${UPDATE ? 'updated' : 'created'} ${dir}/expected-graph.json`)
    continue
  }
  if (fs.readFileSync(snapPath, 'utf8') !== actual) {
    console.error(`FAIL ${dir}: graph differs from expected-graph.json (re-run with --update if intended)`)
    const a = fs.readFileSync(snapPath, 'utf8').split('\n')
    const b = actual.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  line ${i + 1}:\n    expected: ${a[i] ?? '<eof>'}\n    actual:   ${b[i] ?? '<eof>'}`)
        break
      }
    }
    failed++
    continue
  }
  console.log(`ok   ${dir} — ${provider}, ${graph.routes.length} routes, ${graph.edges.length} edges`)
}

if (failed) {
  console.error(`\n${failed} fixture(s) failed`)
  process.exit(1)
}
console.log(`\nall ${FIXTURES.length} fixtures passed`)
