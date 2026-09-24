// A NativeScript app's id, source directory, name and URL scheme: from
// nativescript.config.* and the native resource files, since it has no
// app.json.

import path from 'node:path'

// nativescript.config.ts (or the legacy nsconfig.json) names the app id and
// where the source lives. Read by regex for the same reason app.config.ts is:
// it is TypeScript that may compute its values.
export function nativescriptConfig(ctx) {
  const str = (src, key) => src.match(new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1] ?? null
  for (const f of ['nativescript.config.ts', 'nativescript.config.js', 'nativescript.config.mjs', 'nativescript.config.cjs']) {
    const src = ctx.readFileOrNull(path.join(ctx.projectRoot, f))
    if (!src) continue
    return {
      file: f,
      id: str(src, 'id'),
      appPath: str(src, 'appPath') ?? 'app',
      appResourcesPath: str(src, 'appResourcesPath') ?? 'App_Resources',
    }
  }
  const legacy = ctx.readFileOrNull(path.join(ctx.projectRoot, 'nsconfig.json'))
  if (!legacy) return null
  let cfg = {}
  try { cfg = JSON.parse(legacy) } catch {}
  return {
    file: 'nsconfig.json',
    id: ctx.packageJson().nativescript?.id ?? null,
    appPath: cfg.appPath ?? 'app',
    appResourcesPath: cfg.appResourcesPath ?? 'App_Resources',
  }
}

// A NativeScript app declares its name and URL scheme in the native resource
// files, not in a JSON config: Info.plist's CFBundleURLSchemes (often through
// an xcconfig variable) and AndroidManifest's VIEW intent filters. Third-party
// sign-in SDKs register schemes of their own in the same place, so the app's
// own scheme is the one matching the bundle id, else the first that is not a
// known SDK's. Replaces ctx.appConfig(), which reads app.json / app.config.*.
export function appConfig(ctx) {
  const ns = nativescriptConfig(ctx)
  if (!ns) return ctx.appConfig()
  const read = (...p) => ctx.readFileOrNull(path.join(ctx.projectRoot, ns.appResourcesPath, ...p)) ?? ''
  const vars = {}
  for (const m of read('iOS', 'build.xcconfig').matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*([^;\n]*?)\s*;?\s*$/gm)) vars[m[1]] = m[2]
  const subst = (s) => s.replace(/\$[({]?([A-Z_][A-Z0-9_]*)[)}]?/g, (m, k) => vars[k] ?? (/BUNDLE_IDENTIFIER$/.test(k) ? ns.id : null) ?? m)
  const SDK_SCHEME = /^(com\.googleusercontent\.apps\.|fb\d|msauth|twitterkit|db-)/
  const plist = read('iOS', 'Info.plist')
  const plistValue = (key) => {
    const v = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]
    return v && !v.includes('$') ? v : null
  }
  const schemes = []
  for (const m of plist.matchAll(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/g))
    for (const s of m[1].matchAll(/<string>([^<]+)<\/string>/g)) schemes.push(subst(s[1].trim()))
  for (const m of read('Android', 'src', 'main', 'AndroidManifest.xml').matchAll(/android:scheme="([^"]+)"/g))
    if (!/^https?$/.test(m[1])) schemes.push(subst(m[1]))
  const own = schemes.filter((s) => !s.includes('$') && !SDK_SCHEME.test(s))
  const name =
    vars.BUNDLE_DISPLAY_NAME ?? plistValue('CFBundleDisplayName') ?? plistValue('CFBundleName') ??
    read('Android', 'src', 'main', 'res', 'values', 'strings.xml').match(/<string name="app_name">([^<]+)<\/string>/)?.[1] ??
    path.basename(ctx.projectRoot)
  return { name, scheme: own.find((s) => s === ns.id) ?? own[0] ?? null, slug: ns.id }
}
