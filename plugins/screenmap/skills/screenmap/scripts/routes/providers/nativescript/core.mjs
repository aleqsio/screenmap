// nativescript (core) — XML <Page> files and the Frame.navigate() calls
// between them.

import path from 'node:path'
import { importedLinkSources } from '../../lib/link-sources.mjs'
import { findEntry } from './common.mjs'

const moduleOf = (s) => s.replace(/^~\/|^\.\/|^\//, '').replace(/\.(xml|ts|js)$/, '')

export function parseCore(ctx, files, ns) {
  const appDir = path.join(ctx.projectRoot, ns.appPath)
  const pages = files.filter((f) => f.endsWith('.xml')).filter((f) => /<Page\b/.test((ctx.readFileOrNull(f) ?? '').slice(0, 4096)))
  if (!pages.length) throw new Error(`nativescript (core): no <Page> XML under ${ns.appPath}/`)
  const entryFile = findEntry(ctx, ns)
  const entrySrc = entryFile ? ctx.readFileOrNull(entryFile) : ''
  const rootModule = entrySrc.match(/\.run\(\s*\{[^}]*\bmoduleName\s*:\s*["'`]([^"'`]+)["'`]/)?.[1]
    ?? entrySrc.match(/\.(?:run|start)\(\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null
  const layout = { file: ctx.rel(entryFile ?? pages[0]), dir: '', navigator: 'Stack' }

  const routes = pages.map((xml) => {
    const id = moduleOf(path.relative(appDir, xml).split(path.sep).join('/'))
    const code = ['.ts', '.js'].map((e) => xml.replace(/\.xml$/, e)).find((f) => ctx.readFileOrNull(f)) ?? null
    return {
      id, file: ctx.rel(code ?? xml),
      urlPath: rootModule && moduleOf(rootModule) === id ? '/' : null,
      title: id,
      slug: id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, ''),
      params: [], navigator: 'Stack', layoutDir: '', presentation: null, stateHints: [],
      _code: code, _xml: xml,
    }
  })
  const byId = new Map(routes.map((r) => [r.id, r]))

  const NAV_RE = /\b(navigate|showModal)\(\s*(?:\{[\s\S]*?\bmoduleName\s*:\s*(["'])([^"']+)\2|(["'])([^"']+)\4)/g
  const edges = []
  const modalOnly = new Set()
  const imported = importedLinkSources(ctx, routes.filter((r) => r._code), (r) => ctx.readFileOrNull(r._code) ?? '')
  for (const r of routes) {
    const sources = [r._code ? ctx.readFileOrNull(r._code) ?? '' : '', ...(imported.get(r) ?? []).map((m) => m.src)]
    const seen = new Set()
    for (const s of sources) for (const m of s.matchAll(NAV_RE)) {
      const target = byId.get(moduleOf(m[3] ?? m[5]))
      if (!target) continue
      if (m[1] === 'showModal') {
        if (!r.stateHints.some((h) => h.type === 'ns-modal' && h.module === target.id)) r.stateHints.push({ type: 'ns-modal', module: target.id })
        modalOnly.add(target.id)
        continue
      }
      if (seen.has(target.id)) continue
      seen.add(target.id)
      edges.push({ from: r.id, to: target.id, raw: m[0].replace(/\s+/g, ' ').slice(0, 100), target: target.id })
    }
  }
  for (const id of modalOnly) if (!edges.some((e) => e.to === id)) {
    const r = byId.get(id)
    r.presentation = 'modal'
    r.stateHints.push({ type: 'router-modal', presentation: 'modal' })
  }
  for (const r of routes) { delete r._code; delete r._xml }
  return { flavor: 'core', appPath: ns.appPath, entryFile: entryFile ? ctx.rel(entryFile) : null, layouts: [layout], routes, edges }
}
