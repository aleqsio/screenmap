# Route providers

A **route provider** is the part of screenmap that knows how one framework
declares its screens. Everything downstream — capture, packing, diffing, the
viewer — consumes one graph shape and never learns which framework produced it.

```
plugins/screenmap/skills/screenmap/scripts/
  parse-routes.mjs          driver: detect → select → parse → normalize → validate → emit
  routes/
    registry.mjs            the provider list and the selection rules
    lib/project.mjs         walking, tsconfig aliases, import following, app config
    lib/hints.mjs           runtime-state hints (bottom sheets, modals)
    lib/graph.mjs           defaults, orphan detection, summary, validation
    providers/
      expo-router.mjs
      react-navigation.mjs
      nativescript.mjs
      custom.mjs
```

Shipped providers:

| id | what it reads | reach |
|---|---|---|
| `expo-router` | the `app/` route tree | `deep-link` — the file path *is* the URL |
| `react-navigation` | `<X.Screen>` registrations + the linking config | `mixed` — a screen has a URL only if the linking config gives it one |
| `nativescript` | Angular Router `Routes` arrays; Core XML pages + `Frame.navigate()`; or, for Octane, React, Vue, Svelte and Solid, the components the framework mounts, pushes, presents, hosts in `<frame>` tabs or registers in a route table | `mixed` — a screen has a URL only if `routes.links` in `.screenmap/config.json` gives it one |
| `custom` | a command you supply | `unknown` |

## Choosing a provider

By default the driver asks every provider to score the project and picks the
winner:

```bash
node scripts/parse-routes.mjs .            # detect and parse
node scripts/parse-routes.mjs . --detect   # show the scores, parse nothing
node scripts/parse-routes.mjs . --provider react-navigation
node scripts/parse-routes.mjs . --list-providers
```

```
0.95  expo-router        app/ contains a _layout route; expo-router in package.json
0.00  react-navigation   expo-router also present — deferring to it
0.00  nativescript       no nativescript.config.* and no @nativescript/core dependency
0.00  custom             opt-in only: set routes.provider = "custom"
```

Scores rather than booleans, because the frameworks genuinely overlap: an
expo-router app *uses* react-navigation underneath, and plenty of
react-navigation apps keep their source in `app/`. Two things follow:

- a provider below **0.4** is guessing, and the driver refuses rather than parse
  with the wrong one;
- two providers within **0.15** of each other are a tie, and the driver asks you
  to break it instead of picking silently.

Pin the choice in `.screenmap/config.json` when detection is wrong, or when you
want a repo to stop depending on detection at all:

```jsonc
{ "routes": { "provider": "react-navigation" } }
```

## The graph contract

A provider returns a fragment; `lib/graph.mjs` fills in the rest.

```jsonc
{
  "routes": [{
    "id": "Profile",              // required, unique
    "slug": "Profile",            // required, unique, filename-safe (screenshots are <slug>.png,
                                  //   so no "/" and no "--")
    "title": "Profile",           // human label; defaults to urlPath ?? id
    "urlPath": "/profile/:id",    // null when the screen has no URL
    "reach": "deep-link",         // "deep-link" | "navigation-only" | "unknown";
                                  //   defaults from whether urlPath is set
    "file": "src/screens/Profile.tsx",
    "params": ["id"],
    "navigator": "Stack",         // Stack | Tabs | TopTabs | Drawer | Slot | null
    "layoutDir": "Stack",         // grouping key; becomes `group` in the bundle
    "presentation": "modal",
    "stateHints": []
  }],
  "edges": [{ "from": "Feed", "to": "Profile", "raw": "navigate('Profile')", "target": "/profile/:id" }],
  "layouts": [{ "file": "src/navigation/RootNavigator.tsx", "dir": "Tabs", "navigator": "Tabs" }]
}
```

Any other top-level key rides along into `graph.json` as a diagnostic —
`appDir`, `linkingFile`, `screensResolved` are examples.

### Identity is not reachability

`urlPath` used to be both the label and the way in. That only holds for
file-based routing. A react-navigation screen registered on a navigator but
missing from the linking config has no URL at all, and a Flutter or SwiftUI
screen may never have one.

So a route carries all three separately:

- **`id`** — identity, stable across runs, what edges point at.
- **`title`** — what the map calls it. Always present.
- **`urlPath` + `reach`** — whether it can be deep-linked, and how.

`reach: "navigation-only"` is the load-bearing one. It makes
`deepLinkFor()` return null, keeps the capture stage from visiting the app root
and filing the home screen under the route's name, seeds
`capture.needsNavigation` in the bundle, and puts the screen on the agent's
work queue to be reached by tapping.

### NativeScript: deep links come from the project

Angular Router gives every screen a URL *inside* the app
(`/talk/(todayTab:today)`), but nothing says which of those a
`myapp://…` link opens: a NativeScript app registers its scheme in
`App_Resources` and maps URLs onto navigation in its own code. So the
`nativescript` provider starts every route navigation-only and reads the map
from `.screenmap/config.json`:

```jsonc
{
  "routes": {
    "links": {
      "talk/today": "today",          // myapp://today opens this route
      "chatbot/chat": "ask-mae/:id",  // params in the link join the route's own
      "settings": true,               // the route's own URL is the deep link
      "*": false                      // default for routes not listed (false = navigation-only)
    }
  }
}
```

Keys are route ids (the Angular path without the leading slash; the title
with outlet notation also works). `"*": true` says the app's handler mirrors
the router, so every route deep-links by its own URL. The app id, scheme and
name come from `nativescript.config.ts`, `App_Resources/iOS/Info.plist`
(resolving `${BUNDLE_IDENTIFIER}`-style xcconfig variables) and
`AndroidManifest.xml`; `ctx.appConfig()` does that reading, so a provider for
another NativeScript flavour gets it for free.

The Angular flavour follows `loadChildren` into lazy route files, named
outlets, `redirectTo` aliases, enum-valued paths and barrel re-exports; a
route with `children` becomes a layout (`Tabs` when its children sit in two or
more named outlets, else `Stack`), and links aimed at it resolve to the child
the router would land on. Edges come from `navigate([...])`,
`navigateByUrl('…')` and `nsRouterLink`, with `relativeTo` honoured. Modals and
material bottom sheets opened from a screen become `ns-modal` and
`bottom-sheet` state hints carrying the component name. The Core flavour reads
`<Page>` XML files as routes and `navigate({ moduleName })` / `showModal()`
calls as edges and hints.

The component flavours (Octane, React NativeScript, Vue, Svelte) have no route
table at all, so a screen is a component the framework **mounts** as a root,
**pushes**, or **presents** as a modal, and each flavour is one row of
spellings for those three calls:

| flavour | mount | push | modal |
|---|---|---|---|
| `octane` | `renderNativeScriptApp(view, X)` | — | a second root rendered into a view the same module `showModal`s |
| `react` | `ReactNativeScript.start(React.createElement(X))` / `start(<X/>)` | — | — |
| `vue` | `createApp(X)`, `render: h => h(X)` | `$navigateTo(X)` | `$showModal(X)` |
| `svelte` | `svelteNative(X)` / `svelteNativeNoFrame(X)` | `navigate({ page: X })` | `showModal({ page: X })` |
| `solid` | `startSolidApp({ root: X })`, `render(() => <X/>, view)` | `<Route name="N" component={X}/>` + `navigate('N')` (solid-navigation) | a `render` into a view the same module `showModal`s |

Two rules apply to every flavour on top of the table. A component that is the
sole child of a `<frame>` is a screen hosted by the component around it
(`layoutDir` is the host, `navigator` is `Tabs` when the host is a tab view),
which is how the tab bars in Vue and Solid apps come out. And a mounted root
whose file declares a route table is the router shell: a layout, not a screen,
with its `initialRouteName` as the app root.

The mount in the entry module (`package.json` `main`) is the app root and gets
`urlPath: "/"`; every other component is navigation-only until `routes.links`
says otherwise. In the Angular flavour the same `/` goes to whatever the empty
path resolves to (a `''` container's first child, or a redirect's target),
since that is the screen a launch shows. Edges come from the same calls found in a screen's own file or
one import hop out, so a helper like Octane's `openSettings(host)` links the
screen that imports it to the sheet it renders. A `<drawer>` in a screen and
`menu=` / `contextMenu=` props become `drawer` and `native-menu` state hints.
Angular, Octane, Vue and Solid are validated against real apps; React and
Svelte against fixtures only. Other renderers are not recognised yet —
prototype those as a custom provider.

An app that registers no URL scheme at all (many single-screen apps) parses
fine: `scheme` is null, `deepLinkTemplates.devBuild` is null, and the CI lane
captures the root by launching the app and everything else through flows or
the agent.

## Writing a provider

Two exported functions and a `meta`:

```js
export const meta = { id: 'flutter', title: 'Flutter', reach: 'mixed' }

// Cheap, read-only, must not throw.
export function detect(ctx) {
  if (!ctx.exists('pubspec.yaml')) return { score: 0, evidence: ['no pubspec.yaml'] }
  return { score: 0.9, evidence: ['pubspec.yaml with go_router'] }
}

export function parse(ctx) {
  return { routes: [...], edges: [...], layouts: [...] }
}
```

`ctx` is the shared toolkit, bound to one project root:

| | |
|---|---|
| `projectRoot`, `rel(abs)`, `exists(relPath)` | paths |
| `walk(dir, { skip })` | recursive file list, skipping `node_modules` and friends by default |
| `readFileOrNull(abs)` | |
| `resolveImport(spec, fromFile)` | one import specifier → absolute path, alias-aware |
| `firstPartyImports(src, fromRel)` | every first-party import of a file, as repo-relative paths |
| `pathAliases()` | parsed `tsconfig.json` `compilerOptions.paths` (JSONC-tolerant) |
| `appConfig()` | `{ name, scheme, slug }` from `app.json` or `app.config.*`, else from `nativescript.config.*` + `App_Resources` |
| `nativescriptConfig()` | `{ id, appPath, appResourcesPath }` from `nativescript.config.*`, or null |
| `deps()`, `packageJson()` | |
| `routeMatcher(urlPath)` | pattern → RegExp, understands `[param]` and `:param` |

A provider may also export `deepLinkTemplates(scheme)` to replace the graph's
`deepLinkTemplates` block; the default advertises an Expo Go URL, which means
nothing for a framework Expo Go cannot host.

Register it in `registry.mjs`, add a fixture under `fixtures/`, and add a line
to `fixtures/run-tests.mjs`.

### Following links

Both shipped providers scan a screen's own source **plus one import hop**, and
skip any file imported by more than 8 routes. Links live in list items and
cards, not in the screen module — but a header or tab bar imported by every
screen would otherwise attribute its links to all of them and turn the graph
into a hairball. Reuse that rule; `firstPartyImports` is what it is built on.

## Custom providers

The escape hatch, and the way a new framework earns a module here: prototype it
as a command, upstream it once the shape has survived a real app.

```jsonc
{ "routes": { "provider": "custom", "command": "node tools/my-parser.mjs" } }
```

The command runs with the project root as CWD and `SCREENMAP_PROJECT_ROOT` set,
and prints the fragment above as JSON on stdout. Only `id` and `slug` are
required per route. stderr passes through for debugging.

## Testing

```bash
node fixtures/run-tests.mjs            # check every fixture against its snapshot
node fixtures/run-tests.mjs --update   # accept an intended change
```

Each fixture pins both the provider detection picks and the entire graph, so a
change that silently re-routes a project to a different provider, or drops a
route, fails here rather than in someone's capture run. A fixture may commit a
`.screenmap/config.json` (the NativeScript Angular one does, for `routes.links`);
only `.screenmap/out/` is removed after a run.
