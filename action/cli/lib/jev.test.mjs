import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { runJev, candidates, parseDescribe } from './jev.mjs'
import { loadConfig } from './util.mjs'

const el = (role, text, y, flags = []) => ({ role, text, flags, x: 0.1, y, w: 0.8, h: 0.05 })

const APP = {
  home: { els: [el('AXHeading', 'Home', 0.05), el('AXButton', 'Settings', 0.2), el('AXButton', 'Search', 0.3), el('AXButton', 'Sign out', 0.4), el('AXButton', 'Delete account', 0.5)], to: { Settings: 'settings', Search: 'search' } },
  settings: { els: [el('AXHeading', 'Settings', 0.05), el('AXButton', 'Account', 0.2), el('AXTextField', 'Password', 0.3)], to: { Account: 'account' } },
  account: { els: [el('AXHeading', 'Account details', 0.05), el('AXStaticText', 'Membership tier', 0.2)], to: {} },
  search: { els: [el('AXHeading', 'Search', 0.05), el('AXSearchField', 'Find recipes', 0.15), el('AXButton', 'Go', 0.25)], to: { Go: 'results' } },
  results: { els: [el('AXHeading', 'Search results', 0.05), el('AXStaticText', 'Matching recipes', 0.2)], to: {} },
  ping: { els: [el('AXButton', 'Next', 0.2)], to: { Next: 'pong' } },
  pong: { els: [el('AXButton', 'Previous', 0.2)], to: { Previous: 'ping' } },
}

function fakeDevice(root) {
  const d = { at: root, log: [], typed: [], shots: [] }
  const hit = (p) => APP[d.at].els.find((e) => Math.abs(e.y + e.h / 2 - p.y) < 1e-6)
  Object.assign(d, {
    relaunch: async () => { d.at = root; d.log.push('relaunch') },
    open: (url) => { d.at = root; d.log.push(`open ${url}`) },
    screenshot: (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'png'); d.shots.push(p); return p },
    elements: () => APP[d.at].els,
    tap: (p) => { const e = hit(p); d.log.push(`tap ${e?.text}`); if (e && APP[d.at].to[e.text]) d.at = APP[d.at].to[e.text] },
    type: (t) => { d.typed.push(t); d.log.push(`type ${t}`) },
    swipe: () => d.log.push('swipe'),
    back: () => d.log.push('back'),
  })
  return d
}

function fakeJev(route, { confidence = 0.9 } = {}) {
  const j = { calls: [], options: [], used: new Set() }
  j.systemOne = async ({ state, questions }) => {
    j.calls.push(state)
    const opts = questions.next.criteria
    j.options.push(...Object.values(opts))
    const label = (want) => Object.keys(opts).find((k) => opts[k].includes(want))
    const here = state.screen.join('|')
    const arrived = here.includes(state.target.title) ? 0.95 : 0.05
    const wanted = route.find((w) => !j.used.has(w) && label(w))
    if (wanted) j.used.add(wanted)
    return { answers: { arrived: { type: 'noul', noul: arrived }, next: { type: 'choice', choice: wanted ? label(wanted) : 'stuck', confidence, probabilities: {} } } }
  }
  return j
}

function setup(screen, { jev, text = null, root = 'home', agent = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-'))
  const device = fakeDevice(root)
  const args = {
    screens: [{ slug: screen.id, ...screen }], config: { agent, waits: { transition: 0 } }, scheme: 'demo', bundleId: 'com.demo', platform: 'ios', deviceName: 'iPhone 16 Pro',
    outScreensDir: path.join(dir, 'screens'), outFlowsDir: path.join(dir, 'flows'), summaryPath: path.join(dir, 'summary.json'),
    deps: { jev, text, device },
  }
  return { dir, device, args }
}

test('reaches the target and records a replayable flow with landmarks', async () => {
  const jev = fakeJev(['"Settings"', '"Account"'])
  const { dir, device, args } = setup({ id: 'account', title: 'Account details', file: 'app/account.tsx', incoming: [{ from: 'settings', link: "navigate('account')" }] }, { jev })
  const summary = await runJev(args)
  assert.deepEqual(summary, { captured: ['account'], skipped: [], flows: ['nav-account'] })
  assert.deepEqual(device.log, ['relaunch', 'open demo://', 'tap Settings', 'tap Account'])
  assert.deepEqual(JSON.parse(fs.readFileSync(args.summaryPath, 'utf8')), summary)
  assert.ok(fs.existsSync(path.join(dir, 'screens', 'account.png')))
  const steps = YAML.parse(fs.readFileSync(path.join(dir, 'flows', 'nav-account.yaml'), 'utf8')).steps
  assert.deepEqual(steps, [
    { tool: 'open-url', args: { url: 'demo://' } }, { wait: 0 },
    { tap: { x: 0.5, y: 0.225 } }, { wait: 0 },
    { tap: { x: 0.5, y: 0.225 } }, { wait: 0 },
  ])
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'flows', 'nav-account.meta.json'), 'utf8'))
  assert.equal(meta.formatVersion, 2)
  assert.equal(meta.route, 'account')
  assert.deepEqual(meta.steps, { 2: { target: 'Settings' }, 4: { target: 'Account', screen: 'account' }, 5: { capture: 'account.png' } })
  assert.ok(meta.landmarks.length >= 2 && meta.landmarks.length <= 5, String(meta.landmarks))
  assert.ok(meta.landmarks.includes('details'))
  assert.equal(jev.calls[0].target.linkedFrom[0].link, "navigate('account')")
})

test('keeps committed landmarks and refuses arrival without them', async () => {
  const jev = fakeJev(['"Settings"', '"Account"'])
  const { dir, args } = setup({ id: 'account', title: 'Account details', landmarks: ['Membership', 'Tier'] }, { jev })
  await runJev(args)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'flows', 'nav-account.meta.json'), 'utf8')).landmarks, ['Membership', 'Tier'])
  const wrong = setup({ id: 'account', title: 'Account details', landmarks: ['Invoices'] }, { jev: fakeJev(['"Settings"', '"Account"']), agent: { maxSteps: 3 } })
  const summary = await runJev(wrong.args)
  assert.deepEqual(summary.captured, [])
})

test('never offers destructive controls or secret fields', async () => {
  const jev = fakeJev(['"Settings"', '"Account"'])
  const { args } = setup({ id: 'account', title: 'Account details' }, { jev, text: async () => 'x' })
  await runJev(args)
  assert.ok(jev.options.length > 0)
  assert.ok(!jev.options.some((o) => /Sign out|Delete account|Password/.test(o)), jev.options.join('\n'))
  const offered = candidates([el('AXButton', 'Buy now', 0.1), el('AXButton', 'Log out', 0.2), el('AXButton', 'Profile', 0.3), el('AXButton', 'Save', 0.4, ['disabled']), el('AXTextField', 'Email', 0.5), el('AXSecureTextField', 'Code', 0.6, ['password'])], { platform: 'ios' })
  assert.deepEqual(offered.map((a) => a.key), ['tap:Profile', 'scroll'])
})

test('uses the text model only to fill a field', async () => {
  const asked = []
  const text = async (q) => { asked.push(q); return 'pasta\nignored second line' }
  const jev = fakeJev(['"Search" (AXButton)', 'type into the "Find recipes"', '"Go"'])
  const { dir, device, args } = setup({ id: 'results', title: 'Search results' }, { jev, text })
  const summary = await runJev(args)
  assert.deepEqual(summary.captured, ['results'])
  assert.equal(asked.length, 1)
  assert.equal(asked[0].field, 'Find recipes')
  assert.deepEqual(device.typed, ['pasta'])
  const steps = YAML.parse(fs.readFileSync(path.join(dir, 'flows', 'nav-results.yaml'), 'utf8')).steps
  assert.ok(steps.some((s) => s.tool === 'keyboard' && s.args.text === 'pasta'))
})

test('stops on the step budget and reports the screen unreached', async () => {
  const jev = fakeJev(['"Settings"', '"Account"'])
  const { dir, args } = setup({ id: 'nowhere', title: 'Unreachable' }, { jev, agent: { maxSteps: 1 } })
  const summary = await runJev(args)
  assert.deepEqual(summary.captured, [])
  assert.match(summary.skipped[0].why, /step budget \(1\)/)
  assert.equal(jev.calls.length, 2)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'flows')), [])
})

test('stops when it keeps coming back to the same screen', async () => {
  const jev = fakeJev(['"Next"', '"Previous"', 'scroll down'])
  const { args } = setup({ id: 'nowhere', title: 'Unreachable' }, { jev, root: 'ping' })
  const summary = await runJev(args)
  assert.match(summary.skipped[0].why, /same screen/)
})

test('stops when jev is unsure or sees no way forward', async () => {
  const unsure = setup({ id: 'account', title: 'Account details' }, { jev: fakeJev(['"Settings"'], { confidence: 0.1 }) })
  assert.match((await runJev(unsure.args)).skipped[0].why, /confidence 0.10/)
  const stuck = setup({ id: 'account', title: 'Account details' }, { jev: fakeJev([]) })
  assert.match((await runJev(stuck.args)).skipped[0].why, /no action/)
})

test('a failing call marks the screen skipped and moves on', async () => {
  const jev = { systemOne: async () => { throw new Error('401 invalid key') } }
  const { args } = setup({ id: 'account', title: 'Account details' }, { jev })
  assert.deepEqual(await runJev(args), { captured: [], skipped: [{ id: 'account', why: '401 invalid key' }], flows: [] })
})

test('parses argent describe output', () => {
  const out = [
    'Source: ax-service', 'Mode: flat', 'Coordinates are normalized [0,1] fractions of the screen (x, y, width, height), not pixels.', '',
    'ROOT  AXGroup (0.000, 0.000, 1.000, 1.000)', '',
    '  AXHeading "Settings"  (0.050, 0.060, 0.400, 0.040)',
    '  AXButton "Say "hi"" id="greet" [clickable]  (0.100, 0.200, 0.800, 0.050)',
    '  AXTextField value="pasta" [focused]  (0.100, 0.300, 0.800, 0.050)',
  ].join('\n')
  assert.deepEqual(parseDescribe(out), [
    { role: 'AXHeading', text: 'Settings', flags: [], x: 0.05, y: 0.06, w: 0.4, h: 0.04 },
    { role: 'AXButton', text: 'Say "hi"', flags: ['clickable'], x: 0.1, y: 0.2, w: 0.8, h: 0.05 },
    { role: 'AXTextField', text: 'pasta', flags: ['focused'], x: 0.1, y: 0.3, w: 0.8, h: 0.05 },
  ])
})

test('jev needs both the classifier key and the agent key', () => {
  const keys = ['AGENT_PROVIDER', 'AGENT_API_KEY', 'ANTHROPIC_API_KEY', 'CLASSIFIER_API_KEY', 'TYPESAFE_API_KEY', 'SCREENMAP_EFFORT']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const effortWith = (env) => {
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, { AGENT_PROVIDER: 'jev' }, env)
    return loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-cfg-'))).effort
  }
  try {
    assert.equal(effortWith({ AGENT_API_KEY: 'a' }), 'deterministic')
    assert.equal(effortWith({ CLASSIFIER_API_KEY: 't' }), 'deterministic')
    assert.equal(effortWith({ AGENT_API_KEY: 'a', CLASSIFIER_API_KEY: 't' }), 'balanced')
    assert.equal(effortWith({ ANTHROPIC_API_KEY: 'a', TYPESAFE_API_KEY: 't' }), 'balanced')
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
  }
})
