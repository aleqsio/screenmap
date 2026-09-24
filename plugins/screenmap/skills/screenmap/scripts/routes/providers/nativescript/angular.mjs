// nativescript (angular) — Angular Router `Routes` arrays, the shape
// page-router-outlet navigates.

import path from 'node:path'
import { extractHints } from '../../lib/hints.mjs'
import { closeOf, inner, splitTop, objectEntries, buildConstantMap, constValue } from '../../lib/literals.mjs'
import { IMPORT_FANOUT_CAP, importMap, locateExport, nsHints } from './common.mjs'

export const CODE_EXT = /\.(ts|js|mjs)$/

// A literal, template literal or constant reference as a string. `unresolved`
// decides what an expression nobody can evaluate becomes: route declarations
// keep it verbatim, navigation targets turn it into a wildcard segment.
function stringValue(raw, consts, unresolved = (e) => '${' + e + '}') {
  if (raw == null) return null
  raw = raw.trim()
  const lit = raw.match(/^(["'])([\s\S]*)\1$/)
  if (lit) return lit[2]
  if (raw.startsWith('`') && raw.endsWith('`')) {
    let out = '', i = 1
    while (i < raw.length - 1) {
      if (raw[i] === '\\') { out += raw[i + 1]; i += 2; continue }
      if (raw[i] === '$' && raw[i + 1] === '{') {
        const end = closeOf(raw, i + 1)
        const expr = raw.slice(i + 2, end - 1).trim()
        out += constValue(expr, consts) ?? stringValue(expr, consts, unresolved) ?? unresolved(expr)
        i = end
        continue
      }
      out += raw[i++]
    }
    return out
  }
  return constValue(raw, consts)
}

// () => import('./x').then(m => m.Name)  →  { spec, name }
function lazyImport(raw) {
  const m = (raw ?? '').match(/import\(\s*(["'])([^"']+)\1\s*\)(?:\s*\.then\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\3\.([A-Za-z_$][\w$]*)\s*\))?/)
  return m ? { spec: m[2], name: m[4] ?? 'default' } : null
}

// A component's template: templateUrl, else the sibling .html Angular's CLI
// names after the file. Inline `template:` strings are already in the source.
function templateOf(ctx, absTs) {
  const src = ctx.readFileOrNull(absTs)
  if (!src) return null
  const url = src.match(/\btemplateUrl\s*:\s*["'`]([^"'`]+)["'`]/)?.[1]
  const candidates = [url && path.resolve(path.dirname(absTs), url), absTs.replace(/\.[jt]s$/, '.html')].filter(Boolean)
  for (const c of candidates) { const t = ctx.readFileOrNull(c); if (t) return t }
  return null
}

const joinPath = (prefix, seg) => [prefix, seg].filter((s) => s != null && s !== '').join('/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '')

// ---------- the Routes tree ----------

function readRoutesArray(ctx, state, absFile, exportName) {
  const src = ctx.readFileOrNull(absFile)
  if (!src) return null
  let open = -1
  if (exportName === 'default') {
    const m = src.match(/export\s+default\s*\[/)
    if (m) open = m.index + m[0].length - 1
  } else {
    const m = src.match(new RegExp(`\\b(?:export\\s+)?const\\s+${ctx.escapeRe(exportName)}\\s*(?::\\s*[A-Za-z_$][\\w$<>\\[\\]., ]*)?=\\s*\\[`))
    if (m) open = m.index + m[0].length - 1
  }
  if (open >= 0) return { src, body: src.slice(open + 1, closeOf(src, open) - 1) }
  // An NgModule: RouterModule.forChild(routes) / forRoot(routes) names the array.
  const ref = src.match(/\.for(?:Child|Root)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/)?.[1]
  if (ref && ref !== exportName) {
    const local = readRoutesArray(ctx, state, absFile, ref)
    if (local) return local
    const imp = importMap(ctx, src, absFile)[ref]
    if (imp) return readRoutesArray(ctx, state, locateExport(ctx, imp.file, imp.name) ?? imp.file, imp.name)
  }
  return null
}

function parseRoutesFile(ctx, state, absFile, exportName, prefix, layout) {
  const key = `${absFile}#${exportName}#${prefix}`
  if (!absFile || state.visited.has(key)) return
  state.visited.add(key)
  const found = readRoutesArray(ctx, state, absFile, exportName)
  if (!found) { state.unread.push(`${ctx.rel(absFile)} (${exportName})`); return }
  parseRoutesArray(ctx, state, absFile, found.src, found.body, prefix, layout)
}

function parseRoutesArray(ctx, state, absFile, src, body, prefix, layout) {
  const imports = importMap(ctx, src, absFile)
  for (const el of splitTop(body)) {
    if (el.startsWith('{')) { parseRoute(ctx, state, absFile, src, imports, el, prefix, layout); continue }
    const ident = el.replace(/^\.\.\./, '').trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(ident)) continue
    const local = readRoutesArray(ctx, state, absFile, ident)
    if (local) parseRoutesArray(ctx, state, absFile, src, local.body, prefix, layout)
    else if (imports[ident]) parseRoutesFile(ctx, state, locateExport(ctx, imports[ident].file, imports[ident].name) ?? imports[ident].file, imports[ident].name, prefix, layout)
  }
}

function componentFile(ctx, imports, entries, fromFile) {
  const ident = entries.component?.match(/^([A-Za-z_$][\w$]*)$/)?.[1]
  if (ident && imports[ident]) return locateExport(ctx, imports[ident].file, imports[ident].name) ?? imports[ident].file
  const lazy = lazyImport(entries.loadComponent)
  if (lazy) {
    const file = ctx.resolveImport(lazy.spec, fromFile)
    return file ? locateExport(ctx, file, lazy.name) ?? file : null
  }
  return null
}

function parseRoute(ctx, state, absFile, src, imports, lit, prefix, layout) {
  const entries = {}
  for (const e of objectEntries(inner(lit))) entries[e.key] ??= e.value
  const { consts } = state
  const seg = entries.path === undefined ? '' : stringValue(entries.path, consts) ?? entries.path
  const full = joinPath(prefix, seg)
  const outlet = stringValue(entries.outlet, consts)

  if (entries.redirectTo !== undefined) {
    const target = stringValue(entries.redirectTo, consts)
    if (target != null) state.redirects.push({ from: full, to: target.startsWith('/') ? target.replace(/^\/+/, '') : joinPath(prefix, target) })
    return
  }

  const file = componentFile(ctx, imports, entries, absFile)
  const isContainer = entries.children !== undefined || entries.loadChildren !== undefined
  if (isContainer) {
    // A route with children is a mount point, not a screen: its component is
    // the shell around a <page-router-outlet>. expo-router models the same
    // thing as _layout, react-navigation as a nested navigator — so it becomes
    // a layout here, and links aimed at it resolve to the child that renders.
    // A wrapper with no component of its own (the `''` route a lazy module
    // starts with) only extends the prefix.
    let scope = layout
    if (file) {
      scope = { file: ctx.rel(file), dir: full, navigator: null, _abs: file }
      state.layouts.push(scope)
    }
    state.containers.set(full, scope)
    if (entries.children !== undefined) {
      if (entries.children.startsWith('[')) parseRoutesArray(ctx, state, absFile, src, inner(entries.children), full, scope)
      else parseRoutesArray(ctx, state, absFile, src, entries.children, full, scope)
    }
    const lazy = lazyImport(entries.loadChildren)
    if (lazy) parseRoutesFile(ctx, state, ctx.resolveImport(lazy.spec, absFile), lazy.name, full, scope)
    return
  }
  if (entries.component === undefined && entries.loadComponent === undefined) return

  state.routes.push({
    path: full,
    outlet,
    file: file ? ctx.rel(file) : ctx.rel(absFile),
    _abs: file,
    routesFile: ctx.rel(absFile),
    layout,
  })
}

// Where the app hands its routes to the router. Standalone bootstrap
// (provideNativeScriptRouter / provideRouter) and NgModule bootstrap
// (NativeScriptRouterModule.forRoot / RouterModule.forRoot) both name the
// array; fall back to the conventional file names when neither is found.
function findRootRoutes(ctx, files) {
  const ROOT_RE = /\b(?:provideNativeScriptRouter|provideRouter|NativeScriptRouterModule\.forRoot|RouterModule\.forRoot)\(\s*(\[|[A-Za-z_$][\w$]*)/
  for (const f of files) {
    const src = ctx.readFileOrNull(f)
    const m = src?.match(ROOT_RE)
    if (!m) continue
    if (m[1] === '[') {
      const open = m.index + m[0].length - 1
      return { file: f, src, body: src.slice(open + 1, closeOf(src, open) - 1), name: null }
    }
    const local = src.match(new RegExp(`\\bconst\\s+${m[1]}\\s*(?::[^=]*)?=\\s*\\[`))
    if (local) return { file: f, name: m[1] }
    const imp = importMap(ctx, src, f)[m[1]]
    if (imp) return { file: locateExport(ctx, imp.file, imp.name) ?? imp.file, name: imp.name }
  }
  for (const f of files) {
    if (!/(^|\/)(app\.routes|app-routing\.module|app\.routing|routes)\.[jt]s$/.test(f)) continue
    const src = ctx.readFileOrNull(f) ?? ''
    const m = src.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*:\s*Routes\s*=\s*\[/)
    if (m) return { file: f, name: m[1] }
  }
  return null
}

// ---------- navigation targets ----------

// Angular URL → plain paths: /talk/(todayTab:today//side:menu) → talk/today, talk/menu.
// Matrix params (;id=1), queries and fragments drop out.
function urlToPaths(url) {
  let u = url.split(/[?#]/)[0].replace(/;[^/()]*/g, '')
  const out = []
  const OUTLET = /\(([^()]*)\)/
  let m
  while ((m = OUTLET.exec(u))) {
    const base = u.slice(0, m.index)
    for (const part of m[1].split('//')) {
      const [, p] = part.match(/^(?:[A-Za-z_$][\w$]*:)?(.*)$/)
      out.push(joinPath(base, p))
    }
    u = base
  }
  out.unshift(joinPath('', u))
  return [...new Set(out.map((p) => p.replace(/\/{2,}/g, '/')))].filter(Boolean)
}

// ['/talk', { outlets: { todayTab: ['today'] } }]  →  ['talk/today']
function commandsToPaths(raw, consts) {
  const wild = () => 'X'
  const segOf = (s) => stringValue(s, consts, wild) ?? wild()
  let base = ''
  const outlets = []
  for (const it of splitTop(inner(raw))) {
    if (it.startsWith('{')) {
      const o = objectEntries(inner(it)).find((e) => e.key === 'outlets')
      if (o?.value.startsWith('{'))
        for (const oe of objectEntries(inner(o.value))) {
          const segs = oe.value.startsWith('[') ? splitTop(inner(oe.value)).map(segOf) : [segOf(oe.value)]
          outlets.push(segs.join('/'))
        }
      continue
    }
    base = joinPath(base, segOf(it))
  }
  const abs = raw.match(/^\[\s*["'`]\//) != null
  const paths = outlets.length ? outlets.map((o) => joinPath(base, o)) : [base]
  return { abs, paths }
}

// Angular resolves a relative command against `relativeTo`: the route's own
// URL for `this.route`, the container's for `this.route.parent`, the root when
// it is absent. Recorded here so the edge pass can try the right base first.
function relativeBase(extras) {
  if (!extras || !/\brelativeTo\b/.test(extras)) return null
  return /\.parent\b/.test(extras) ? 'parent' : 'self'
}

function collectNavTargets(src, consts) {
  const out = [] // { raw, abs, rel, paths, literal }
  for (const m of src.matchAll(/\.(?:navigate|navigateByUrl)\(/g)) {
    const open = m.index + m[0].length - 1
    const args = src.slice(open + 1, closeOf(src, open) - 1)
    const [first, extras] = splitTop(args)
    if (!first) continue
    const raw = first.replace(/\s+/g, ' ').slice(0, 100)
    const rel = relativeBase(extras)
    if (first.startsWith('[')) {
      const { abs, paths } = commandsToPaths(first, consts)
      out.push({ raw, abs, rel, paths, literal: !/\$\{|X(?:\/|$)/.test(paths.join('|')) })
    } else {
      const s = stringValue(first, consts, () => 'X')
      if (s == null) continue
      out.push({ raw, abs: s.startsWith('/'), rel, paths: urlToPaths(s), literal: !/\$\{/.test(first) })
    }
  }
  // <Button nsRouterLink="/x">, [nsRouterLink]="['/x', { outlets: … }]", routerLink too
  for (const m of src.matchAll(/(\[)?(?:ns)?[rR]outerLink\]?\s*=\s*"([^"]*)"/g)) {
    const v = m[2].trim()
    if (!v) continue
    if (m[1]) {
      if (v.startsWith('[')) { const { abs, paths } = commandsToPaths(v, consts); out.push({ raw: v, abs, paths, literal: !/X(?:\/|$)/.test(paths.join('|')) }) }
      else { const s = stringValue(v, consts, () => 'X'); if (s != null) out.push({ raw: v, abs: s.startsWith('/'), paths: urlToPaths(s), literal: true }) }
    } else out.push({ raw: v, abs: v.startsWith('/'), paths: urlToPaths(v), literal: true })
  }
  return out
}

// ---------- parse ----------

export function parseAngular(ctx, files, ns) {
  const codeFiles = files.filter((f) => CODE_EXT.test(f))
  const root = findRootRoutes(ctx, codeFiles)
  if (!root) {
    throw new Error(
      'nativescript (angular): no Routes array found. Expected provideNativeScriptRouter(routes), ' +
      'NativeScriptRouterModule.forRoot(routes) or an app.routes.ts declaring `const routes: Routes = […]`. ' +
      'If routes are built dynamically, use a custom provider ({"routes":{"provider":"custom","command":"…"}}).'
    )
  }
  const state = {
    consts: buildConstantMap(ctx, codeFiles),
    routes: [], layouts: [], containers: new Map(), redirects: [], visited: new Set(), unread: [],
  }
  const rootLayout = { file: ctx.rel(root.file), dir: '', navigator: 'Stack', _abs: null }
  state.layouts.push(rootLayout)
  if (root.body != null) parseRoutesArray(ctx, state, root.file, root.src, root.body, '', rootLayout)
  else parseRoutesFile(ctx, state, root.file, root.name, '', rootLayout)

  if (!state.routes.length) {
    throw new Error(`nativescript (angular): ${ctx.rel(root.file)} declares no route with a component`)
  }

  // A container whose children live in two or more named outlets is a tab bar
  // (one outlet per tab); otherwise the shell's own template decides.
  for (const l of state.layouts) {
    if (l.navigator) continue
    const outlets = new Set(state.routes.filter((r) => r.layout === l && r.outlet).map((r) => r.outlet))
    const tpl = l._abs ? templateOf(ctx, l._abs) ?? '' : ''
    l.navigator = outlets.size >= 2 || /<(?:TabView|Tabs|BottomNavigation|MDBottomNavigation|TabStrip)\b/.test(tpl) ? 'Tabs' : 'Stack'
  }

  // Identity: the full path, disambiguated by outlet only when two children of
  // one container share a path. Title: the URL Angular itself prints, outlet
  // notation included, which is also what navigateByUrl accepts.
  const seenIds = new Set()
  const routes = state.routes.map((r) => {
    let id = r.path === '' ? 'index' : r.path === '**' ? '**' : r.path
    if (seenIds.has(id) && r.outlet) id = `${id}@${r.outlet}`
    while (seenIds.has(id)) id += '_'
    seenIds.add(id)
    const title = r.path === '' ? '/' : r.outlet
      ? `/${joinPath(r.layout.dir, `(${r.outlet}:${r.path.slice(r.layout.dir ? r.layout.dir.length + 1 : 0)})`)}`
      : `/${r.path}`
    const componentSrc = r._abs ? ctx.readFileOrNull(r._abs) ?? '' : ''
    const tpl = r._abs ? templateOf(ctx, r._abs) ?? '' : ''
    const own = componentSrc + '\n' + tpl
    return {
      id,
      file: r.file,
      urlPath: r.path === '' ? '/' : null,
      title,
      slug: id === '**' ? 'wildcard' : id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, ''),
      params: r.path.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1).replace(/\?$/, '')),
      navigator: r.layout.navigator,
      layoutDir: r.layout.dir,
      presentation: null,
      stateHints: [...extractHints(own), ...nsHints(own)],
      _path: r.path, _outlet: r.outlet, _abs: r._abs, _own: own,
    }
  })

  // ---------- resolution: a path someone navigates to → the route that renders ----------

  const byPath = new Map()
  for (const r of routes) if (!byPath.has(r._path)) byPath.set(r._path, r)
  const matchers = routes.filter((r) => /(^|\/):/.test(r._path)).map((r) => ({ route: r, re: ctx.routeMatcher('/' + r._path) }))
  const redirects = state.redirects.map((x) => ({ ...x, re: /:/.test(x.from) ? ctx.routeMatcher('/' + x.from) : null }))
  const firstChild = (dir) => routes.find((r) => r.layoutDir === dir) ?? null

  function resolvePath(p, hops = 0) {
    if (hops > 6) return null
    p = p.replace(/^\/+|\/+$/g, '')
    if (byPath.has(p)) return byPath.get(p)
    const hit = matchers.find((m) => m.re.test('/' + p))
    if (hit) return hit.route
    // a redirect declared at this path (a container's `'' → child` default, or
    // an alias route) says where the router actually lands
    const rd = redirects.find((x) => x.from === p || (x.re && x.re.test('/' + p)))
    if (rd) return resolvePath(rd.to, hops + 1)
    if (state.containers.has(p)) return firstChild(p)
    return null
  }

  // Whatever the empty path resolves to is the screen a launch shows, so it is
  // reachable without any link — the same `/` expo-router gives index.
  if (!routes.some((r) => r.urlPath === '/')) {
    const landing = resolvePath('')
    if (landing && landing.urlPath == null) landing.urlPath = '/'
  }

  // ---------- edges ----------

  // Links live in the screen, its template, and the components it imports one
  // hop out; a service or header imported by most screens would attribute its
  // navigation to every one of them, so files over the fanout cap are skipped.
  const importsOf = new Map()
  const fanout = new Map()
  for (const r of routes) {
    if (!r._abs) continue
    const own = ctx.firstPartyImports(ctx.readFileOrNull(r._abs) ?? '', r.file)
    importsOf.set(r.id, own)
    for (const f of new Set(own)) fanout.set(f, (fanout.get(f) ?? 0) + 1)
  }

  const edges = []
  for (const r of routes) {
    const sources = [r._own]
    for (const f of importsOf.get(r.id) ?? []) {
      if ((fanout.get(f) ?? 0) > IMPORT_FANOUT_CAP) continue
      const abs = path.join(ctx.projectRoot, f)
      const s = ctx.readFileOrNull(abs)
      if (!s) continue
      sources.push(s)
      if (/\.component\.[jt]s$/.test(f)) { const t = templateOf(ctx, abs); if (t) sources.push(t) }
    }
    const seen = new Set()
    for (const s of sources) {
      for (const nav of collectNavTargets(s, state.consts)) {
        for (const p of nav.paths) {
          const candidates = nav.abs ? [p]
            : nav.rel === 'parent' ? [joinPath(r.layoutDir, p), p]
            : nav.rel === 'self' ? [joinPath(r._path, p), joinPath(r.layoutDir, p), p]
            : [p, joinPath(r.layoutDir, p)]
          let target = null
          for (const c of candidates) { target = resolvePath(c); if (target) break }
          if (target) {
            if (seen.has(target.id)) continue
            seen.add(target.id)
            edges.push({ from: r.id, to: target.id, raw: nav.raw, target: '/' + target._path })
          } else if (nav.abs && nav.literal && !seen.has('/' + p)) {
            seen.add('/' + p)
            edges.push({ from: r.id, to: null, raw: nav.raw, target: '/' + p })
          }
        }
      }
    }
  }

  const screensResolved = routes.filter((r) => r._abs).length
  for (const r of routes) { delete r._path; delete r._outlet; delete r._abs; delete r._own }
  const layouts = state.layouts.map(({ _abs, ...l }) => l)
  return {
    flavor: 'angular',
    appPath: ns.appPath,
    routesFile: ctx.rel(root.file),
    screensResolved,
    ...(state.unread.length ? { unreadRouteModules: state.unread } : {}),
    layouts, routes, edges,
  }
}
