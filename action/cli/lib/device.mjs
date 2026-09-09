// Platform-agnostic session: Metro, the dev-client connect loop, and the
// capture helpers, driving whichever device driver the run asked for.
//
// The two drivers (lib/sim.mjs, lib/android.mjs) expose the same primitives;
// everything that is genuinely shared — starting Metro, nudging the dev client
// onto it, waiting for the first bundle, the diagnostics dump on failure —
// lives here so neither platform can quietly drift from the other.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { sh, sleep, log } from './util.mjs'
import { ocrAvailable } from './ocr.mjs'
import * as ios from './sim.mjs'
import * as android from './android.mjs'

export const DRIVERS = { ios, android }
export const PLATFORMS = Object.keys(DRIVERS)

export function driverFor(platform) {
  const d = DRIVERS[platform]
  if (!d) throw new Error(`unknown platform "${platform}" — expected ${PLATFORMS.join(' | ')}`)
  return d
}

// Capture on whichever device a session is bound to. replay.mjs takes one of
// these rather than a bare id, so a flow replays identically on either platform.
export const screenshot = (device, outPath) => device.driver.screenshot(device.id, outPath)

// Metro in the background. Resolves `ready` when the server listens, and
// exposes `bundled` (first successful bundle) for the caller to await after
// launching the app.
export function startMetro(projectDir, port = 8081) {
  const cli = fs.existsSync(path.join(projectDir, 'node_modules', 'expo', 'bin', 'cli'))
    ? [path.join(projectDir, 'node_modules', 'expo', 'bin', 'cli'), 'start', '--port', String(port)]
    : null
  if (!cli) throw new Error('expo not installed in project (node_modules/expo missing)')
  const proc = spawn('node', cli, { cwd: projectDir, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let readyRes, bundledRes
  const ready = new Promise((r) => (readyRes = r))
  const bundled = new Promise((r) => (bundledRes = r))
  const onData = (d) => {
    const s = d.toString()
    out += s
    if (/Waiting on http:\/\/localhost:\d+/.test(out)) readyRes(true)
    if (/Bundled\s|Bundling complete|\d+% \(\d+\/\d+\)/.test(out) && /Bundled\s|Bundling complete/.test(out)) bundledRes(true)
    if (/(^|\n)\s*(error|Error|ERROR)/.test(s)) log('metro:', s.trim().slice(0, 300))
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  proc.on('exit', (code) => { log(`metro exited (${code})`); readyRes(false); bundledRes(false) })
  const stop = () => { try { proc.kill('SIGTERM') } catch {} }
  return { proc, ready, bundled, stop, output: () => out }
}

export async function waitFor(promise, ms, label) {
  const t = await Promise.race([promise, sleep(ms).then(() => 'timeout')])
  if (t === 'timeout') throw new Error(`timed out waiting for ${label} (${ms}ms)`)
  return t
}

// Boot the whole stack: device, app, Metro, first bundle. Returns a session
// with capture helpers; call session.close() at the end.
export async function openSession({ projectDir, config, scheme, platform = 'ios' }) {
  const driver = driverFor(platform)
  const { id, name } = await driver.ensureBooted(config)
  driver.freezeStatusBar(id)
  const appPath = config.appPath ?? driver.findBuiltApp(projectDir)
  if (!appPath) {
    throw new Error(platform === 'android'
      ? 'no built dev client found under android/app/build/outputs/apk — build it first (expo run:android --no-bundler) or pass app_path'
      : 'no built dev client found under ios/build — build it first (expo run:ios --no-bundler)')
  }
  const appId = config.appId ?? driver.appIdOf(appPath)
  driver.installApp(id, appPath)
  driver.grantPrivacy(id, appId)
  driver.muteDevMenu(id, appId)
  driver.approveScheme(id, scheme, appId)
  await sleep(3000) // let the launcher settle (iOS resprings SpringBoard above)
  // resolve the OCR backend now — compiling the Vision helper lazily inside the
  // connect loop starves a small runner while Metro bundles, and simctl openurl
  // then times out
  ocrAvailable()
  const metro = startMetro(projectDir, config.metroPort)
  await waitFor(metro.ready, 120000, 'Metro to start')
  // the emulator's localhost is not the host's — open the tunnel before the
  // dev client is ever pointed at Metro (no-op on iOS)
  driver.connectMetro(id, config.metroPort)
  driver.terminate(id, appId)
  await sleep(800)
  driver.launch(id, appId)
  await sleep(3000)
  // the dev client opens on its launcher; a deep link routes it to Metro.
  // Re-nudge every 15s — a cold device sometimes swallows the first one.
  // expo-dev-client's connect URL loads a specific Metro without a tap.
  const connectUrl = `${scheme}://expo-development-client/?url=${encodeURIComponent(`http://localhost:${config.metroPort}`)}`
  const deadline = Date.now() + 300000
  let bundledOk = false
  let nudges = 0
  while (Date.now() < deadline) {
    // after a few foreground nudges, cold-start into the link instead: opening
    // a URL on a terminated app launches it straight into the deep link,
    // skipping any launcher race
    if (nudges > 0 && nudges % 3 === 0) { try { driver.terminate(id, appId) } catch {}; await sleep(800) }
    // opening a URL can time out (POSIX 60) when the device is under load — a
    // missed nudge, not a fatal error
    try { driver.openUrl(id, connectUrl, appId) } catch (e) { log('openurl nudge failed:', e.message.split('\n')[0]) }
    nudges++
    const r = await Promise.race([metro.bundled, sleep(15000).then(() => 'tick')])
    if (r === true) { bundledOk = true; break }
    if (r === false) break
    log('waiting for the first JS bundle…')
    try { driver.nudgeOpenPrompt(id, projectDir) } catch {}
  }
  if (!bundledOk) {
    log('metro tail:\n' + metro.output().split('\n').slice(-25).join('\n'))
    try {
      const diagDir = path.join(projectDir, '.screenmap', 'out', 'ci', 'diag', platform)
      driver.diagnostics(id, diagDir)
      fs.writeFileSync(path.join(diagDir, 'metro.log'), metro.output())
      let status = 'curl failed'
      try { status = sh('curl', ['-s', '-m', '5', `http://localhost:${config.metroPort}/status`]) } catch {}
      fs.writeFileSync(path.join(diagDir, 'metro-status.txt'), status)
      log('connect diagnostics written to', diagDir)
    } catch (e) { log('diagnostics failed:', e.message) }
    metro.stop()
    throw new Error(`timed out waiting for first JS bundle (${platform})`)
  }
  await sleep(config.waits.boot)
  log(`session ready: ${appId} on ${name} (${id}), Metro :${config.metroPort}`)
  let firstVisit = true
  const session = {
    platform, driver, id, udid: id, appId, bundleId: appId, scheme, config,
    deviceName: name ?? config.device,
    screenshot(outPath) { return driver.screenshot(id, outPath) },
    async visit(url, outPath, waitMs) {
      try { driver.openUrl(id, url, appId) } catch { await sleep(2000); driver.openUrl(id, url, appId) } // one retry for transient timeouts
      await sleep(waitMs ?? config.waits.transition)
      // dev builds often show a one-off toast right after the bundle loads;
      // give the very first capture extra time to settle
      if (firstVisit) { await sleep(config.waits.settle ?? 6000); firstVisit = false }
      driver.screenshot(id, outPath)
      return outPath
    },
    async relaunch() {
      driver.terminate(id, appId); await sleep(800); driver.launch(id, appId); await sleep(4000)
      firstVisit = true // dev builds re-show their load-time toast after a relaunch
    },
    close() { metro.stop() },
  }
  return session
}
