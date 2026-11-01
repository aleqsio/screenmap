export { captureProfiles, captureAxisKeys, selectionOf, resolveProfile, captureForProfile } from '../../../../plugins/screenmap/skills/screenmap/scripts/capture-axes.mjs'

export function readPanes(value) {
  try {
    const items = JSON.parse(value)
    if (!Array.isArray(items)) return []
    return items.slice(0, 4).filter((item) => item && typeof item === 'object').map((item) => Object.fromEntries(['platform', 'osVersion', 'language', 'appearance', 'variant'].map((key) => [key, typeof item[key] === 'string' ? item[key] : ''])))
  } catch { return [] }
}
