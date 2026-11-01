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
    if (link.action === 'back') return !link.to && !link.targetState
    return !link.action && typeof link.to === 'string' && (!link.targetState || typeof link.targetState === 'string') && exists(link.to, link.targetState)
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
