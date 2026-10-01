import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk'
import { argentRun } from './argent.mjs'
import { ocr, words, containment } from './ocr.mjs'
import { ensureDir, log, sleep, writeJson } from './util.mjs'

export const TEXT_MODEL = 'claude-haiku-4-5'
const MAX_STEPS = 12
const MIN_CONFIDENCE = 0.3
const ARRIVED = 0.5
const MAX_VISITS = 2
const MAX_OPTIONS = 60
const SCROLL = { fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 }
const UNSAFE = /\b(sign ?out|log ?out|delete|remove|erase|reset|purchase|buy|pay|subscribe|unsubscribe|checkout|order|send|post|publish|report|block|deactivate|transfer|uninstall)\b/i
const SECRET = /pass(word|code)|\bpin\b|card|cvv|ssn|secret|token|otp|e-?mail|phone/i
const FIELD = /TextField|SearchField|EditText|textbox|searchbox/i
const VISIBLE = /text|heading/i
const LINE = /^\s+(\S+)(?: "(.*?)")?(?: value="(.*?)")?(?: id="(.*?)")?(?: \[([^\]]*)\])?\s+\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)$/

export function parseDescribe(text) {
  return text.split('\n').map((l) => l.match(LINE)).filter(Boolean).map(([, role, label, value, id, flags, x, y, w, h]) => ({
    role, text: label || value || id || '', flags: flags ? flags.split(',') : [], x: +x, y: +y, w: +w, h: +h,
  }))
}

export function sessionDevice(session, scratch) {
  const run = (tool, args = {}) => {
    const r = argentRun(tool, { udid: session.id, ...args })
    if (!r.ok) log(`jev: argent ${tool} failed:`, r.raw.trim().slice(-200))
    return r
  }
  return {
    relaunch: () => session.relaunch(),
    open: (url) => session.driver.openUrl(session.id, url, session.appId),
    screenshot: (p) => session.screenshot(p),
    elements() {
      const r = run('describe')
      const els = r.json?.description ? parseDescribe(r.json.description) : []
      if (els.length) return els
      return ocr(session.screenshot(scratch)).map((i) => ({ role: 'text', text: i.text, flags: [], x: i.x, y: 1 - i.y - i.h, w: i.w, h: i.h }))
    },
    tap: (p) => run('gesture-tap', p),
    type: (text) => run('keyboard', { text }),
    swipe: (a) => run('gesture-swipe', a),
    back: () => run('button', { button: 'back' }),
  }
}

export function anthropicText({ apiKey, model }) {
  return async ({ field, target, screen }) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 64,
        system: 'You fill one input field in a mobile app that an automated crawler is exploring. Reply with only the text to type: short, plausible, harmless sample input such as a search term, a name or a sentence. Never a credential, email address, phone number or payment detail.',
        messages: [{ role: 'user', content: JSON.stringify({ field, target, screen }) }],
      }),
    })
    if (!res.ok) throw new Error(`text model ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const body = await res.json()
    return body.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
}

export function candidates(elements, { canType, platform }) {
  const out = [], seen = new Set()
  for (const el of elements) {
    const label = el.text.trim()
    if (!label || el.flags.includes('disabled') || UNSAFE.test(label)) continue
    const kind = FIELD.test(el.role) ? 'type' : 'tap'
    if (kind === 'type' && (!canType || el.flags.includes('password') || SECRET.test(label))) continue
    const key = `${kind}:${label}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, kind, el, label: kind === 'type' ? `type into the "${label}" field` : `tap "${label}" (${el.role})` })
  }
  out.splice(MAX_OPTIONS)
  out.push({ key: 'scroll', kind: 'scroll', label: 'scroll down' })
  if (platform === 'android') out.push({ key: 'back', kind: 'back', label: 'press the back button' })
  return out
}

const center = (el) => ({ x: Number((el.x + el.w / 2).toFixed(4)), y: Number((el.y + el.h / 2).toFixed(4)) })

function perform(device, action, text) {
  if (action.kind === 'tap') { const p = center(action.el); device.tap(p); return [{ tap: p }] }
  if (action.kind === 'type') { const p = center(action.el); device.tap(p); device.type(text); return [{ tap: p }, { tool: 'keyboard', args: { text } }] }
  if (action.kind === 'scroll') { device.swipe(SCROLL); return [{ tool: 'gesture-swipe', args: SCROLL }] }
  device.back()
  return [{ tool: 'button', args: { button: 'back' } }]
}

async function decide(ctx, target, els, history, actions) {
  const options = Object.fromEntries(actions.map((a, i) => [`a${i}`, a.label]))
  const { answers } = await ctx.jev.systemOne({
    model: ctx.model,
    state: { task: 'Drive a mobile app to the target screen, one UI action at a time.', target, screen: els.map((e) => `${e.role} "${e.text}"`), history },
    questions: {
      arrived: noul('Is the app currently showing the target screen?'),
      next: choice('Which action moves the app closest to the target screen?', { ...options, stuck: 'none of these actions leads toward the target' }),
    },
  })
  const pick = answers.next.choice === 'stuck' ? null : actions[Number(answers.next.choice.slice(1))]
  return { arrived: answers.arrived.noul, pick, confidence: answers.next.confidence }
}

async function reach(s, ctx) {
  const { device, config } = ctx
  const target = { route: s.id, title: s.title ?? s.id, file: s.file ?? null, urlPath: s.urlPath ?? null, landmarks: s.landmarks ?? [], linkedFrom: s.incoming ?? [] }
  const marks = new Set(target.landmarks.map((w) => String(w).toLowerCase()))
  const wait = () => sleep(config.waits.transition)
  await device.relaunch()
  const steps = [ctx.scheme ? { tool: 'open-url', args: { url: `${ctx.scheme}://` } } : { launch: ctx.appId }, { wait: config.waits.transition }]
  if (ctx.scheme) { device.open(`${ctx.scheme}://`); await wait() }
  const meta = {}, history = [], visits = new Map(), tried = new Map()
  let start = null
  for (let i = 0; ; i++) {
    const els = device.elements()
    start ??= words(els)
    const sig = els.map((e) => e.text).sort().join('\n')
    visits.set(sig, (visits.get(sig) ?? 0) + 1)
    const actions = candidates(els, ctx).filter((a) => !tried.get(sig)?.has(a.key))
    const d = await decide(ctx, target, els, history, actions)
    if (d.arrived >= ARRIVED && (!marks.size || containment(marks, words(els)) > 0)) return { ok: true, steps, meta, history, els, start }
    if (i >= ctx.maxSteps) return { ok: false, why: `step budget (${ctx.maxSteps}) spent` }
    if (visits.get(sig) > MAX_VISITS) return { ok: false, why: 'came back to the same screen without progress' }
    if (!d.pick) return { ok: false, why: 'jev saw no action leading toward the target' }
    if (d.confidence < ctx.minConfidence) return { ok: false, why: `jev confidence ${d.confidence.toFixed(2)} below ${ctx.minConfidence}` }
    tried.set(sig, (tried.get(sig) ?? new Set()).add(d.pick.key))
    const typed = d.pick.kind === 'type'
      ? (await ctx.text({ field: d.pick.el.text, target: target.title, screen: els.map((e) => e.text) })).split('\n')[0].trim().slice(0, 80)
      : null
    meta[steps.length] = { target: d.pick.el?.text ?? d.pick.label }
    steps.push(...perform(device, d.pick, typed), { wait: config.waits.transition })
    history.push(typed === null ? d.pick.label : `${d.pick.label}: "${typed}"`)
    await wait()
  }
}

function landmarksOn(els, start) {
  const shown = els.filter((e) => VISIBLE.test(e.role))
  const all = [...words(shown.length ? shown : els)].filter((w) => w.length >= 4)
  const fresh = all.filter((w) => !start.has(w))
  return (fresh.length >= 2 ? fresh : all).slice(0, 5)
}

function record(s, r, ctx) {
  const name = `nav-${s.slug}`, shot = `${s.slug}.png`, title = `Navigate to ${s.title ?? s.id}`
  ctx.device.screenshot(path.join(ctx.outScreensDir, shot))
  const navigating = Object.keys(r.meta).map(Number)
  if (navigating.length) r.meta[Math.max(...navigating)].screen = s.id
  const last = r.steps.length - 1
  r.meta[last] = { ...r.meta[last], capture: shot }
  fs.writeFileSync(path.join(ctx.outFlowsDir, `${name}.yaml`), `# ${title}\n${YAML.stringify({ steps: r.steps })}`)
  writeJson(path.join(ctx.outFlowsDir, `${name}.meta.json`), {
    formatVersion: 2, name, title, route: s.id, device: ctx.deviceName, recordedAt: new Date().toISOString(),
    steps: r.meta,
    landmarks: s.landmarks?.length ? s.landmarks : landmarksOn(r.els, r.start),
    result: r.history.length ? `Reached by jev: ${r.history.join(' → ')}` : 'Shown at launch',
  })
  return name
}

export async function runJev({ screens, config, apiKey, session, scheme, bundleId, platform, deviceName, outScreensDir, outFlowsDir, summaryPath, deps = {} }) {
  const textKey = process.env.ANTHROPIC_API_KEY || process.env.AGENT_TEXT_API_KEY
  const text = deps.text ?? (textKey ? anthropicText({ apiKey: textKey, model: config.agent.textModel ?? TEXT_MODEL }) : null)
  const ctx = {
    jev: deps.jev ?? new TypeSafeClient({ apiKey }),
    text, canType: !!text,
    device: deps.device ?? sessionDevice(session, path.join(path.dirname(summaryPath), 'jev-read.png')),
    model: config.agent.model,
    maxSteps: config.agent.maxSteps ?? MAX_STEPS,
    minConfidence: config.agent.minConfidence ?? MIN_CONFIDENCE,
    config, scheme, appId: bundleId, platform, deviceName, outScreensDir, outFlowsDir,
  }
  ensureDir(outScreensDir); ensureDir(outFlowsDir)
  const summary = { captured: [], skipped: [], flows: [] }
  for (const s of screens) {
    try {
      const r = await reach(s, ctx)
      if (r.ok) {
        summary.flows.push(record(s, r, ctx))
        summary.captured.push(s.id)
        log(`jev: reached ${s.id} in ${r.history.length} step(s)`)
      } else {
        summary.skipped.push({ id: s.id, why: r.why })
        log(`jev: ${s.id} not reached — ${r.why}`)
      }
    } catch (e) {
      summary.skipped.push({ id: s.id, why: e.message })
      log(`jev: ${s.id} failed — ${e.message}`)
    }
  }
  writeJson(summaryPath, summary)
  return summary
}
