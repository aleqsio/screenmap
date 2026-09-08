// Android emulator/device driver — the `adb` half of the device layer, mirroring
// lib/sim.mjs's iOS driver. Everything here is `adb` and the SDK's `emulator`
// binary: no MCP, no LLM, and it runs on a Linux runner, which is the whole
// point (macOS minutes bill at ten times the Linux rate).
//
// Most calls map one-to-one onto their simctl counterpart. Three do not:
//   - Android has no "Open in …?" scheme prompt, so there is nothing to
//     pre-approve and no prompt to tap through.
//   - the emulator cannot reach the host's Metro on `localhost`, so the driver
//     opens an `adb reverse` tunnel instead of rewriting the URL to 10.0.2.2 —
//     the tunnel also covers physical devices over USB, which 10.0.2.2 does not.
//   - the status bar is frozen through SystemUI demo mode rather than a
//     dedicated override command.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { sh, shOk, sleep, log } from './util.mjs'

// SDK tools: PATH first, then the standard SDK layout under ANDROID_HOME /
// ANDROID_SDK_ROOT. GitHub's ubuntu runners set ANDROID_HOME but do not always
// put platform-tools on PATH.
const sdkRoots = () => [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
  process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'),
  process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk')].filter(Boolean)

const toolCache = new Map()
function sdkTool(name, ...subdirs) {
  if (toolCache.has(name)) return toolCache.get(name)
  let found = null
  if (spawnSync('which', [name], { encoding: 'utf8' }).status === 0) found = name
  if (!found) for (const root of sdkRoots()) {
    for (const d of subdirs) {
      const p = path.join(root, d, name)
      if (fs.existsSync(p)) { found = p; break }
    }
    if (found) break
  }
  toolCache.set(name, found)
  return found
}
export const adbPath = () => sdkTool('adb', 'platform-tools')
export const emulatorPath = () => sdkTool('emulator', 'emulator', 'tools')

function adb(id, args, opts = {}) {
  const bin = adbPath()
  if (!bin) throw new Error('adb not found — install Android platform-tools or set ANDROID_HOME')
  return sh(bin, [...(id ? ['-s', id] : []), ...args], opts)
}
function adbOk(id, args, opts = {}) {
  const bin = adbPath()
  if (!bin) return false
  return shOk(bin, [...(id ? ['-s', id] : []), ...args], opts)
}
// One shell string rather than argv: adb joins its arguments with spaces and
// hands the result to the device's own shell, so a deep link containing `&`
// (`?a=1&b=2`) would otherwise background the command on the device. Quoting
// here is the only place that can fix it.
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

export const platform = 'android'
export const label = 'Android emulator'

export function listBooted() {
  const bin = adbPath()
  if (!bin) return []
  let out = ''
  try { out = sh(bin, ['devices', '-l']) } catch { return [] }
  return out.split('\n').slice(1).map((l) => l.trim()).filter((l) => /\sdevice(\s|$)/.test(l))
    .map((l) => {
      const id = l.split(/\s+/)[0]
      const model = l.match(/model:(\S+)/)?.[1]?.replace(/_/g, ' ')
      let name = model
      try { name = sh(bin, ['-s', id, 'shell', 'getprop', 'ro.product.model']).trim() || model } catch {}
      return { id, name: name ?? id }
    })
}

// Defined AVDs, plus why the answer is empty when it is. `emulator -list-avds`
// failing and there genuinely being no AVDs look identical from the outside,
// and the two need very different fixes — a runner whose qemu cannot load its
// shared libraries reported "no AVD defined" for seventeen minutes before this
// distinction existed.
export function listAvds() {
  const bin = emulatorPath()
  if (!bin) return { avds: [], error: 'no emulator binary found (set ANDROID_HOME)' }
  try {
    return { avds: sh(bin, ['-list-avds']).split('\n').map((s) => s.trim()).filter(Boolean), error: null }
  } catch (e) {
    return { avds: [], error: `emulator -list-avds failed: ${(e.stderr || e.message || '').trim().split('\n').slice(-2).join(' ')}` }
  }
}

// Wait for the device to finish booting. `wait-for-device` only waits for adb
// to see it; the package manager is not up until sys.boot_completed flips, and
// installing before that fails in ways that read as a broken APK.
async function waitBootComplete(id, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs
  adbOk(id, ['wait-for-device'])
  while (Date.now() < deadline) {
    let done = ''
    try { done = adb(id, ['shell', 'getprop', 'sys.boot_completed']).trim() } catch {}
    if (done === '1') {
      // dismiss the lock screen; a freshly booted AVD comes up locked and every
      // capture would otherwise be the lock screen
      adbOk(id, ['shell', 'input', 'keyevent', '82'])
      adbOk(id, ['shell', 'wm', 'dismiss-keyguard'])
      quietSystemDialogs(id)
      return true
    }
    await sleep(2000)
  }
  return false
}

export async function ensureBooted(config) {
  const booted = listBooted()
  if (booted.length) {
    const pick = config.device ? booted.find((d) => d.name === config.device) ?? booted[0] : booted[0]
    log(`android device already available: ${pick.name} (${pick.id})`)
    await waitBootComplete(pick.id, 60000)
    return pick
  }
  const bin = emulatorPath()
  if (!bin) throw new Error('no Android device connected and no emulator binary found (set ANDROID_HOME)')
  const { avds, error } = listAvds()
  if (error) throw new Error(`no Android device connected, and the emulator could not be queried — ${error}`)
  if (!avds.length) throw new Error('no Android device connected and no AVD defined — create one with avdmanager')
  const avd = avds.find((a) => a === config.device) ?? avds[0]
  log(`booting AVD ${avd}`)
  // detached: the emulator runs for the whole session and must outlive this call
  const proc = spawn(bin, ['-avd', avd, '-no-snapshot', '-no-boot-anim', '-no-audio',
    ...(process.env.SCREENMAP_EMULATOR_WINDOW === '1' ? [] : ['-no-window']),
    '-gpu', 'swiftshader_indirect'], { detached: true, stdio: 'ignore' })
  proc.unref()
  const deadline = Date.now() + 300000
  while (Date.now() < deadline) {
    const now = listBooted()
    if (now.length) { await waitBootComplete(now[0].id); return now[0] }
    await sleep(3000)
  }
  throw new Error(`AVD ${avd} did not come up within 5 minutes`)
}

// An emulator on software rendering is slow enough that the launcher and the app
// itself trip Android's "isn't responding" watchdog. The dialog is modal, it is
// drawn over whatever is on screen, and nothing dismisses it — so it lands in
// every remaining capture of the run. The first green Android baseline came back
// with all eight screens behind a grey scrim reading "Pixel Launcher isn't
// responding". This is the switch that stops the system drawing them at all;
// `dismissAlert()` in replay.mjs handles one that still gets through.
export function quietSystemDialogs(id) {
  adbOk(id, ['shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1'])
  adbOk(id, ['shell', 'settings', 'put', 'global', 'anr_show_background', '0'])
  // long-press power / "system UI isn't responding" variants come from the same
  // watchdog and are suppressed by the same setting on modern images
  adbOk(id, ['shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed'])
}

// SystemUI demo mode is Android's answer to `simctl status_bar override`:
// identical clock/battery/signal on every capture, so base and head
// screenshots only differ where the app differs.
export function freezeStatusBar(id) {
  adbOk(id, ['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'])
  const demo = (...kv) => adbOk(id, ['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...kv])
  demo('-e', 'command', 'enter')
  demo('-e', 'command', 'clock', '-e', 'hhmm', '0941')
  demo('-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false')
  demo('-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4')
  demo('-e', 'command', 'network', '-e', 'mobile', 'show', '-e', 'datatype', 'none', '-e', 'level', '4')
  demo('-e', 'command', 'notifications', '-e', 'visible', 'false')
}

export function findBuiltApp(projectDir) {
  const roots = [
    path.join(projectDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug'),
    path.join(projectDir, 'android', 'app', 'build', 'outputs', 'apk', 'release'),
  ]
  for (const d of roots) {
    if (!fs.existsSync(d)) continue
    const apk = fs.readdirSync(d).find((f) => f.endsWith('.apk'))
    if (apk) return path.join(d, apk)
  }
  return null
}

function buildToolsDirs() {
  const dirs = []
  for (const root of sdkRoots()) {
    const bt = path.join(root, 'build-tools')
    if (!fs.existsSync(bt)) continue
    for (const v of fs.readdirSync(bt).sort().reverse()) dirs.push(path.join('build-tools', v))
  }
  return dirs.length ? dirs : ['build-tools']
}

// Package name out of the APK. aapt2 is the modern tool and ships in every
// build-tools release; aapt is the fallback for older SDK installs.
export function appIdOf(apkPath) {
  const aapt2 = sdkTool('aapt2', ...buildToolsDirs())
  if (aapt2) {
    try { return sh(aapt2, ['dump', 'packagename', apkPath]).trim().split('\n')[0] } catch {}
  }
  const aapt = sdkTool('aapt', ...buildToolsDirs())
  if (aapt) {
    try { return sh(aapt, ['dump', 'badging', apkPath]).match(/package: name='([^']+)'/)?.[1] ?? null } catch {}
  }
  throw new Error('cannot read the package name from the APK (no aapt2/aapt) — set packageName in .screenmap/config.json')
}

// -r reinstall, -t allow test-only builds (EAS development APKs are marked
// test-only), -g pre-grant every runtime permission the manifest declares —
// which is most of grantPrivacy's job done at install time.
export function installApp(id, apkPath) {
  const bin = adbPath()
  const run = () => spawnSync(bin, ['-s', id, 'install', '-r', '-t', '-g', apkPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let r = run()
  let out = (r.stdout || '') + (r.stderr || '')
  // a signature clash with a previously installed build is the common case
  if ((r.status !== 0 || /Failure/.test(out)) && /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/.test(out)) {
    log('signature mismatch — uninstalling the previous build and retrying')
    adbOk(id, ['uninstall', appIdOf(apkPath)])
    r = run()
    out = (r.stdout || '') + (r.stderr || '')
  }
  if (r.status !== 0 || /Failure/.test(out)) throw new Error(`adb install failed: ${out.trim().slice(-400)}`)
}

export function terminate(id, pkg) { adbOk(id, ['shell', 'am', 'force-stop', pkg]) }
export function launch(id, pkg) {
  // monkey launches the default LAUNCHER activity without us having to know its
  // name, which varies between bare and managed Expo projects
  adb(id, ['shell', `monkey -p ${shellQuote(pkg)} -c android.intent.category.LAUNCHER 1`])
}
export function openUrl(id, url, pkg) {
  adb(id, ['shell', `am start -a android.intent.action.VIEW -d ${shellQuote(url)}${pkg ? ` ${shellQuote(pkg)}` : ''}`])
}

export function screenshot(id, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  freezeStatusBar(id) // tooling in between (argent) can drop demo mode
  const bin = adbPath()
  // exec-out keeps the PNG byte-exact; `adb shell screencap` mangles newlines
  const r = spawnSync(bin, ['-s', id, 'exec-out', 'screencap', '-p'], { maxBuffer: 128 * 1024 * 1024 })
  if (r.status !== 0 || !r.stdout?.length) throw new Error(`screencap failed: ${(r.stderr || '').toString().slice(-300)}`)
  fs.writeFileSync(outPath, r.stdout)
  return outPath
}

// `adb install -g` already granted everything in the manifest; this covers a
// device where that flag was refused, so a mis-tap can never summon a runtime
// permission dialog that then sits over every later capture.
const RUNTIME_PERMS = ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
  'READ_CONTACTS', 'WRITE_CONTACTS', 'READ_CALENDAR', 'WRITE_CALENDAR', 'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO',
  'POST_NOTIFICATIONS', 'ACTIVITY_RECOGNITION']
export function grantPrivacy(id, pkg) {
  const granted = []
  for (const p of RUNTIME_PERMS) if (adbOk(id, ['shell', 'pm', 'grant', pkg, `android.permission.${p}`])) granted.push(p)
  if (granted.length) log(`pre-granted ${granted.length} runtime permissions`)
}

// expo-dev-menu's Android preferences live in the app's own SharedPreferences,
// which only `run-as` can reach and only for a debuggable build. Best-effort by
// design: when it fails the dev-menu floating button stays in the captures,
// which is cosmetic, so nothing here is allowed to abort a run.
//
// NOTE: unlike the iOS `defaults write` path, this has NOT been verified
// against a running emulator — see "Known limits" in the README.
export function muteDevMenu(id, pkg) {
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n<boolean name="isOnboardingFinished" value="true" />\n<boolean name="showsAtLaunch" value="false" />\n<boolean name="showFab" value="false" />\n</map>`
  const target = `/data/data/${pkg}/shared_prefs/expo.modules.devmenu.sharedpreferences.xml`
  const inner = `mkdir -p /data/data/${pkg}/shared_prefs && printf %s ${shellQuote(xml)} > ${target}`
  const ok = adbOk(id, ['shell', `run-as ${shellQuote(pkg)} sh -c ${shellQuote(inner)}`])
  if (!ok) log('could not mute the dev menu (run-as unavailable) — its overlay may appear in captures')
}

// Nothing to approve: Android resolves a custom scheme straight to the app.
export function approveScheme() {}
// …and so there is no prompt to tap through either.
export function nudgeOpenPrompt() { return false }

// The emulator's `localhost` is the emulator, not the host. `adb reverse` maps
// the device's port back to the runner's, which also works over USB — unlike
// the 10.0.2.2 alias, which is emulator-only.
export function connectMetro(id, port) {
  if (!adbOk(id, ['reverse', `tcp:${port}`, `tcp:${port}`])) {
    log(`adb reverse tcp:${port} failed — the app may not reach Metro`)
    return false
  }
  log(`adb reverse tcp:${port} → host`)
  return true
}

export function diagnostics(id, dir) {
  fs.mkdirSync(dir, { recursive: true })
  try { screenshot(id, path.join(dir, 'connect-timeout.png')) } catch {}
  try { fs.writeFileSync(path.join(dir, 'packages.txt'), adb(id, ['shell', 'pm', 'list', 'packages'])) } catch {}
  try { fs.writeFileSync(path.join(dir, 'logcat.txt'), adb(id, ['logcat', '-d', '-t', '500'])) } catch {}
}
