// nativescript (octane, react, vue, svelte, solid) — component-driven: a
// screen is a component the framework mounts as a root, pushes, presents as a
// modal, hosts in a <frame> tab, or (solid-navigation) registers in a <Route>
// table.

import { extractHints } from '../../lib/hints.mjs'
import { importedLinkSources } from '../../lib/link-sources.mjs'
import { importMap, locateExport, findEntry, nsHints } from './common.mjs'

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
export const COMPONENT_FLAVORS = {
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

// Runtime states a component-driven screen can be in that a screenshot of its
// first render cannot show: an open drawer, a native menu.
function componentHints(src) {
  const hints = []
  if (/<(?:drawer|Drawer|RadSideDrawer|SideDrawer)\b/.test(src)) hints.push({ type: 'drawer' })
  if (/\b(?:menu|contextMenu)\s*=\s*[{"']/.test(src)) hints.push({ type: 'native-menu' })
  return hints
}

export function parseComponents(ctx, files, ns, flavor) {
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

  // A screen links to the components its own source, or a module it imports
  // one hop out, mounts, pushes or presents. Same fanout cap as every other
  // provider: a helper imported by most screens is chrome, not a link. An
  // imported module that is itself a screen keeps its own pushes and modals;
  // only the call that mounts that screen (its presenter, which lives next to
  // it) counts for the importer. Frame hosting and route registration are
  // structure, not links.
  const byId = new Map(routes.map((r) => [r.id, r]))
  const screenOfFile = new Map(routes.map((r) => [r.file, r.id]))
  const scanned = routes.filter((r) => r._abs)
  const imported = importedLinkSources(ctx, scanned, (r) => read(r._abs))
  const byComponent = [...spec.mount, ...spec.navigate, ...spec.modal].map((re) => ({ re, resolve: (n) => byId.get(idOf.get(n)) }))
  const byName = (spec.navigateByName ?? []).map((re) => ({ re, resolve: (n) => byId.get(n) }))
  const edges = []
  for (const r of scanned) {
    const sources = [
      { src: read(r._abs), owner: null },
      ...imported.get(r).map(({ file, src }) => ({ src, owner: screenOfFile.get(file) ?? null })),
    ]
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
