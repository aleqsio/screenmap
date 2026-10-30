export const captureAxisKeys = ['platform', 'osVersion', 'language', 'appearance']

export function variantDescriptor(value, defaultPlatform = null) {
  const legacy = /^(en|ar)-(light|dark)$/.exec(value.id)
  return {
    id: value.id, label: value.label ?? value.id,
    platform: value.platform ?? defaultPlatform,
    osVersion: value.osVersion ?? null,
    language: value.language ?? legacy?.[1] ?? null,
    appearance: value.appearance ?? legacy?.[2] ?? null,
    device: value.device ?? null,
  }
}

export function captureProfiles(manifest) {
  const app = manifest?.app ?? {}
  const platform = app.platform === 'android-emulator' ? 'android' : app.platform === 'ios-simulator' ? 'ios' : app.platform ?? 'ios'
  if (manifest?.variants?.length) return manifest.variants.filter((v) => v?.id).map((v) => variantDescriptor(v, platform))
  return (app.platforms?.length ? app.platforms : [{ platform, device: app.device }]).map((p) => variantDescriptor({ id: p.platform, ...p }, p.platform))
}

export function selectionOf(profile) {
  return { ...Object.fromEntries(captureAxisKeys.map((key) => [key, profile?.[key] ?? ''])), variant: profile?.id ?? '' }
}

export function resolveProfile(profiles, selection) {
  const matches = profiles.filter((profile) => captureAxisKeys.every((key) => (profile[key] ?? '') === (selection[key] ?? '')))
  return matches.find((profile) => profile.id === selection.variant) ?? (matches.length === 1 ? matches[0] : null)
}

export function captureForProfile(node, profile, state = null) {
  if (!profile) return null
  const capture = node?.captures ? node.captures[profile.id] : node?.capture
  if (!capture) return null
  return state ? capture.states?.find((item) => item.name === state) ?? null : capture
}
