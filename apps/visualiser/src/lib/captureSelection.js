export { captureProfiles, captureAxisKeys, selectionOf, resolveProfile, captureForProfile } from '../../../../plugins/screenmap/skills/screenmap/scripts/capture-axes.mjs'

export function readPanes(value) {
  try {
    const items = JSON.parse(value)
    if (!Array.isArray(items)) return []
    return items.slice(0, 4).filter((item) => item && typeof item === 'object').map((item) => Object.fromEntries(['platform', 'osVersion', 'language', 'appearance', 'variant'].map((key) => [key, typeof item[key] === 'string' ? item[key] : ''])))
  } catch { return [] }
}

export function captureAvailability(bundle, profiles, screen, state = null) {
  const hasImage = (capture) => !!capture?.screenshot && bundle.images.has(capture.screenshot)
  const nodes = bundle.map.nodes
  return profiles.map((profile) => {
    let baseCount = 0, stateCount = 0
    for (const node of nodes) {
      const base = node.captures ? node.captures[profile.id] : node.capture
      if (hasImage(base)) baseCount++
      stateCount += (base?.states ?? []).filter(hasImage).length
    }
    const node = nodes.find((item) => item.id === screen)
    const base = node?.captures ? node.captures[profile.id] : node?.capture
    const selected = state ? base?.states?.find((item) => item.name === state) : base
    return { ...profile, baseCount, stateCount, currentAvailable: screen == null ? baseCount + stateCount > 0 : hasImage(selected) }
  })
}

export function compatibleCaptureCount(availability, selection, key, value) {
  return availability.filter((profile) => profile.currentAvailable && ['platform', 'osVersion', 'language', 'appearance'].every((axis) => (profile[axis] ?? '') === (axis === key ? value : selection[axis] ?? ''))).length
}

export function availabilityCombinations(availability) {
  const pairs = [...new Map(availability.map((profile) => [JSON.stringify([profile.platform, profile.osVersion]), [profile.platform, profile.osVersion]])).values()]
  const languages = [...new Set(availability.map((profile) => profile.language))]
  const appearances = [...new Set(availability.map((profile) => profile.appearance))]
  return pairs.flatMap(([platform, osVersion]) => languages.flatMap((language) => appearances.flatMap((appearance) => {
    const matches = availability.filter((profile) => profile.platform === platform && profile.osVersion === osVersion && profile.language === language && profile.appearance === appearance)
    return matches.length ? matches : [{ id: JSON.stringify([platform, osVersion, language, appearance]), platform, osVersion, language, appearance, baseCount: 0, stateCount: 0, currentAvailable: false, unconfigured: true }]
  })))
}
