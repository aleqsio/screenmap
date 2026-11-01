# Capture interactions on the first map

Apply this workflow to every project, platform, language and capture state. The mapper builds Prototype links from `out/interactions.json` during packing. Project source changes and hand-authored `hotspots.json` are unnecessary.

## Inventory each capture

1. Save the settled screenshot. Inspect its visible interactive controls with the device's accessibility or component tree. Compare with the screenshot to catch unlabeled icons, disabled controls and overlays. Keep frames in normalized screen coordinates. Read each RTL capture independently.
2. Inventory all visible navigation controls: Back, Close, downward dismissal chevrons, tabs, rows, avatar/account buttons, three-dot menus, drawers and sheet triggers. Include controls on loading, empty and error screens. Mark non-navigation controls with a reason such as `Text input`, `Playback`, `Disabled`, `External system sheet`, or `Purchase; not executed`.
3. Explore each safe navigation control. Save the source capture before the tap and verify the destination after it. A same-route change gets a named capture, such as `player--menu.png`. Inventory that state too. Record menu dismissal and safe menu destinations. Keep destructive or submitting controls unresolved with a specific reason.
4. For Back and Close, verify the normal return path. Record `action: "back"` and a verified `fallbackTo` route when the app has a direct-link fallback. The compiler gives `kind: "close"` screen-level Back behavior: it skips that screen's menu/state visits and returns to its prior screen. Ordinary Back returns to the prior saved state. A fixed destination uses `to`. Dismissing a menu uses `to` for its owning route and omits `targetState` to return to Base. Confirm the returned state, rather than using the route filename as proof.
5. Write the observed controls as JSON and run `record-interactions.mjs` after the final screenshot resize. Repeat for every base and named capture. Pack only after every capture has an inventory. Review `interaction-coverage.json`; report missing inventories and unresolved controls explicitly.

Done when every captured screen/state/variant is inventoried, every safe navigation control has a verified saved destination, and remaining controls have specific unresolved reasons. Route coverage alone is not navigation completeness.

## Record one capture

```json
[
  { "id": "close", "label": "Close", "rect": [0.04, 0.07, 0.12, 0.06], "kind": "close", "outcome": { "action": "back", "fallbackTo": "home" } },
  { "id": "more", "label": "More options", "rect": [0.84, 0.07, 0.12, 0.06], "kind": "menu", "outcome": { "to": "player", "targetState": "menu" } },
  { "id": "share", "label": "Share", "rect": [0.70, 0.07, 0.12, 0.06], "kind": "other", "outcome": { "reason": "Disabled while audio is unavailable" } }
]
```

Use actual observed route IDs and frames. These coordinates are an example, not a template for another capture.

```bash
node <skill>/scripts/record-interactions.mjs <project> --node player --variant en-light --controls /tmp/player-controls.json
node <skill>/scripts/record-interactions.mjs <project> --node player --variant ar-dark --state menu --controls /tmp/player-menu-ar-controls.json
node <skill>/scripts/pack-map.mjs <project> --variants en-light,ar-dark
```

The recorder binds each inventory to the screenshot SHA-256. Recapture and re-inventory after layout or content changes. The producer rejects stale frames and missing destination captures. Unobserved behavior remains unresolved; packing never invents routes, menu items, RTL mirroring or Back history.
