# .scrmap bundle format (v3)

A `.scrmap` file is a plain **zip** containing everything needed to render an application's
navigation map: the graph, screenshots, capture verdicts, and replayable flows.
It is the *interchange* format — the screenmap skill's working directory
(`.screenmap/out/` with `graph.json`, `capture-status.json`, `flows/`, `screens/`) is the
append-friendly *working* format, and `pack-map.mjs` merges it into a bundle.

The format is producer-agnostic: nothing in it is expo-specific. Any tool that can
enumerate screens, capture them, and describe transitions can emit a bundle.

**Flows are [argent](https://argent.swmansion.com) flow YAML** — Software Mansion's
agentic mobile toolkit — so every flow in a bundle replays headlessly, no LLM in the
loop: `argent flow run .screenmap/out/flows/<name>.yaml`. A `.meta.json` sidecar per flow
carries the cartography argent doesn't model: route ids, per-step screen hops,
capture files, and human target labels.

```
myapp-2026-08-08.scrmap        (zip)
├── manifest.json              # formatVersion: 2, flowFormat: "argent"
├── map.json
├── screens/*.png              # slug-named; state variants as <slug>--<state>.png
└── flows/
    ├── <name>.yaml            # argent flow — runnable via `argent flow run`
    └── <name>.meta.json       # sidecar: route, screen hops, captures, labels
```

(v1 bundles inlined JSON flows in `map.json`; viewers should keep reading them.)

## Platforms (`formatVersion: 3`)

A bundle captured on one platform is exactly the v2 layout above and stays
`formatVersion: 2` — there is no platform axis to add. A bundle captured on
several becomes `formatVersion: 3`:

```
├── manifest.json              # app.platforms lists them, in capture order
├── map.json                   # each node gains `captures`
└── screens/
    ├── ios/*.png
    └── android/*.png
```

`manifest.app` keeps `platform` and `device` pointing at the **first** platform,
and every node keeps a `capture` mirroring that same platform, so a v2 reader
renders a v3 bundle as a single-platform map rather than failing or showing every
screen as missing. A v3-aware reader uses `app.platforms` and `node.captures`:

```jsonc
"app": {
  "platform": "ios-simulator",       // first platform, for v2 readers
  "device": "iPhone 17 Pro",         // ditto
  "platforms": [
    { "platform": "ios", "label": "ios-simulator", "device": "iPhone 17 Pro" },
    { "platform": "android", "label": "android-emulator", "device": "Pixel 7" }
  ]
}
```

```jsonc
"captures": {                        // same shape as `capture`, one per platform
  "ios":     { "status": "ok", "screenshot": "screens/ios/Profile.png", "states": [...] },
  "android": { "status": "error-boundary", "note": "crashes on deep link",
               "screenshot": "screens/android/Profile.png", "states": [] }
}
```

Status is per platform, which is the point: a screen that renders on iOS and
crashes on Android is one node with two verdicts, not two maps to compare by eye.
`capture-status.json` is keyed by platform first in a v3 bundle
(`{"android": {"<routeId>": {…}}}`) and by route id in a v2 one.

## Variants

A bundle can hold capture combinations with independent platform, OS version,
language and appearance fields. Variant ids identify the files and interaction
inventories; they do not combine the viewer controls. It remains
`formatVersion: 3`. Older id/label-only variants and platform-only bundles remain
readable. Never infer an OS version from a device name or the viewing computer.

```
├── manifest.json              # `variants` lists them, in capture order
├── map.json                   # each node gains `captures`, keyed by variant id
└── screens/
    ├── en-light/*.png
    └── ar-dark/*.png
```

```jsonc
"variants": [
  { "id": "en-light", "label": "en-light" },
  { "id": "ar-dark",  "label": "Arabic · dark" }
]
```

```jsonc
"captures": {                        // same shape as `capture`, one per variant
  "en-light": { "status": "ok", "screenshot": "screens/en-light/Profile.png", "states": [...] },
  "ar-dark":  { "status": "ok", "screenshot": "screens/ar-dark/Profile.png", "states": [] }
}
```

`capture` mirrors the first variant, so a reader that does not know variants shows
the first one. `capture-status.json` is keyed by variant id first
(`{"ar-dark": {"<routeId>": {…}}}`). Pack with
`pack-map.mjs <project> --variants en-light,ar-dark`.

## Capture combinations and synchronized comparison

Declare observed metadata in `.screenmap/config.json` before packing:

```json
{"variants":[
  {"id":"ios18-en-light","platform":"ios","osVersion":"18","language":"en","appearance":"light","device":"iPhone"},
  {"id":"ios26-ar-dark","platform":"ios","osVersion":"26","language":"ar","appearance":"dark","device":"iPhone"},
  {"id":"ios27-en-light","platform":"ios","osVersion":"27","language":"en","appearance":"light","device":"iPhone"},
  {"id":"android16-en-light","platform":"android","osVersion":"16","language":"en","appearance":"light","device":"Pixel"}
]}
```

Put finalized images in `screens/<id>/`, with status and interaction entries keyed
by the same id. Run `pack-map.mjs <project> --platforms ios,android --variants
<comma-separated ids>`. Multiple platforms with variants require all four axis
fields for every id. OS versions are strings, so new releases need no viewer
code change. Metadata is retained in `manifest.variants`.

The viewer resolves an exact axis combination. A missing combination, route image
or named Capture State displays **Not captured**; another image is never substituted.
Only the legacy ids `en-light`, `en-dark`, `ar-light` and `ar-dark` supply implicit
language and appearance. Missing metadata displays **Unspecified**. Opaque ids
and duplicate axis combinations remain selectable through **Capture**.

Prototype **Compare** displays two to four independently selected capture panels.
Every panel uses its own saved image, hotspots and normalized coordinates. One
shared Visit drives screen and Capture State. Tapping a verified hotspot in any
panel moves all panels to that logical destination; Back, Close and recorded
scroll positions use the same shared navigation. Panels without that destination
or state show the missing-capture message. State names must identify the same
logical state across captures. No coordinates or translated button labels are
broadcast between panels. Disabled/destructive controls remain inactive.

The URL stores independent `platform`, `osVersion`, `language`, `appearance`,
legacy `variant`, `compare=1` and JSON `panes` options, preserving other parameters.
`$unspecified` represents a selected unknown axis. Reload and browser Back/Forward
restore these options. In-page Back/Close retains current panel selections while
returning to the previous shared Visit. Comparison replays captured navigation;
it does not provision runtimes or create missing screenshots.

## Prototype links

Optional `.screenmap/out/hotspots.json` binds clickable areas to exact captures:

```json
{
  "version": 1,
  "captures": [{
    "node": "Home",
    "variant": "en-light",
    "sourceSha256": "<SHA-256 of the screenshot file>",
    "links": [{ "label": "Profile", "to": "Profile", "targetState": "menu", "rect": [0.7, 0.1, 0.2, 0.1] }],
    "scroll": { "next": "scrolled" },
    "viewport": { "width": 390, "height": 844 }
  }]
}
```

`rect` is `[x, y, width, height]`, normalized to the screenshot. Set `state`
on a capture entry to bind it to `slug--state.png`; omit it for the base.
An optional `targetState` opens a named state on the destination. Use
`{"label":"Back","action":"back","rect":[...]}` for a Back hotspot.
Add `"fallbackTo":"Home"` to use that captured node when the prototype has no
previous visit, such as a directly opened modal. The fallback replaces the
current visit; it does not add another history entry. Without a fallback, a
Back hotspot is disabled when there is no previous visit. `fallbackTo` is
valid only for Back hotspots and must name a node with a base screenshot
in the same variant or platform.
`scroll.next` and `scroll.previous` name other captured positions on the same
screen; `$base` names the base capture. For a tall screenshot, `viewport`
sets the phone frame's positive width and height in the same units, so the
image can scroll inside it. For a
single-platform bundle, use the platform id as `variant`. The packer adds
`capture.prototype` only when the image hash matches. It excludes links with
unknown destinations or rectangles outside the image. Recheck coordinates and
update the hash after changing a screenshot. The viewer checks the hash again
when it opens a bundle. Older bundles need no hotspots.

## manifest.json

```jsonc
{
  "formatVersion": 1,
  "generator": "screenmap/1.0",
  "app": {
    "name": "bluesky",            // display name
    "scheme": "bluesky",          // deep-link scheme, null if unknown
    "platform": "ios-simulator",
    "device": "iPhone 17 Pro",    // device captures were taken on
    "mode": "react-navigation"    // the route provider that discovered the screens:
                                  //   expo-router | react-navigation | custom | …
                                  //   (see docs/route-providers.md)
  },
  "generatedAt": "2026-08-06T14:00:00.000Z"
}
```

## map.json

```jsonc
{
  "nodes": [{
    "id": "Profile",                    // unique; route id from the producer
    "title": "Profile",                 // display label — ALWAYS present; use this to
                                        //   label a node, not urlPath
    "urlPath": "/profile/:name",        // deep-link path pattern; NULL when the screen
                                        //   has no URL (normal in react-navigation)
    "reach": "deep-link",               // "deep-link" | "navigation-only" | "unknown"
    "file": "src/view/screens/Profile.tsx",  // source file, if known
    "slug": "Profile",                  // screenshot base name
    "group": "profile",                 // visual grouping (navigator dir / path segment)
    "navigator": "react-navigation",    // Stack | Tabs | Drawer | Slot | react-navigation | null
    "params": ["name"],
    "presentation": null,               // e.g. "modal"
    "stateHints": [{ "type": "bottom-sheet", "lib": "app-dialog", "snapPoints": null }],
    "capture": {
      "status": "ok",                   // ok | empty-state | not-found | error-boundary | loading | auth-wall | missing
      "note": null,                     // present when status != ok
      "needsNavigation": false,         // true → unreachable by bare deep link
      "screenshot": "screens/Profile.png",       // null if missing
      "states": [                       // runtime state variants
        { "name": "menu", "screenshot": "screens/Profile--menu.png" }
      ]
    }
  }],
  "edges": [{
    "from": "Home", "to": "StarterPack",       // node ids; "to" null = unresolved
    "raw": "navigate('StarterPack')",          // source expression
    "target": "/starter-pack/:name/:rkey"
  }],
  "flows": []                          // v2: always empty — flows live in flows/*.yaml
}
```

## Flows: argent YAML + sidecar

Each flow is a pair of files. The **YAML** is a standard [argent flow](https://argent.swmansion.com)
(directives: `launch`, `tap`, `type`, `scroll-to`, `await`, `assert`, `wait`, `snapshot`,
`run`, `when`, `tool`, …). All coordinates are **normalized 0–1**. Deep links use the
`open-url` tool step. Comments carry human labels for coordinate taps.

```yaml
# Open the profile … menu bottom sheet
steps:
  - tool: open-url
    args:
      url: "bluesky://profile/bsky.app"
  - wait: 2000
  # '…' overflow button in profile header
  - tap: { x: 0.9204, y: 0.2037 }
```

Prefer **selector taps** (`tap: Login`, `tap: { id: submit }`) when recorded via argent's
own tools — they survive layout changes. Coordinate taps are the fallback for recordings
made without accessibility-tree access.

The **`.meta.json` sidecar** maps YAML step indexes (0-based, sparse) to cartography:

```jsonc
{
  "formatVersion": 2,
  "name": "profile-open-menu",
  "title": "Open the profile … menu bottom sheet",
  "route": "Profile",                  // node id the flow targets
  "device": "iPhone 17 Pro",
  "recordedAt": "2026-08-06T13:00:00.000Z",
  "steps": {
    "6": { "target": "'…' overflow button in profile header", // durable human label
           "screen": "Profile",        // route id the app is on AFTER this step —
                                       // REQUIRED on navigating taps/swipes
           "capture": "Profile--menu.png" }  // screenshot taken after this step;
                                             // state variants attach to nodes this way
  },
  "landmarks": ["Share", "Mute", "Block", "Report"],  // words visible on the arrival
                                       // screen; CI replays OCR-check them to
                                       // detect drift (optional, recommended)
  "result": "Bottom sheet with Share/Mute/Block/Report options"
}
```

## Semantics

- **Node ↔ flow tie**: a node's canonical flow is the one with `route == node.id`
  (producers should emit at least a trivial deep-link flow per reachable node).
  Flows whose YAML contains only `open-url` / `wait` steps are **deterministic
  deep links**; flows with `tap` / `type` / gesture steps are **interactive** —
  both replay via `argent flow run`, no agent needed.
- **State variants** attach extra captures to a node; `screens/<slug>--<state>.png`.
- **Labelling**: use `title`. It is always present, while `urlPath` is null for any
  screen the producer could not give a URL — a react-navigation screen absent from the
  linking config, for instance. Bundles packed before `title` existed have neither
  field set on some nodes; fall back `title ?? urlPath ?? id`.
- **reach** is the producer's static verdict on how a screen can be opened, decided
  before any capture runs: `navigation-only` means there is no deep link at all, and
  the capture stage must navigate to it rather than visiting a URL. It seeds
  `capture.needsNavigation`, which remains the *observed* verdict and can also be set
  by an agent that found a screen unreachable in practice.
- **needsNavigation** nodes cannot be reached by bare deep link; their flow or note
  explains the in-app path.
- Viewers must ignore unknown fields and reject `formatVersion` they don't support.


## First-map interaction inventory

The skill and CI capture agent inventory visible controls during the first capture pass, including navigation headers, overflow menus and dismissal states in every language. `scripts/record-interactions.mjs` binds these observations to the final screenshot bytes. See [the capture workflow](../plugins/screenmap/skills/screenmap/references/interactions.md) for recording steps and the controls schema.

An optional root `interactions.json` stores `{ "version": 1, "captures": [...] }`. Both map producers retain this file for incremental reuse and compile valid observations into `capture.prototype.links`; a project does not need an authored `hotspots.json`. Existing curated hotspots take precedence; conflicting destinations are unresolved. A control's normalized frame comes from that variant's observed layout. The compiler never mirrors coordinates or guesses menu destinations.

Each capture gains `interactions: { status, sourceSha256, controls, reason? }`. Each control has an `id`, `label`, `kind`, `rect`, `status` (`linked` or `unresolved`) and an optional unresolved `reason`. Capture status is `complete`, `partial`, or `missing`. A complete inventory with zero navigation controls is valid for a screen with none. Missing screenshots or inventories, stale hashes and invalid destination captures cannot establish complete navigation.

Controls may include boolean `disabled` and `destructive` flags. Either flag set to `true` keeps the control unresolved and removes matching Prototype hotspots, including curated links. The recorder requires a reason-only outcome for flagged controls. Packers and the viewer enforce the flags independently; malformed flag values also block the control. Availability and action evidence supply the flags, without label-based classification. Existing inventories that omit both flags remain compatible.

`map.interactionCoverage` summarizes captures and controls across all axes. `interaction-coverage.json` stores the same report in the bundle and working output. The viewer checks screenshot hashes again and downgrades stale reports. Prototype displays the selected capture's report with unresolved reasons. Completion describes captured navigation; it does not mean backend operations or destructive controls are simulated.

A Back link may set `scope: "screen"` to close its screen across intermediate saved states. The inventory compiler assigns this scope to Close controls. Without the scope, Back returns to the previous Visit. Both use `fallbackTo` when no matching history exists.

## Capture availability

The viewer derives availability from image files present in the loaded bundle.
Axis choice status dots and tooltips show compatible saved captures for the current screen and
Capture State while preserving the other selected axes. **Available captures**
lists each stored descriptor, its saved base-screen and named-state counts, and
whether the current Visit is captured. Selecting a row applies its complete
combination in one URL history entry. Configured combinations with no image and absent language/appearance combinations
stay visible as **Not captured** with zero counts. These statuses describe the loaded bundle, not a
live capture process or runtime connection.

## Gallery review

**Gallery** cycles through every actual saved base screenshot and named Capture
State for the exact selected capture combination, including error/auth captures.
Routes follow map order; Base precedes named states in name order. Missing images
are skipped; images from another combination are never substituted. The counter
shows the current capture and total. Previous/Next and Left/Right keys wrap after
the last capture; keyboard browsing yields to input and select controls.

Play/Pause controls automatic rotation with visible 2s, 5s and 10s choices.
`mode=gallery`, `screen`, `state` and `speed` persist in the URL with capture axes
and existing parameters. Playback starts paused on reload/shared links and stops
on manual navigation, capture changes, mode changes, browser navigation or a
hidden tab. Gallery shows saved images without executable prototype hotspots.
The optional viewer needs no connection to an app or capture device.
