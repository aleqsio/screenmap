// What more than one flavor needs: following imports to the module that
// declares a component, finding the entry module, and the modal / sheet hints.

import path from 'node:path'

// Links live in the screen and the modules it imports one hop out; a module
// imported by more screens than this is chrome, not a link.
export const IMPORT_FANOUT_CAP = 8

// identifier → { file, name } for one module's imports
export function importMap(ctx, src, fromFile) {
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
export function locateExport(ctx, absFile, name, depth = 0) {
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

// The module the runtime evaluates first: package.json `main`, else the
// conventional names under the app directory.
export function findEntry(ctx, ns) {
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

// Modals and sheets in NativeScript Angular open components, not routes, so
// the component name is the hint's handle for whoever has to trigger it.
export function nsHints(src) {
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
