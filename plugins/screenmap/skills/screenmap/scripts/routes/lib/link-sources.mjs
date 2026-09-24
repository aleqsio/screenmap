// Where a screen's links live. Its own module is rarely the whole answer: put
// the <Link> in a list-item component and the screen reads as unreachable. So
// link scanning follows each screen's first-party imports one hop.
//
// One hop, and not into shared chrome: a header, tab bar or service imported
// by most screens would otherwise attribute its links to every one of them and
// turn the graph into a hairball. Files imported by more than
// IMPORT_FANOUT_CAP screens are treated as chrome and skipped.

import path from 'node:path'

export const IMPORT_FANOUT_CAP = 8

// routes: the screens to scan, each with its repo-relative `file`; srcOf gives
// a screen's own source. Returns route → the imported modules worth scanning
// for it, as [{ file, src }].
export function importedLinkSources(ctx, routes, srcOf) {
  const imports = new Map(routes.map((r) => [r, ctx.firstPartyImports(srcOf(r), r.file)]))
  const fanout = new Map()
  for (const own of imports.values()) for (const f of new Set(own)) fanout.set(f, (fanout.get(f) ?? 0) + 1)
  const out = new Map()
  for (const [r, own] of imports)
    out.set(r, own
      .filter((f) => fanout.get(f) <= IMPORT_FANOUT_CAP)
      .map((file) => ({ file, src: ctx.readFileOrNull(path.join(ctx.projectRoot, file)) }))
      .filter((m) => m.src))
  return out
}
