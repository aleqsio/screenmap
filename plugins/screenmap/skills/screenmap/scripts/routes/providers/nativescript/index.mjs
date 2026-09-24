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
import { DEFAULT_SKIP } from '../../lib/project.mjs'
import { nativescriptConfig } from './app-config.mjs'
import { CODE_EXT, parseAngular } from './angular.mjs'
import { parseCore } from './core.mjs'
import { COMPONENT_FLAVORS, parseComponents } from './components.mjs'

export { appConfig } from './app-config.mjs'

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

const SKIP_FILE = /\.(spec|test|mock|stub|d)\.[jt]sx?$|(^|\/)(mocks?|__mocks__|__tests__|tests?|e2e)\//
// Native resources and build output can sit inside the app directory
// (app/App_Resources in older projects); no screen lives in either.
const SKIP_DIR = new RegExp(`${DEFAULT_SKIP.source}|(^|/)(App_Resources|platforms|\\.ns-vite-build)(/|$)`)

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
  ['@nativescript-community/svelte-native', 'svelte'],
  ['svelte-native', 'svelte'],
]

function flavorOf(ctx) {
  const deps = ctx.deps()
  return FLAVOR_DEPS.find(([dep]) => deps[dep]) ?? [null, 'core']
}

function sourceFiles(ctx, ns) {
  for (const d of [ns.appPath, 'src', 'app']) {
    if (!ctx.exists(d)) continue
    const files = ctx.walk(path.join(ctx.projectRoot, d), { skip: SKIP_DIR }).filter((f) => /\.(ts|tsx|js|jsx|mjs|html|xml|vue|svelte)$/.test(f) && !SKIP_FILE.test(ctx.rel(f)))
    if (files.length) return files
  }
  return []
}

export function detect(ctx) {
  const evidence = []
  const ns = nativescriptConfig(ctx)
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
  const ns = nativescriptConfig(ctx) ?? { appPath: ctx.exists('src') ? 'src' : 'app', appResourcesPath: 'App_Resources', id: null }
  const [, flavor] = flavorOf(ctx)
  const files = sourceFiles(ctx, ns)
  if (!files.length) throw new Error(`nativescript: no source files under ${ns.appPath}/`)
  if (flavor === 'angular') return parseAngular(ctx, files, ns)
  if (flavor === 'core') return parseCore(ctx, files, ns)
  return parseComponents(ctx, files, ns, flavor)
}
