// nativescript — NativeScript apps, whichever framework drives the views.
//
//   angular   Angular Router `Routes` arrays, the shape page-router-outlet navigates
//   core      XML <Page> files and the Frame.navigate() calls between them
//   octane, react, vue, svelte, solid
//             component-driven: a screen is a component the framework mounts
//             as a root, pushes, presents as a modal, hosts in a <frame> tab,
//             or (solid-navigation) registers in a <Route> table
//
// No flavor has a linking config. A NativeScript app registers a URL
// scheme in App_Resources and maps URLs onto navigation in its own code, so
// nothing static says which screens a deep link reaches. Every route therefore
// starts navigation-only, and .screenmap/config.json's routes.links names the
// ones the app's own handler opens:
//
//   { "routes": { "links": { "talk/today": "today", "profile": true, "*": false } } }
//
// A string is the path after the scheme; `true` means the route's own URL is
// the deep link; "*" is the default for routes not listed.

import path from 'node:path'
import { extractHints } from '../lib/hints.mjs'

export const meta = {
  id: 'nativescript',
  title: 'NativeScript',
  reach: 'mixed',
}

// No Expo Go for a NativeScript app: the only way in is the scheme the app
// itself registers.
export function deepLinkTemplates(scheme) {
  return { devBuild: scheme ? `${scheme}://<urlPath minus leading slash>` : null }
}

const CODE_EXT = /\.(ts|js|mjs)$/
const SKIP_FILE = /\.(spec|test|mock|stub|d)\.[jt]sx?$|(^|\/)(mocks?|__mocks__|__tests__|tests?|e2e)\//
const IMPORT_FANOUT_CAP = 8

// The dependency that names each framework flavor. Angular first: an Angular
// app can carry a stray UI dependency, but nothing else carries @nativescript/angular.
const FLAVOR_DEPS = [
  ['@nativescript/angular', 'angular'],
  ['@nativescript-community/octane', 'octane'],
  ['octane', 'octane'],
  ['@nativescript-community/solid-js', 'solid'],
  ['solid-navigation', 'solid'],
  ['dominative', 'solid'],
  ['react-nativescript', 'react'],
  ['nativescript-vue', 'vue'],
  ['@nativescript/vue', 'vue'],
  ['svelte-native', 'svelte'],
]

// Component-driven flavors. Each names the calls that make a component a
// screen: `mount` renders a component as a root (the entry's is the app root;
// one rendered into a view that is then `showModal`ed is a modal), `navigate`
// pushes one, `modal` presents one. Group 1 is always the component name. A
// flavor with a router adds `routeTag` (the registration element), the
// `routeName` / `routeComponent` attributes read off that tag, `initialRoute`,
// and `navigateByName` (group 1 is a route name, not a component).
//
// Every flavor also gets the framework-neutral rules below the table: a
// component that is the sole child of a <frame> is a screen hosted by the
// component around it (tabs when that host is a tab view), and a <drawer> or a
// native menu prop is a runtime state of the screen it sits in.
const COMPONENT_FLAVORS = {
  octane: {
    ext: /\.(tsx|jsx|ts|js|mjs)$/,
    mount: [/\brenderNativeScriptApp\(\s*[^,()]+,\s*([A-Z][\w$]*)/g],
    navigate: [],
    modal: [],
  },
  react: {
    ext: /\.(tsx|jsx|ts|js|mjs)$/,
    mount: [
      /\bReactNativeScript\.start\(\s*(?:React\.createElement\(\s*|<\s*)([A-Z][\w$]*)/g,
      /\bReactNativeScript\.start\(\s*\(\)\s*=>\s*<\s*([A-Z][\w$]*)/g,
    ],
    navigate: [],
    modal: [],
  },
  vue: {
    ext: /\.(vue|ts|js|mjs)$/,
    mount: [
      /\bcreateApp\(\s*([A-Z][\w$]*)/g,
      /\brender\s*:\s*\(?\s*h\s*\)?\s*=>\s*h\(\s*(?:["'`]frame["'`]\s*,\s*\[\s*h\(\s*)?([A-Z][\w$]*)/g,
    ],
    navigate: [/\$navigateTo\(\s*([A-Z][\w$]*)/g],
    modal: [/\$showModal\(\s*([A-Z][\w$]*)/g],
  },
  svelte: {
    ext: /\.(svelte|ts|js|mjs)$/,
    mount: [/\bsvelteNative(?:NoFrame)?\(\s*([A-Z][\w$]*)/g],
    navigate: [/\bnavigate\(\s*\{[^}]*?\bpage\s*:\s*([A-Z][\w$]*)/g],
    modal: [/\bshowModal\(\s*\{[^}]*?\bpage\s*:\s*([A-Z][\w$]*)/g],
  },
  solid: {
    ext: /\.(tsx|jsx|ts|js|mjs)$/,
    mount: [
      /\bstartSolidApp\(\s*\{[^}]*?\broot\s*:\s*([A-Z][\w$]*)/g,
      /\brender\(\s*\(\)\s*=>\s*<\s*([A-Z][\w$]*)/g,
    ],
    navigate: [],
    modal: [],
    routeTag: /<Route\b[^>]*>/g,
    routeName: /\bname\s*=\s*["']([^"']+)["']/,
    routeComponent: /\bcomponent\s*=\s*\{\s*([A-Z][\w$]*)\s*\}/,
    initialRoute: /\binitialRouteName\s*=\s*["']([^"']+)["']/,
    navigateByName: [/\.(?:navigate|push|replace)\(\s*["'`]([^"'`]+)["'`]/g],
  },
}

const FRAME_CHILD_RE = /<[Ff]rame\b[^>]*>\s*<([A-Z][\w$]*)\b/g
const TABS_HOST_RE = /<(?:tabview|TabView|bottomnavigation|BottomNavigation|tabs|Tabs|TabStrip)\b/

// ---------- tolerant JS literal reading ----------
//
// Route files are object literals full of arrow functions, template literals
// and comments, so every block reader here skips strings, templates (with
// nested ${…}) and comments rather than counting braces naively.

function skipString(src, i) {
  const q = src[i++]
  while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
  return i + 1
}

function skipTemplate(src, i) {
  i++
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === '$' && src[i + 1] === '{') { i = closeOf(src, i + 1); continue }
    i++
  }
  return i + 1
}

// Index just past the closer matching the opener at `open`.
function closeOf(src, open) {
  const pairs = { '[': ']', '{': '}', '(': ')' }
  const stack = [pairs[src[open]]]
  let i = open + 1
  while (i < src.length && stack.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return src.length; i += 2; continue }
    if (c === '"' || c === "'") { i = skipString(src, i); continue }
    if (c === '`') { i = skipTemplate(src, i); continue }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === stack[stack.length - 1]) stack.pop()
    i++
  }
  return i
}

function stripComments(src) {
  let out = '', i = 0
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e; continue }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue }
    if (c === '"' || c === "'") { const e = skipString(src, i); out += src.slice(i, e); i = e; continue }
    if (c === '`') { const e = skipTemplate(src, i); out += src.slice(i, e); i = e; continue }
    out += c; i++
  }
  return out
}

// The inside of a bracketed literal: `[a, b]` → `a, b`.
const inner = (lit) => {
  const t = lit.trim()
  return t.slice(1, closeOf(t, 0) - 1)
}

// Top-level comma split of an array or object body.
function splitTop(body) {
  const out = []
  let depth = 0, start = 0, i = 0
  while (i < body.length) {
    const c = body[i], n = body[i + 1]
    if (c === '/' && n === '/') { i = body.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && n === '*') { i = body.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue }
    if (c === '"' || c === "'") { i = skipString(body, i); continue }
    if (c === '`') { i = skipTemplate(body, i); continue }
    if ('[{('.includes(c)) depth++
    else if (']})'.includes(c)) depth--
    else if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1 }
    i++
  }
  out.push(body.slice(start))
  return out.map((s) => stripComments(s).trim()).filter(Boolean)
}

// { key: value, 'k': v, ...spread, short } → [{ key, value }], top level only.
function objectEntries(body) {
  return splitTop(body).map((part) => {
    if (part.startsWith('...')) return { key: '...', value: part.slice(3).trim() }
    const m = part.match(/^(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])\s*:\s*([\s\S]*)$/)
    if (m) return { key: m[1] ?? m[2], value: m[3].trim() }
    const short = part.match(/^([A-Za-z_$][\w$]*)$/)
    return short ? { key: short[1], value: short[1] } : null
  }).filter(Boolean)
}

// ---------- constants: path: ROUTES.HOME / path: Screens.Q1 / `${Prefix}/x` ----------

function buildConstantMap(ctx, files) {
  const scalars = {}
  const objects = {}
  const SCALAR_RE = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(["'])([^"'\n]*)\2/g
  const BLOCK_RE = /\b(?:export\s+)?(?:declare\s+)?(?:(const)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*\{|(?:const\s+)?(enum)\s+([A-Za-z_$][\w$]*)\s*\{)/g
  const MEMBER_RE = /(?:^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(["'`])([^"'`]*)\2/g
  for (const f of files) {
    const src = ctx.readFileOrNull(f)
    if (!src) continue
    for (const m of src.matchAll(SCALAR_RE)) scalars[m[1]] ??= m[3]
    for (const m of src.matchAll(BLOCK_RE)) {
      const name = m[2] ?? m[4]
      const open = m.index + m[0].length - 1
      const body = src.slice(open + 1, closeOf(src, open) - 1)
      const members = {}
      for (const mm of body.matchAll(MEMBER_RE)) members[mm[1]] = mm[3]
      if (Object.keys(members).length) objects[name] ??= members
    }
  }
  return { scalars, objects }
}

function constValue(expr, consts) {
  const member = expr.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
  if (member) return consts.objects[member[1]]?.[member[2]] ?? null
  const ident = expr.match(/^([A-Za-z_$][\w$]*)$/)
  if (ident) return consts.scalars[ident[1]] ?? null
  return null
}

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

// ---------- imports and exports ----------

// identifier → { file, name } for one module's imports
function importMap(ctx, src, fromFile) {
  const map = {}
  const RE = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g
  for (const m of src.matchAll(RE)) {
    const file = ctx.resolveImport(m[3], fromFile)
    if (!file) continue
    if (m[1]) map[m[1]] = { file, name: 'default' }
    for (const part of (m[2] ?? '').split(',')) {
      const pm = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (pm) map[pm[2] ?? pm[1]] = { file, name: pm[1] }
    }
  }
  return map
}

// The file that declares `name`, following barrel re-exports
// (`export * from './x'`, `export { A } from './y'`) — Angular apps route to
// components through index.ts files as often as not.
function locateExport(ctx, absFile, name, depth = 0) {
  if (!absFile || depth > 6) return null
  const src = ctx.readFileOrNull(absFile)
  if (!src) return null
  if (name === 'default') return absFile
  const id = ctx.escapeRe(name)
  if (new RegExp(`\\bexport\\s+(?:default\\s+)?(?:abstract\\s+)?(?:class|const|let|var|function|enum)\\s+${id}\\b`).test(src)) return absFile
  if (new RegExp(`\\bexport\\s*\\{[^}]*\\b${id}\\b[^}]*\\}\\s*(?!from)`).test(src) && !new RegExp(`\\bexport\\s*\\{[^}]*\\b${id}\\b[^}]*\\}\\s*from`).test(src)) return absFile
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const part of m[1].split(',')) {
      const pm = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (pm && (pm[2] ?? pm[1]) === name) {
        const hit = locateExport(ctx, ctx.resolveImport(m[2], absFile), pm[1], depth + 1)
        if (hit) return hit
      }
    }
  }
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
    const hit = locateExport(ctx, ctx.resolveImport(m[1], absFile), name, depth + 1)
    if (hit) return hit
  }
  return null
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

// ---------- Angular flavor: the Routes tree ----------

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

// ---------- Angular flavor: navigation targets ----------

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

// ---------- Angular flavor: hints ----------

// Modals and sheets in NativeScript Angular open components, not routes, so
// the component name is the hint's handle for whoever has to trigger it.
function nsHints(src) {
  const hints = []
  const seen = new Set()
  const add = (h) => { const k = JSON.stringify(h); if (!seen.has(k)) { seen.add(k); hints.push(h) } }
  for (const m of src.matchAll(/\b(?:showModal|openModal|nativeDialog\.open|dialogService\.open|dialog\.open)\(\s*([A-Z][A-Za-z0-9_]*)/g))
    add({ type: 'ns-modal', component: m[1] })
  if (/ui-material-bottomsheet|BottomSheetService/.test(src))
    for (const m of src.matchAll(/\.show\(\s*([A-Z][A-Za-z0-9_]*)/g))
      add({ type: 'bottom-sheet', lib: 'material-bottomsheet', snapPoints: null, component: m[1] })
  return hints
}

// ---------- Angular flavor: parse ----------

function parseAngular(ctx, files, ns) {
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

  applyLinks(routes, ctx.config?.links)

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

// ---------- the routes.links overlay ----------

// A deep link is whatever the app's own URL handler makes of it, so the
// project says which routes have one. Params in the link (`ask-mae/:id`) join
// the route's own so the capture stage substitutes both.
function applyLinks(routes, links) {
  if (!links || typeof links !== 'object') return
  const star = links['*']
  for (const r of routes) {
    let v = links[r.id] ?? links['/' + r.id] ?? links[r.title]
    if (v === undefined) v = star
    if (v === true) r.urlPath = r.title
    else if (typeof v === 'string') r.urlPath = '/' + v.replace(/^\/+/, '')
    else if (v === false || v === null) r.urlPath = r.urlPath === '/' ? '/' : null
    if (r.urlPath) {
      const linkParams = r.urlPath.split(/[?#]/)[0].split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1).replace(/\?$/, ''))
      r.params = [...new Set([...r.params, ...linkParams])]
    }
  }
}

// ---------- Core flavor: XML pages and Frame.navigate ----------

const moduleOf = (s) => s.replace(/^~\/|^\.\/|^\//, '').replace(/\.(xml|ts|js)$/, '')

function parseCore(ctx, files, ns) {
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
  applyLinks(routes, ctx.config?.links)
  const byId = new Map(routes.map((r) => [r.id, r]))

  const NAV_RE = /\b(navigate|showModal)\(\s*(?:\{[\s\S]*?\bmoduleName\s*:\s*(["'])([^"']+)\2|(["'])([^"']+)\4)/g
  const edges = []
  const modalOnly = new Set()
  for (const r of routes) {
    const sources = [r._code ? ctx.readFileOrNull(r._code) ?? '' : '']
    if (r._code) for (const f of ctx.firstPartyImports(sources[0], r.file)) { const s = ctx.readFileOrNull(path.join(ctx.projectRoot, f)); if (s) sources.push(s) }
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

// ---------- component flavors: Octane, React, Vue, Svelte ----------

// The module the runtime evaluates first: package.json `main`, else the
// conventional names under the app directory.
function findEntry(ctx, ns) {
  const main = ctx.packageJson().main
  if (typeof main === 'string') {
    const rel = ctx.resolveToRel(main.replace(/^\.\//, ''))
    if (rel) return path.join(ctx.projectRoot, rel)
  }
  for (const base of ['app', 'index', 'main'])
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
      const f = path.join(ctx.projectRoot, ns.appPath, base + ext)
      if (ctx.readFileOrNull(f)) return f
    }
  return null
}

// Runtime states a component-driven screen can be in that a screenshot of its
// first render cannot show: an open drawer, a native menu.
function componentHints(src) {
  const hints = []
  if (/<(?:drawer|Drawer|RadSideDrawer|SideDrawer)\b/.test(src)) hints.push({ type: 'drawer' })
  if (/\b(?:menu|contextMenu)\s*=\s*[{"']/.test(src)) hints.push({ type: 'native-menu' })
  return hints
}

function parseComponents(ctx, files, ns, flavor) {
  const spec = COMPONENT_FLAVORS[flavor]
  const code = files.filter((f) => spec.ext.test(f))
  const entry = findEntry(ctx, ns)
  const sourceOf = new Map()
  const read = (f) => { if (!sourceOf.has(f)) sourceOf.set(f, ctx.readFileOrNull(f) ?? ''); return sourceOf.get(f) }

  // Every place a component becomes a screen. A mount outside the entry file
  // renders a second root: into a view that is presented (`showModal` in the
  // same module) or pushed.
  const occurrences = [] // { file, name, kind, raw, routeName?, hostTabs? }
  const scan = (src, file, res, kind) => {
    for (const re of res)
      for (const m of src.matchAll(re)) occurrences.push({ file, name: m[1], kind, raw: m[0].replace(/\s+/g, ' ').slice(0, 100) })
  }
  const secondaryKind = (src) => (/\.showModal\(/.test(src) ? 'modal' : 'navigate')
  for (const f of code) {
    const src = read(f)
    if (!src) continue
    scan(src, f, spec.mount, f === entry ? 'root' : secondaryKind(src))
    scan(src, f, spec.navigate, 'navigate')
    scan(src, f, spec.modal, 'modal')
    if (spec.routeTag)
      for (const tag of src.matchAll(spec.routeTag)) {
        const routeName = tag[0].match(spec.routeName)?.[1]
        const name = tag[0].match(spec.routeComponent)?.[1]
        if (routeName && name) occurrences.push({ file: f, name, kind: 'route', routeName, raw: tag[0].replace(/\s+/g, ' ').slice(0, 100) })
      }
    for (const m of src.matchAll(FRAME_CHILD_RE))
      occurrences.push({ file: f, name: m[1], kind: 'frame', raw: m[0].replace(/\s+/g, ' ').slice(0, 100), hostTabs: TABS_HOST_RE.test(src) })
  }
  if (!occurrences.length) {
    throw new Error(
      `nativescript (${flavor}): no component is mounted, pushed, presented or hosted in a <frame> anywhere under ${ns.appPath}/ ` +
      `(looked for ${[...spec.mount, ...spec.navigate, ...spec.modal].map((r) => r.source.split('\\(')[0].replace(/\\\\b|\\\\/g, '')).join(', ')}). ` +
      'If screens are wired another way, use a custom provider ({"routes":{"provider":"custom","command":"…"}}).'
    )
  }

  // The file that defines each component: an import of the file the call sits
  // in, else a declaration in that same file.
  const defs = new Map()
  for (const o of occurrences) {
    if (defs.has(o.name)) continue
    const src = read(o.file)
    const imp = importMap(ctx, src, o.file)[o.name]
    let file = imp ? locateExport(ctx, imp.file, imp.name) ?? imp.file : null
    if (!file && new RegExp(`\\b(?:function|class|const|let|var)\\s+${ctx.escapeRe(o.name)}\\b`).test(src)) file = o.file
    defs.set(o.name, file)
  }
  const componentIn = (file) => [...defs.entries()].find(([, f]) => f === file)?.[0] ?? null
  // <Frame><Page> hosts markup, not a component: a frame child counts only
  // when the file imports or declares it.
  for (let i = occurrences.length - 1; i >= 0; i--)
    if (occurrences[i].kind === 'frame' && !defs.get(occurrences[i].name)) occurrences.splice(i, 1)
  if (!occurrences.length) throw new Error(`nativescript (${flavor}): only core elements are hosted in <frame>s under ${ns.appPath}/ — no component screens found`)

  // A route table names screens after routes; everything else is named after
  // its component. The mounted root whose file declares the table is the
  // router shell: a layout, not a screen, and its initial route is the root.
  const idOf = new Map()
  for (const o of occurrences) if (o.kind === 'route' && !idOf.has(o.name)) idOf.set(o.name, o.routeName)
  for (const o of occurrences) if (!idOf.has(o.name)) idOf.set(o.name, o.name)
  const tableFiles = new Set(occurrences.filter((o) => o.kind === 'route').map((o) => o.file))
  const rootOcc = occurrences.find((o) => o.kind === 'root') ?? occurrences[0]
  const shellName = tableFiles.has(defs.get(rootOcc.name)) ? rootOcc.name : null
  const rootId = shellName
    ? read(defs.get(shellName)).match(spec.initialRoute ?? /$^/)?.[1] ?? occurrences.find((o) => o.kind === 'route')?.routeName
    : idOf.get(rootOcc.name)

  const layouts = [{ file: ctx.rel(entry ?? defs.get(rootOcc.name) ?? rootOcc.file), dir: '', navigator: 'Stack' }]
  const routes = [...new Set(occurrences.map((o) => o.name))].filter((name) => name !== shellName).map((name) => {
    const id = idOf.get(name)
    const file = defs.get(name)
    const own = file ? read(file) : ''
    const mine = occurrences.filter((o) => o.name === name)
    const kinds = new Set(mine.map((o) => o.kind))
    const modal = id !== rootId && kinds.has('modal') && ['navigate', 'root', 'route', 'frame'].every((k) => !kinds.has(k))
    const frame = mine.find((o) => o.kind === 'frame')
    const host = frame ? componentIn(frame.file) : null
    const hostId = host && host !== shellName ? idOf.get(host) : null
    const navigator = frame?.hostTabs ? 'Tabs' : 'Stack'
    if (hostId && !layouts.some((l) => l.dir === hostId)) layouts.push({ file: ctx.rel(defs.get(host)), dir: hostId, navigator })
    return {
      id,
      file: ctx.rel(file ?? mine[0].file),
      urlPath: id === rootId ? '/' : null,
      title: id,
      slug: id.replace(/[^A-Za-z0-9_.-]+/g, '_'),
      params: [], navigator, layoutDir: hostId ?? '',
      presentation: modal ? 'modal' : null,
      stateHints: [
        ...extractHints(own),
        // a modal that is a screen of its own is an edge, not a state
        ...nsHints(own).filter((h) => !(h.type === 'ns-modal' && idOf.has(h.component))),
        ...componentHints(own),
        ...(modal ? [{ type: 'router-modal', presentation: 'modal' }] : []),
      ],
      _abs: file,
    }
  })
  applyLinks(routes, ctx.config?.links)

  // A screen links to the components its own source, or a module it imports
  // one hop out, mounts, pushes or presents. Same fanout cap as every other
  // provider: a helper imported by most screens is chrome, not a link. An
  // imported module that is itself a screen keeps its own pushes and modals;
  // only the call that mounts that screen (its presenter, which lives next to
  // it) counts for the importer. Frame hosting and route registration are
  // structure, not links.
  const byId = new Map(routes.map((r) => [r.id, r]))
  const screenOfFile = new Map(routes.map((r) => [r.file, r.id]))
  const importsOf = new Map()
  const fanout = new Map()
  for (const r of routes) {
    if (!r._abs) continue
    const own = ctx.firstPartyImports(read(r._abs), r.file)
    importsOf.set(r.id, own)
    for (const f of new Set(own)) fanout.set(f, (fanout.get(f) ?? 0) + 1)
  }
  const byComponent = [...spec.mount, ...spec.navigate, ...spec.modal].map((re) => ({ re, resolve: (n) => byId.get(idOf.get(n)) }))
  const byName = (spec.navigateByName ?? []).map((re) => ({ re, resolve: (n) => byId.get(n) }))
  const edges = []
  for (const r of routes) {
    if (!r._abs) continue
    const sources = [{ src: read(r._abs), owner: null }]
    for (const f of importsOf.get(r.id) ?? []) {
      if ((fanout.get(f) ?? 0) > IMPORT_FANOUT_CAP) continue
      const s = read(path.join(ctx.projectRoot, f))
      if (s) sources.push({ src: s, owner: screenOfFile.get(f) ?? null })
    }
    const seen = new Set()
    for (const { src, owner } of sources)
      for (const { re, resolve } of [...byComponent, ...byName])
        for (const m of src.matchAll(re)) {
          const target = resolve(m[1])
          if (!target || target.id === r.id || seen.has(target.id)) continue
          if (owner && owner !== target.id) continue
          seen.add(target.id)
          edges.push({ from: r.id, to: target.id, raw: m[0].replace(/\s+/g, ' ').slice(0, 100), target: target.id })
        }
  }

  const screensResolved = routes.filter((r) => r._abs).length
  for (const r of routes) delete r._abs
  return {
    flavor, appPath: ns.appPath,
    entryFile: entry ? ctx.rel(entry) : null,
    ...(shellName ? { routerShell: ctx.rel(defs.get(shellName)) } : {}),
    screensResolved,
    layouts, routes, edges,
  }
}

// ---------- shared ----------

function flavorOf(ctx) {
  const deps = ctx.deps()
  return FLAVOR_DEPS.find(([dep]) => deps[dep]) ?? [null, 'core']
}

function sourceFiles(ctx, ns) {
  for (const d of [ns.appPath, 'src', 'app']) {
    if (!ctx.exists(d)) continue
    const files = ctx.walk(path.join(ctx.projectRoot, d)).filter((f) => /\.(ts|tsx|js|jsx|mjs|html|xml|vue|svelte)$/.test(f) && !SKIP_FILE.test(ctx.rel(f)))
    if (files.length) return files
  }
  return []
}

export function detect(ctx) {
  const evidence = []
  const ns = ctx.nativescriptConfig()
  const deps = ctx.deps()
  let score = 0
  if (ns) { score += 0.5; evidence.push(ns.file) }
  if (deps['@nativescript/core']) { score += 0.3; evidence.push('@nativescript/core in package.json') }
  if (!score) return { score: 0, evidence: ['no nativescript.config.* and no @nativescript/core dependency'] }
  const [dep, flavor] = flavorOf(ctx)
  const files = sourceFiles(ctx, ns ?? { appPath: 'app' })
  if (flavor === 'angular') {
    score += 0.15
    const routeFiles = files.filter((f) => CODE_EXT.test(f) && /\bRoutes\s*=\s*\[/.test(ctx.readFileOrNull(f) ?? '')).length
    evidence.push(`${dep} with ${routeFiles} Routes file(s)`)
  } else if (flavor === 'core') {
    evidence.push('no framework dependency — reading XML pages')
  } else {
    score += 0.15
    const spec = COMPONENT_FLAVORS[flavor]
    const mounts = files.filter((f) => spec.ext.test(f) && spec.mount.some((re) => new RegExp(re.source).test(ctx.readFileOrNull(f) ?? ''))).length
    evidence.push(`${dep} with ${mounts} file(s) mounting a component`)
  }
  return { score: Math.min(score, 1), evidence, flavor }
}

export function parse(ctx) {
  const ns = ctx.nativescriptConfig() ?? { appPath: ctx.exists('src') ? 'src' : 'app', appResourcesPath: 'App_Resources', id: null }
  const [, flavor] = flavorOf(ctx)
  const files = sourceFiles(ctx, ns)
  if (!files.length) throw new Error(`nativescript: no source files under ${ns.appPath}/`)
  if (flavor === 'angular') return parseAngular(ctx, files, ns)
  if (flavor === 'core') return parseCore(ctx, files, ns)
  return parseComponents(ctx, files, ns, flavor)
}
