export function galleryFrames(bundle, profile) {
  if (!bundle || !profile) return []
  return bundle.map.nodes.flatMap((node) => {
    const base = node.captures ? node.captures[profile.id] : node.capture
    return [{ ...base, state: null }, ...[...(base?.states ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((capture) => ({ ...capture, state: capture.name }))]
      .filter((capture) => capture.screenshot && bundle.images.has(capture.screenshot))
      .map((capture) => ({ node, capture, screen: node.id, state: capture.state }))
  })
}
