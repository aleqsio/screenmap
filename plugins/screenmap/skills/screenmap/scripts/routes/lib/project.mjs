// Project-shaped helpers shared by every route provider: filesystem walking,
// TypeScript path-alias resolution, import following, and app config reading.
//
// Everything is bound to a projectRoot through createProjectCtx() rather than
// read from module state, so a driver can hold two roots at once (the PR diff
// lane parses a base and a head checkout in one process).

import fs from 'node:fs'
import path from 'node:path'

const IMPORT_EXT = ['.tsx', '.ts', '.jsx', '.js']
export const DEFAULT_SKIP = /(^|\/)(node_modules|\.git|\.expo|\.screenmap|ios|android|build|dist)(\/|$)/

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// route pattern → regex; supports [param]/[...param] (expo) and :param (RN)
export function routeMatcher(urlPath) {
  const re = urlPath
    .split('/')
    .map((seg) =>
      seg.startsWith('[...') ? '.*'
      : seg.startsWith('[') || seg.startsWith(':') ? '[^/]+'
      : escapeRe(seg)
    )
    .join('/')
  return new RegExp('^' + re + '/?$')
}

// tsconfig.json is JSONC in the wild. The stripper must be string-aware: a
// plain /*…*/ sweep eats a stock Expo `paths` block, because "@/*" opens a
// comment and the "**/*.ts" in `include` closes it.
export function stripJsonc(src) {
  let out = '', inStr = false, esc = false, line = false, block = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (line) { if (c === '\n') { line = false; out += c } continue }
    if (block) { if (c === '*' && n === '/') { block = false; i++ } continue }
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && n === '/') { line = true; i++; continue }
    if (c === '/' && n === '*') { block = true; i++; continue }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export function createProjectCtx(projectRoot) {
  const rel = (p) => path.relative(projectRoot, p).split(path.sep).join('/')

  const readFileOrNull = (p) => {
    try { return fs.readFileSync(p, 'utf8') } catch { return null }
  }

  // Recursive file list. `skip` defaults to the directories no route ever lives
  // in; a provider walking the whole source tree would otherwise spend its time
  // in node_modules.
  function walk(dir, { skip = DEFAULT_SKIP } = {}) {
    const out = []
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (skip && skip.test(rel(p))) continue
      if (e.isDirectory()) out.push(...walk(p, { skip }))
      else out.push(p)
    }
    return out
  }

  let _aliases = null
  function pathAliases() {
    if (_aliases) return _aliases
    _aliases = []
    const src = readFileOrNull(path.join(projectRoot, 'tsconfig.json'))
    if (src) {
      let cfg = null
      try { cfg = JSON.parse(stripJsonc(src)) } catch { try { cfg = JSON.parse(src) } catch {} }
      for (const [pat, targets] of Object.entries(cfg?.compilerOptions?.paths ?? {}))
        _aliases.push({
          prefix: pat.replace(/\*$/, ''),
          targets: targets.map((t) => t.replace(/\*$/, '').replace(/^\.\//, '')),
        })
    }
    return _aliases
  }

  function resolveToRel(candidate) {
    candidate = candidate.replace(/\/+$/, '')
    for (const suffix of ['', ...IMPORT_EXT, ...IMPORT_EXT.map((e) => '/index' + e)]) {
      const c = candidate + suffix
      try { if (fs.statSync(path.join(projectRoot, c)).isFile()) return c } catch {}
    }
    return null
  }

  // repo-relative targets of a file's first-party imports; bare package imports
  // resolve to null and drop out
  function firstPartyImports(src, fromRel) {
    const specs = [
      ...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
      ...src.matchAll(/(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1])
    const out = []
    for (const spec of new Set(specs)) {
      let hit = null
      if (spec.startsWith('.')) {
        hit = resolveToRel(path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec)))
      } else {
        for (const a of pathAliases()) {
          if (!spec.startsWith(a.prefix)) continue
          for (const t of a.targets) {
            hit = resolveToRel(path.posix.normalize(t + spec.slice(a.prefix.length)))
            if (hit) break
          }
          if (hit) break
        }
      }
      if (hit) out.push(hit)
    }
    return out
  }

  // Absolute path for an import written from `fromFile`, covering the relative
  // and alias forms plus the `#/` convention some RN apps use for `src/`.
  function resolveImport(spec, fromFile) {
    if (spec.startsWith('#/')) {
      const hit = resolveToRel(path.posix.join('src', spec.slice(2)))
      return hit ? path.join(projectRoot, hit) : null
    }
    const fromRel = rel(fromFile)
    const [hit] = firstPartyImports(`import x from '${spec}'`, fromRel)
    return hit ? path.join(projectRoot, hit) : null
  }

  // nativescript.config.ts (or the legacy nsconfig.json) names the app id and
  // where the source lives. Read by regex for the same reason app.config.ts is:
  // it is TypeScript that may compute its values.
  let _nsConfig
  function nativescriptConfig() {
    if (_nsConfig !== undefined) return _nsConfig
    _nsConfig = null
    const str = (src, key) => src.match(new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1] ?? null
    for (const f of ['nativescript.config.ts', 'nativescript.config.js', 'nativescript.config.mjs', 'nativescript.config.cjs']) {
      const src = readFileOrNull(path.join(projectRoot, f))
      if (!src) continue
      _nsConfig = {
        file: f,
        id: str(src, 'id'),
        appPath: str(src, 'appPath') ?? 'app',
        appResourcesPath: str(src, 'appResourcesPath') ?? 'App_Resources',
      }
      return _nsConfig
    }
    const legacy = readFileOrNull(path.join(projectRoot, 'nsconfig.json'))
    if (legacy) {
      let cfg = {}
      try { cfg = JSON.parse(legacy) } catch {}
      _nsConfig = {
        file: 'nsconfig.json',
        id: packageJson().nativescript?.id ?? null,
        appPath: cfg.appPath ?? 'app',
        appResourcesPath: cfg.appResourcesPath ?? 'App_Resources',
      }
    }
    return _nsConfig
  }

  // A NativeScript app declares its name and URL scheme in the native resource
  // files, not in a JSON config: Info.plist's CFBundleURLSchemes (often through
  // an xcconfig variable) and AndroidManifest's VIEW intent filters. Third-party
  // sign-in SDKs register schemes of their own in the same place, so the app's
  // own scheme is the one matching the bundle id, else the first that is not a
  // known SDK's.
  function nativescriptAppConfig(ns) {
    const res = path.join(projectRoot, ns.appResourcesPath)
    const vars = {}
    for (const m of (readFileOrNull(path.join(res, 'iOS', 'build.xcconfig')) ?? '').matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*([^;\n]*?)\s*;?\s*$/gm)) vars[m[1]] = m[2]
    const subst = (s) => s.replace(/\$[({]?([A-Z_][A-Z0-9_]*)[)}]?/g, (m, k) => vars[k] ?? (/BUNDLE_IDENTIFIER$/.test(k) ? ns.id : null) ?? m)
    const SDK_SCHEME = /^(com\.googleusercontent\.apps\.|fb\d|msauth|twitterkit|db-)/
    const plist = readFileOrNull(path.join(res, 'iOS', 'Info.plist')) ?? ''
    const plistValue = (key) => {
      const v = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]
      return v && !v.includes('$') ? v : null
    }
    const schemes = []
    for (const m of plist.matchAll(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/g))
      for (const s of m[1].matchAll(/<string>([^<]+)<\/string>/g)) schemes.push(subst(s[1].trim()))
    const manifest = readFileOrNull(path.join(res, 'Android', 'src', 'main', 'AndroidManifest.xml')) ?? ''
    for (const m of manifest.matchAll(/android:scheme="([^"]+)"/g))
      if (!/^https?$/.test(m[1])) schemes.push(subst(m[1]))
    const own = schemes.filter((s) => !s.includes('$') && !SDK_SCHEME.test(s))
    const scheme = own.find((s) => s === ns.id) ?? own[0] ?? null
    const name =
      vars.BUNDLE_DISPLAY_NAME ?? plistValue('CFBundleDisplayName') ?? plistValue('CFBundleName') ??
      (readFileOrNull(path.join(res, 'Android', 'src', 'main', 'res', 'values', 'strings.xml')) ?? '')
        .match(/<string name="app_name">([^<]+)<\/string>/)?.[1] ?? null
    return { name, scheme, slug: ns.id }
  }

  // app.json first, then the dynamic configs. The dynamic path is a regex over
  // source — app.config.ts can compute its values, and running it would mean
  // executing project code inside the parser.
  let _appConfig = null
  function appConfig() {
    if (_appConfig) return _appConfig
    const pick = (v) => (Array.isArray(v) ? v[0] : v) ?? null
    let name = null, scheme = null, slug = null
    const json = readFileOrNull(path.join(projectRoot, 'app.json'))
    if (json) {
      try {
        const cfg = JSON.parse(json)
        const e = cfg.expo ?? cfg
        name = e.name ?? null
        scheme = pick(e.scheme)
        slug = e.slug ?? null
      } catch {}
    }
    if (!name || !scheme) {
      for (const f of ['app.config.ts', 'app.config.js', 'app.config.mjs']) {
        const src = readFileOrNull(path.join(projectRoot, f))
        if (!src) continue
        if (!name) name = src.match(/\bname\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null
        if (!scheme) scheme = src.match(/\bscheme\s*:\s*["'`]([A-Za-z0-9._+-]+)["'`]/)?.[1] ?? null
        if (!slug) slug = src.match(/\bslug\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null
        if (name && scheme) break
      }
    }
    const ns = !name || !scheme ? nativescriptConfig() : null
    if (ns) {
      const n = nativescriptAppConfig(ns)
      name ??= n.name
      scheme ??= n.scheme
      slug ??= n.slug
    }
    _appConfig = { name: name ?? path.basename(projectRoot), scheme, slug }
    return _appConfig
  }

  function packageJson() {
    try { return JSON.parse(readFileOrNull(path.join(projectRoot, 'package.json')) ?? '{}') } catch { return {} }
  }

  // Every dependency name, whichever section it is declared in.
  function deps() {
    const pkg = packageJson()
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) }
  }

  const exists = (p) => fs.existsSync(path.join(projectRoot, p))

  return {
    projectRoot, rel, exists, walk, readFileOrNull, resolveToRel, resolveImport,
    firstPartyImports, pathAliases, appConfig, nativescriptConfig, packageJson, deps,
    routeMatcher, escapeRe,
  }
}
