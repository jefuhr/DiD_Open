# Smoother SVG map pan and zoom

Camera changes now share one animation-frame scheduler across drag, pinch, inertia, selection, zoom controls, and resize. Geometry construction caches projected label positions, estimated text widths, priorities, DOM references, and feature bounds. Fleet reconciliation refreshes references from the retained DOM.

Panning leaves marker scale transforms alone. Zoom updates visible marker scales and vessel sizes/numbers without rebuilding the card or roster. Street placement runs at most once per 100 ms during movement, with a final pass on completion or cancellation; wheel input settles after 100 ms. Dock labels remain responsive on every camera frame, including selection changes.

Static geometry and labels are culled against the actual SVG viewport, including `xMidYMid meet` letterboxing and a 96 CSS-pixel margin. Label extent estimates add conservative padding. Hidden markers regain the current scale before becoming visible. All original geometry remains in the DOM and is restored as the camera moves.

Asset version 98 updates the existing document, manifest, and service-worker references. There is no renderer dependency, feed-frequency change, deployment, or initial-load optimization in this pass.

## Reproduce

Install the repository dependencies and Playwright Chromium (including its OS libraries), then run:

```sh
npm run benchmark:map -- --baseline 1700ba89e1ab0fb359ff77fea13920da02092d30
npm run test:map-rendering
npm run test:mobile-map-drag
npm run test:map-selection
npm test
```

No application server or live data is needed for these map checks. `scripts/map-browser-fixture.cjs` builds the harbor from bundled GTFS, landing configuration, and `content/harbor-chart.json`, and supplies 25 deterministic boats. Service workers are blocked. External resources are blocked during the benchmark; fonts and assets come from the local static server.

The benchmark reads the baseline `map.js` directly from Git, then alternates baseline/current execution order for five runs each at normal speed and 4× CPU throttling. It uses 390×844 and 1280×800 viewports in Chromium, with mobile/touch emulation for the phone and desktop settings for the larger viewport, matching settings between revisions. Drag and pinch use in-page pointer events at animation-frame cadence, avoiding automation round-trip costs. Inertia uses a deterministic 120-pixel/60-ms two-sample flick history and the normal pointer-release handler; the harness requires an active glide and multiple camera samples, avoiding idle measurements when throttling would otherwise drop pointer samples; zoom crosses the hull-number threshold in both directions; selection runs the normal card and camera path.

The harness also checks that loaded fonts produce nonzero text bounds, so a missing host font configuration cannot silently omit text rendering costs.

Camera JavaScript time is the inclusive duration of the outermost `applyView` call, so the baseline's recursive fleet redraw is counted once. It excludes event-handler work before the renderer and browser style/layout/paint. Frame intervals come from an independent animation-frame sampler during each interaction and include browser rendering and scheduling. The aggregate statistics pool samples from all five scenarios and five runs; raw samples and per-run/per-scenario summaries are in [map-performance.json](map-performance.json). These are local diagnostic measurements, not physical-phone results or production percentiles.

On this Arch Linux host, Chromium's shared libraries were available in an existing local bundle. The recorded run used `LD_LIBRARY_PATH=/tmp/sfn-browser-libs.hTjMgm/usr/lib` and `FONTCONFIG_FILE=/tmp/sfn-browser-libs.hTjMgm/fonts.conf`; those machine-specific paths are not required or embedded in the harness.

## Results

Recorded September 11, 2026 on Linux/x64, Intel Core i7-11700K, Chromium 153.0.8010.12. Each scenario contained 4,850 SVG elements and 787 street labels after selection. All 40 page runs completed, including active inertia in every run.

| Viewport / CPU | Median camera JS, before → after | Reduction | p95 frame interval, before → after | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Phone / 1× | 2.0 → 0.2 ms | 90.0% | 33.4 → 33.4 ms | 0.0% |
| Phone / 4× | 9.5 → 1.6 ms | 83.2% | 166.6 → 116.7 ms | 30.0% |
| Desktop / 1× | 2.0 → 0.2 ms | 90.0% | 33.4 → 33.4 ms | 0.0% |
| Desktop / 4× | 9.7 → 1.4 ms | 85.6% | 150.0 → 116.7 ms | 22.2% |

The aggregate comparison exceeds the 50% median camera-JavaScript target and the 20% throttled-p95 target on both viewports. Normal-speed desktop p95 is unchanged. Throttled frames still exceed a 60 Hz frame budget; this change reduces their cost without establishing physical-device performance.

Throttled results by interaction (pooled across five runs):

| Viewport / interaction | Median camera JS, before → after (ms) | p95 frame interval, before → after (ms) |
| --- | ---: | ---: |
| Phone / drag | 10.3 → 1.0 | 116.7 → 99.9 |
| Phone / pinch | 9.7 → 2.4 | 133.4 → 116.6 |
| Phone / inertia | 8.4 → 0.9 | 149.9 → 83.3 |
| Phone / threshold-zoom | 9.2 → 2.7 | 183.3 → 133.3 |
| Phone / selection | 9.0 → 3.2 | 183.4 → 133.4 |
| Desktop / drag | 10.8 → 1.0 | 133.3 → 99.9 |
| Desktop / pinch | 10.1 → 2.3 | 116.7 → 116.7 |
| Desktop / inertia | 9.1 → 0.9 | 133.3 → 83.4 |
| Desktop / threshold-zoom | 9.1 → 2.7 | 166.7 → 133.2 |
| Desktop / selection | 9.9 → 3.4 | 183.4 → 150.0 |

## Behavioral verification

`npm test`: 345 passed, zero failures. The rendering checks passed at both viewport sizes, the real mouse-drag check passed, and all six boat-framing combinations passed.

The new browser check covers coalesced frames, unchanged scales while panning, a gesture beginning before a queued zoom renders, throttled street placement, final placement after pointer/animation cancellation and wheel settling, offscreen geometry returning with current scales, letterboxed viewport bounds, lightweight threshold crossing, polling identity/focus/selection/scroll, geometry-cache replacement, resize, reduced motion, and the raster fallback.

The existing drag and boat-framing checks cover real browser mouse dragging and selected vessels remaining above or beside their cards at both viewport sizes and harbor edges. The unit suite retains route filters, marine detail cards, themes, fleet behavior, and fallback coverage. Unit assertions now check number visibility rather than node removal, and require current scales on visible markers; hidden markers are checked when they return in the browser suite.
