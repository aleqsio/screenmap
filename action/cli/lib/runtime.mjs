// How the app's JavaScript reaches the device, and so how a session finds the
// build, boots it, and what a capture run can expect of it. Shared code asks
// the runtime; nothing outside this file branches on which one it is.
//
//   expo          a dev client that loads its bundle from Metro, steered there
//                 through the app's URL scheme
//   nativescript  the bundle ships inside the .app/.apk, so launching the build
//                 is the whole boot
import fs from 'node:fs'
import path from 'node:path'
import { sh, sleep } from './util.mjs'
import { connectDevClient } from './device.mjs'

const expo = {
  // the dev client is steered onto Metro through the scheme, so without one a
  // session only times out connecting
  requiresScheme: true,
  // a cold launch opens the dev client, not a screen of the app
  launchShowsRoot: false,
  agentNote: ', Metro is up',
  findBuild: ({ projectDir, driver }) => driver.findBuiltApp(projectDir),
  missingBuild: (platform) => (platform === 'android'
    ? 'no built dev client found under android/app/build/outputs/apk — build it first (expo run:android --no-bundler) or pass app_path'
    : 'no built dev client found under ios/build — build it first (expo run:ios --no-bundler)'),
  checkBuild() {},
  // expo-dev-menu's onboarding sheet would cover the first captures
  prepare({ driver, id, appId }) { driver.muteDevMenu(id, appId) },
  async boot(args) {
    const metro = await connectDevClient(args)
    return { note: `Metro :${args.config.metroPort}`, stop: metro.stop }
  },
}

const nativescript = {
  requiresScheme: false,
  launchShowsRoot: true,
  agentNote: ' with its JS bundled inside (a NativeScript app: no Metro, no dev client)',
  findBuild: ({ projectDir, platform }) => newestNativescriptBuild(projectDir, platform),
  missingBuild: (platform) => `no built app found under platforms/${platform === 'android' ? 'android/app/build/outputs/apk' : 'ios/build'} — build it first (ns build ${platform}) or pass app_path`,
  checkBuild(appPath, platform) {
    const devServer = bundleDevServer(appPath, platform)
    if (devServer) {
      throw new Error(
        `${path.basename(appPath)} is a \`ns debug\` build: its JavaScript loads from the Vite dev server at ${devServer}, ` +
        `so it only runs while that server is up. Build with \`ns build ${platform}\` and pass that .app/.apk (or leave appPath unset so it is discovered under platforms/).`
      )
    }
  },
  prepare() {},
  async boot({ driver, id, appId }) {
    driver.terminate(id, appId)
    await sleep(800)
    driver.launch(id, appId)
    return { note: 'bundled JS', stop() {} }
  },
}

export const RUNTIMES = { expo, nativescript }

// The route provider that read the app already said what it is; config.runtime
// overrides that, for a custom provider over a NativeScript app say.
export function runtimeFor(config, graph) {
  const id = config.runtime ?? (graph.mode === 'nativescript' ? 'nativescript' : 'expo')
  if (!RUNTIMES[id]) throw new Error(`unknown runtime "${id}" — expected ${Object.keys(RUNTIMES).join(' | ')}`)
  return RUNTIMES[id]
}

// `ns build` output. Debug and Release builds of one app can sit side by side
// and both carry their JS, so the one written last is the one meant (a Solid
// app whose debug build halts on a dev-only assertion renders from
// `ns build ios --release`).
function newestNativescriptBuild(projectDir, platform) {
  const [ext, dirs] = platform === 'android'
    ? ['.apk', ['debug', 'release'].map((c) => path.join(projectDir, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', c))]
    : ['.app', ['Debug', 'Release'].map((c) => path.join(projectDir, 'platforms', 'ios', 'build', `${c}-iphonesimulator`))]
  const builds = dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(ext)).map((f) => path.join(d, f)) : []))
  return builds.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null
}

// A NativeScript Vite dev build ships a stub bundle that imports every module
// over HTTP from the dev server; headless, it dies on the first import with
// the home screen as its only capture. Returns that server's origin, or null
// for a self-contained bundle.
function bundleDevServer(appPath, platform) {
  let src = null
  try {
    if (platform === 'android') src = sh('unzip', ['-p', appPath, 'assets/app/bundle.mjs'], { maxBuffer: 256 * 1024 * 1024 })
    else src = fs.readFileSync(path.join(appPath, 'app', 'bundle.mjs'), 'utf8')
  } catch { return null }
  return src.match(/https?:\/\/[\w.-]+:\d+(?=\/ns\/)/)?.[0] ?? null
}
