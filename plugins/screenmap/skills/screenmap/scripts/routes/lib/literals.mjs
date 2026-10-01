// Tolerant reading of JavaScript literals, for providers that pull route
// tables and constants out of source without executing it.
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
export function closeOf(src, open) {
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
export const inner = (lit) => {
  const t = lit.trim()
  return t.slice(1, closeOf(t, 0) - 1)
}

// Top-level comma split of an array or object body.
export function splitTop(body) {
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
export function objectEntries(body) {
  return splitTop(body).map((part) => {
    if (part.startsWith('...')) return { key: '...', value: part.slice(3).trim() }
    const m = part.match(/^(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])\s*:\s*([\s\S]*)$/)
    if (m) return { key: m[1] ?? m[2], value: m[3].trim() }
    const short = part.match(/^([A-Za-z_$][\w$]*)$/)
    return short ? { key: short[1], value: short[1] } : null
  }).filter(Boolean)
}

// ---------- constants: path: ROUTES.HOME / path: Screens.Q1 / `${Prefix}/x` ----------

export function buildConstantMap(ctx, files) {
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

export function constValue(expr, consts) {
  const member = expr.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
  if (member) return consts.objects[member[1]]?.[member[2]] ?? null
  const ident = expr.match(/^([A-Za-z_$][\w$]*)$/)
  if (ident) return consts.scalars[ident[1]] ?? null
  return null
}
