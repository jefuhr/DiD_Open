# Installed app bottom gap

Built on the latest local `mobile`, `4ddb87d`, including Claude's connection handling,
chart delivery, shared asset-version stamping, and browser harness changes.

The previous runtime copied `visualViewport.height` directly into the board's fixed
height. In an installed iOS app that value can omit safe-area/status-bar space, even
with `viewport-fit=cover`. `innerHeight` or fixed inset positioning alone is not a reliable
fallback. This is documented in [WebKit 254868](https://bugs.webkit.org/show_bug.cgi?id=254868)
and [237961](https://bugs.webkit.org/show_bug.cgi?id=237961).

The new browser fixture reproduces the resulting board gap by reporting 797px from
both JavaScript measurements for an 844px window, with 47px top and 34px bottom safe
areas. The actual device's measurements have not been captured; the screenshot is
consistent with this failure, but the simulation is not physical iPhone confirmation.

Installed mode now uses CSS `100vh`, including during rotation and resume. Detection
covers `navigator.standalone` and both standalone/fullscreen display media queries.
Regular browser windows continue to track the visual viewport. Board, map, landing
drawer, and modal panels share the same bounds; the root kiosk board remains unchanged.
The implementation uses window-sized CSS units, not physical screen dimensions, so
tablet windows can resize without overflowing onto the rest of the display.

When an editable control is focused and the visual viewport substantially shrinks,
the installed shell follows the keyboard height and offset. It keeps doing so through
blur until the viewport recovers. Hardware-keyboard focus alone does not shrink it;
pinch zoom leaves the layout still. Bottom safe-area padding remains inside the last
surface, and is removed while the on-screen keyboard occupies that edge.

## Verification

- 344 Node tests pass, including short installed metrics, keyboard focus/blur,
  recovery, rotation, media-query detection, root-mounted maps, and kiosk isolation.
- 28 browser geometry checks pass in `viewport-checks.json`, covering board/map,
  missing one/both safe areas, correct metrics, full-height drawers, keyboard opening
  and closing, resume, zoom, ordinary browser mode, and phone/tablet resizing.
- The board's simulated 47px gap becomes 0px: alert-bar bottom 797 → 844. Its bottom
  safe-area padding remains 34px. See `viewport-board-before.png` / `viewport-board-after.png`.
- Existing route-layout checks (15 viewport/text-size combinations) and map-drag
  checks pass. Browser runs report no uncaught page errors.

Run an application server at `MOBILE_TEST_ORIGIN` (default `http://127.0.0.1:8094`), then:

```sh
npm test
npm run test:mobile-viewport
node scripts/check-mobile-viewport.cjs --baseline
npm run test:mobile-route-layout
npm run test:mobile-map-drag
```

The baseline pins the runtime and console stylesheet to `4ddb87d`. The new check uses
Claude's shared Chromium harness, explicit safe-area overrides, and controlled viewport
measurements. These model the known WebKit failure; desktop Chromium does not reproduce
the iOS system web-app container itself. Physical iPhone home-screen launch, keyboard,
rotation, and resume still need confirmation. No deployment was performed.

Asset version is 95, generated with `npm run stamp:bump`; existing installed clients
can receive the coordinated shell update when this change is deployed.
