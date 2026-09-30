// iOS simulator driver — the `xcrun simctl` half of the device layer, matching
// lib/android.mjs's interface. No MCP, no LLM, works on a macOS runner.
//
// The shared session orchestration (Metro, the connect loop, capture helpers)
// lives in lib/device.mjs; this file is only the iOS-specific primitives.
import fs from 'node:fs'
import path from 'node:path'
import { sh, shOk, log } from './util.mjs'
import { argentAvailable, argentRun, grantPermissions } from './argent.mjs'
import { ocr, ocrAvailable } from './ocr.mjs'

export const platform = 'ios'
export const label = 'iOS simulator'

// iOS ≥18.3 gates simctl openurl for a custom scheme behind an
// "Open in …?" prompt. Pre-approving the scheme in LaunchServices skips it
// (the Detox/Maestro technique); harmless on versions without the prompt.
export function approveScheme(udid, scheme, bundleId) {
  shOk('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', 'com.apple.launchservices.schemeapproval',
    `com.apple.CoreSimulator.CoreSimulatorBridge-->${scheme}`, '-string', bundleId])
  // SpringBoard caches approvals; respring so the write takes effect now
  shOk('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'kickstart', '-k', 'system/com.apple.SpringBoard'])
}

// expo-dev-menu overlays first captures: a one-time onboarding sheet ("This is
// the developer menu…") plus an optional show-at-launch. Both read the app's
// standard UserDefaults (see DevMenuPreferences.swift), so mark onboarding done
// before the first launch — the runtime equivalent of the
// EXDevMenuIsOnboardingFinished Info.plist flag, without rebuilding the client.
export function muteDevMenu(udid, bundleId) {
  shOk('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', bundleId, 'EXDevMenuIsOnboardingFinished', '-bool', 'true'])
  shOk('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', bundleId, 'EXDevMenuShowsAtLaunch', '-bool', 'false'])
  // expo-dev-menu 57 added a floating gear that defaults to on and lands in the
  // top-right of every capture, over page titles
  shOk('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', bundleId, 'EXDevMenuShowFloatingActionButton', '-bool', 'false'])
}

// Belt-and-braces for the same prompt: OCR the screen and tap "Open".
export function nudgeOpenPrompt(udid, projectDir) {
  if (!ocrAvailable()) return false
  const shot = path.join(projectDir, '.screenmap', 'out', 'ci', 'open-prompt.png')
  fs.mkdirSync(path.dirname(shot), { recursive: true })
  sh('xcrun', ['simctl', 'io', udid, 'screenshot', shot])
  const items = ocr(shot)
  if (!items.some((i) => /^open in/i.test(i.text.trim()))) return false
  const b = items.find((i) => /^open$/i.test(i.text.trim()))
  if (!b) return false
  // Vision boxes: normalized, origin bottom-left → argent taps: origin top-left
  const x = b.x + b.w / 2, y = 1 - (b.y + b.h / 2)
  const r = argentRun('gesture-tap', { udid, x: x.toFixed(4), y: y.toFixed(4) })
  log(`tapped "Open" on the scheme prompt (${r.ok ? 'ok' : 'tap failed'})`)
  return r.ok
}

export function listBooted() {
  const j = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']))
  return Object.values(j.devices).flat().filter((d) => d.state === 'Booted').map((d) => ({ id: d.udid, name: d.name }))
}

export async function ensureBooted(config) {
  const booted = listBooted()
  if (booted.length) { log(`simulator already booted: ${booted[0].name} (${booted[0].id})`); return booted[0] }
  const j = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'available', '-j']))
  const all = Object.values(j.devices).flat()
  const pick = all.find((d) => d.name === config.device) ?? all.find((d) => /iPhone/.test(d.name))
  if (!pick) throw new Error(`no available simulator (wanted "${config.device}")`)
  log(`booting ${pick.name} (${pick.udid})`)
  sh('xcrun', ['simctl', 'boot', pick.udid])
  sh('xcrun', ['simctl', 'bootstatus', pick.udid, '-b'])
  return { id: pick.udid, name: pick.name }
}

// presentation mode: identical clock/battery/signal on every capture, so
// base and head screenshots only differ where the app differs
export function freezeStatusBar(udid) {
  shOk('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active',
    '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100'])
}

export function findBuiltApp(projectDir) {
  const dirs = [
    path.join(projectDir, 'ios', 'build', 'Build', 'Products', 'Debug-iphonesimulator'),
    path.join(projectDir, 'ios', 'build', 'Build', 'Products', 'Release-iphonesimulator'),
  ]
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue
    const app = fs.readdirSync(d).find((f) => f.endsWith('.app'))
    if (app) return path.join(d, app)
  }
  return null
}

export function appIdOf(appPath) {
  return sh('defaults', ['read', path.join(appPath, 'Info'), 'CFBundleIdentifier'])
}

export function installApp(udid, appPath) {
  sh('xcrun', ['simctl', 'install', udid, appPath])
}

export function terminate(udid, bundleId) { shOk('xcrun', ['simctl', 'terminate', udid, bundleId]) }
export function launch(udid, bundleId) { sh('xcrun', ['simctl', 'launch', udid, bundleId]) }
export function openUrl(udid, url) { sh('xcrun', ['simctl', 'openurl', udid, url]) }
export function screenshot(udid, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  freezeStatusBar(udid) // tooling in between (argent) can clear the override
  sh('xcrun', ['simctl', 'io', udid, 'screenshot', outPath])
  return outPath
}

// pre-grant privacy so a mis-tap can never summon a system permission dialog
// that then sits over every later capture (simctl + argent's TCC editor)
export function grantPrivacy(udid, bundleId) {
  shOk('xcrun', ['simctl', 'privacy', udid, 'grant', 'all', bundleId])
  if (argentAvailable()) { const g = grantPermissions(udid, bundleId); if (g.length) log(`pre-granted: ${g.join(', ')}`) }
}

// The simulator shares the host's network stack, so Metro on localhost is
// already reachable — nothing to tunnel.
export function connectMetro() { return true }

export function diagnostics(udid, dir) {
  fs.mkdirSync(dir, { recursive: true })
  try { sh('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(dir, 'connect-timeout.png')]) } catch {}
  try { fs.writeFileSync(path.join(dir, 'listapps.txt'), sh('xcrun', ['simctl', 'listapps', udid])) } catch {}
}
