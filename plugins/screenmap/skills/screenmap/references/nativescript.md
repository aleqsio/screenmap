# screenmap on a NativeScript app

Read this when `graph.json` says `"mode": "nativescript"`. Everything in SKILL.md
still applies; these are the places a NativeScript app differs.

## Phase 1 — deep links come from `routes.links`

A NativeScript app has no linking config: its deep links are whatever its own URL handler does with `<scheme>://…`. So every route starts `navigation-only`, and `.screenmap/config.json` says which ones a link opens — `{"routes":{"links":{"talk/today":"today","settings":true}}}` (route id → path after the scheme, `true` for the route's own URL, `"*"` as the default). Read the app's URL-handling code (grep for the scheme from `graph.json`, `openURL`, `activityNewIntentEvent`) and propose that map to the user before the sweep; without it the deterministic lane captures nothing and every screen is on your tap queue. When `graph.json` has `"scheme": null` the app registers no URL scheme at all: there is nothing to deep-link, so capture the root (`urlPath: "/"`) by launching the app and reach every other screen by tapping in Phase 5b.

## Phase 3 — boot the app: no Metro, no dev client

**NativeScript apps, either platform.** There is no Metro and no dev client: the JS bundle ships inside the app, so building and installing it is the whole boot. If the app is already installed and running, use it as-is. Otherwise:

- iOS: `ns build ios` (a simulator build; minutes on the first run) writes `platforms/ios/build/Debug-iphonesimulator/<name>.app`. Install and launch it: `xcrun simctl install booted <that .app>` then `xcrun simctl launch booted <bundle id>` — the id is `id` in `nativescript.config.ts`. **Use `ns build`, not the output of `ns debug` / `ns run`:** with `@nativescript/vite` those produce a stub bundle that imports every module from the Vite dev server, so the app dies on launch ("HTTP import failed: http://…:5173/…") the moment that server is not running, and every capture is the simulator home screen. If the user's dev session is up you may use the installed app as-is, but never terminate and relaunch it headlessly. `ns run ios --no-hmr` is fine as long as it stays running. A debug build that launches to a blank screen with a framework assertion in the device log (a Solid app has done this, from a dev-only reactivity check) usually renders from `ns build ios --release`; the newest build under `platforms/ios/build` is the one picked up.
- Android: `ns build android` writes `platforms/android/app/build/outputs/apk/debug/app-debug.apk`; `adb install -r <apk>` then launch with the monkey command from the table. No `adb reverse` is needed. The same `ns build` rule applies.
- Then verify deep linking exactly as SKILL.md's Phase 3 does, with the scheme from `graph.json` (often the bundle id itself, e.g. `com.example.app://`). On iOS 18.3+ the first `simctl openurl` of a custom scheme raises an "Open in …?" prompt; pre-approve it the way CI does — `xcrun simctl spawn booted defaults write com.apple.launchservices.schemeapproval "com.apple.CoreSimulator.CoreSimulatorBridge-->SCHEME" -string BUNDLE_ID`, then `xcrun simctl spawn booted launchctl kickstart -k system/com.apple.SpringBoard` — or tap Open once.
- Skip the Metro steps of SKILL.md's iOS and Android sections; everything else (devices, screenshots, status bar) applies unchanged.

## Phase 5 — runtime states: the NativeScript hints

**drawer** / **native-menu** (NativeScript component apps) — a `<drawer>` in the screen, or a `menu=` / `contextMenu=` prop from `@nstudio/nativescript-menu`. Open the drawer with its hamburger (or a swipe from the left edge, starting well inside the screen) and capture `<slug>--drawer.png`; open a native menu by tapping (or long-pressing, for a context menu) the control that carries it and capture `<slug>--menu.png`, then dismiss by tapping outside.

**ns-modal** (NativeScript) — the hint names the component the screen opens (`ModalDialogService`, `NativeDialogService.open`, `showModal`), or the page module for Core apps. Read the screen's source for the control that opens it, `tap` it, capture `screens/<slug>--<component>.png` with the component name in kebab case minus its `Component` suffix (`ShareDialogComponent` → `<slug>--share-dialog.png`), then dismiss it (its close button, or swipe down on iOS). A `bottom-sheet` hint with a `component` and no snap points is a material bottom sheet: open it the same way and capture `<slug>--sheet.png`. Generic alert and confirm dialogs (`AlertDialogComponent`, `ConfirmDialogComponent`) are usually not worth a capture — skip them with a note.

## PR diff mode

The native surface is `App_Resources/`, `nativescript.config.*` and any
`@nativescript/*` or plugin dependency, so a change there is what the native
guard warns about. Since the JS ships inside the app, **every** side needs its
own `ns build`: at each `git checkout --detach <sha>`, rebuild (`ns build ios` /
`ns build android`), reinstall, and relaunch instead of restarting Metro.

## Web fallback

There is none: a NativeScript app has no web target, so without a simulator or
emulator stop at `--static`.
