export function validatePrototype(prototype, sourceSha256, nodes, axis, sourceId) {
  if (!prototype || !sourceSha256 || prototype.sourceSha256 !== sourceSha256) return null
  const capture = (node) => axis == null ? node?.capture : node?.captures?.[axis]
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const exists = (id, state) => {
    const c = capture(byId.get(id))
    return !!c && (!state ? !!c.screenshot : (c.states ?? []).some((s) => s.name === state && s.screenshot))
  }
  const links = (Array.isArray(prototype.links) ? prototype.links : []).filter((link) => {
    if (typeof link?.label !== 'string' || !link.label.trim() || !Array.isArray(link.rect) || link.rect.length !== 4 || !link.rect.every(Number.isFinite)) return false
    const [x, y, w, h] = link.rect
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return false
    if (link.action === 'back') return !link.to && !link.targetState && (link.scope === undefined || link.scope === 'screen') && (link.fallbackTo === undefined || (typeof link.fallbackTo === 'string' && exists(link.fallbackTo)))
    return !link.action && link.scope === undefined && link.fallbackTo === undefined && typeof link.to === 'string' && (!link.targetState || typeof link.targetState === 'string') && exists(link.to, link.targetState)
  })
  const scroll = {}
  for (const direction of ['next', 'previous']) {
    const state = prototype.scroll?.[direction]
    if (typeof state === 'string' && state && exists(sourceId, state === '$base' ? null : state)) scroll[direction] = state
  }
  const viewport = prototype.viewport
  const validViewport = Number.isFinite(viewport?.width) && viewport.width > 0 && Number.isFinite(viewport?.height) && viewport.height > 0
  return links.length || Object.keys(scroll).length || validViewport ? { sourceSha256, links, ...(Object.keys(scroll).length ? { scroll } : {}), ...(validViewport ? { viewport: { width: viewport.width, height: viewport.height } } : {}) } : null
}

export function summarizeInteractions(nodes, axes, unknownSources = []) {
  const coverage = { captures: 0, complete: 0, partial: 0, missing: 0, linked: 0, unresolved: 0, unresolvedCaptures: [...unknownSources] }
  const nested = axes.length > 1 || nodes.some((node) => node.captures)
  for (const axis of axes) for (const node of nodes) {
    const capture = nested ? node.captures?.[axis] : node.capture
    if (!capture) continue
    for (const state of [capture, ...(capture.states ?? [])]) {
      const report = state.interactions ?? { status: 'missing', reason: 'missing-inventory', controls: [] }
      coverage.captures++
      coverage[report.status]++
      for (const control of report.controls) coverage[control.status === 'linked' ? 'linked' : 'unresolved']++
      if (report.status !== 'complete') coverage.unresolvedCaptures.push({ node: node.id, variant: axis, ...(state.name ? { state: state.name } : {}), reason: report.reason ?? 'unresolved-controls' })
    }
  }
  coverage.status = !coverage.captures ? 'missing' : coverage.missing || coverage.partial || coverage.unresolvedCaptures.length ? 'partial' : 'complete'
  return coverage
}

export const sameInteractionControl = (a, b) => {
  const intersection = Math.max(0, Math.min(a.rect[0] + a.rect[2], b.rect[0] + b.rect[2]) - Math.max(a.rect[0], b.rect[0])) * Math.max(0, Math.min(a.rect[1] + a.rect[3], b.rect[1] + b.rect[3]) - Math.max(a.rect[1], b.rect[1]))
  const first = a.rect[2] * a.rect[3], second = b.rect[2] * b.rect[3]
  return intersection / (first + second - intersection) >= 0.5 || (a.label === b.label && intersection / Math.min(first, second) >= 0.8 && Math.max(first, second) / Math.min(first, second) <= 4)
}
