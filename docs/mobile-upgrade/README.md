# Mobile console upgrade

Historical implementation notes and screenshots. Current browser checks write to ignored `artifacts/browser/`; see the [current README](../../README.md) for setup and commands.

Map rendering follow-up: [smoother pan and zoom, with a repeatable five-run comparison](map-performance.md).

Earlier follow-up: [the strip under the alert bar on an installed board](installed-viewport-fix.md),
which replaces the first attempt at that gap, `4fad843`, and carries the regression fixture for it.

Work lives on `jefuhr/mobile-console-upgrade`, based on local `mobile` at `1a97588`. The desktop-based `jefuhr/mobile-perf-animations` branch was left behind. No deployment or server API changes are included.

## Review stage 1: rendering and data

Read `public/assets/mobile-runtime.js`, the board rendering/loading changes in `public/app.js`, and the fleet/loading changes in `public/assets/map.js`.

- Reconcile sailings by service date, trip, stop, and scheduled occurrence; retain route groups by their existing identities. Patch changed text/attributes and preserve focus and list scroll, including reordering. Open trip details use the same reconciliation.
- Coalesce board rendering and map gesture work with animation frames. Clock updates do not render the board. Vessel markers and roster rows retain their identities across feed updates.
- Show validated saved landing data before awaiting a network response. Preserve date and trip on same-landing refresh. Ignore obsolete schedule, realtime, and notice responses after landing switches.
- Fetch notices independently. Stop polling timers when hidden, refresh on return, deduplicate requests, and bound headers/body loading to ten seconds.
- Keep settings usable when storage is corrupt, denied, or full. Load geometry and vessels concurrently; display saved geometry/positions while refreshing. Preserve camera, filters, selection, and sheet state.

## Review stage 2: board and map design

Read `public/index.html`, `public/map.html`, and `public/assets/mobile-console.css`. Compare `baseline-board.png` with `after-board.png`, and `baseline-map.png` with `after-map.png`.

The console has labeled Board/Map navigation, landing search, directly accessible sort/date/operator/theme controls, tabular times, wrapped destinations, and consistent touch targets. Cards grow with their operational details. Existing status-generation logic remains responsible for predictions, assignments, crew, partner operators, restrictions, arrivals, drop-offs, delays, and last sailings. The phone map retains a collapsible roster; tablets retain the adjacent roster. Board layout changes are scoped to the app surface; the root kiosk keeps its fixed layout and drawer sorting controls.

## Review stage 3: motion, accessibility, and assets

Shared timing is 120ms for press feedback, 180ms for content/cards, 240ms for sheets, and the existing 320ms camera motion. Panel animations cancel safely, trap modal focus, make background content inert, and restore focus. Docked navigation remains nonmodal. Reduced motion disables transitions. Only meaningful vessel/service changes announce through the board's status region; repeated notices and clock ticks stay quiet.

Primary fonts use `font-display: swap`. Lossless PNG recompression saves 5,885 bytes across operator logos without changing pixels. Optional theme artwork/font files are cached on use, and the hidden drawer artwork loads lazily. Shell/data caches and document/manifest asset references use version 90. The worker includes both board and map shells, uses a 2.5-second navigation network wait, and marks offline API snapshots with `X-Ferry-Saved`; clients never treat those snapshots as live.

## Verification

`npm test` passes all 336 tests (315 before the upgrade). Behavioral coverage uses a standards DOM for node identity, focus/scroll preservation, request races/deduplication/timeouts, saved content before network completion, hidden-page polling, malformed/denied/full storage, modal interruption and reduced motion, map state preservation, and saved API responses. Existing operational schedule and cartography tests retain their guarantees; their small unit-test DOM adapters mock shared primitives, which are separately exercised by the standards-DOM tests.

The map drag, rendering, selection, and performance checks now use bundled fixtures and need no application server; see [map performance](map-performance.md).

For the other browser checks, install Chromium with `npx playwright install chromium` and the system libraries Playwright requires. Start `PORT=8094 node server.js`, then run `npm run test:mobile-browser` or `npm run test:mobile-route-layout` in another terminal. `MOBILE_TEST_ORIGIN` overrides that server address for both; they share `scripts/mobile-check-harness.cjs`, which owns the static server, the 390×844 phone context and that origin. The comparison script extracts the immutable baseline revision into a temporary directory, captures API fixtures once, and replays both revisions with the same fixed clock, 500ms API delay, 390×844 viewport, and 4× CPU throttling. Baseline traces were reconstructed from the original revision after missing browser libraries initially prevented tracing; they were not collected before editing began.

The final recorded comparison is:

| Check | Original mobile | Upgrade |
| --- | ---: | ---: |
| Cold board visible | 1,642ms | 1,208ms |
| Cached board visible | 1,573ms | 328ms |
| Cards retained through refresh | 0 / 25 | 25 / 25 |
| Drawer click to next animation frame | 16ms | 29ms |
| Map zoom median / p95 frame interval | 16.7 / 133.3ms | 16.7 / 100ms |

Both browser runs reported no page script errors. `browser-results.json` records the timed comparison and node retention. `browser-matrix.json` records 90 combinations: board/map, nine themes, and 320×740, 390×844, 844×390, 768×1024, and 1024×768 viewports. Checks cover horizontal overflow, clipped departure fields, and navigation touch targets. The browser script fails on those violations or page script errors. These are Chromium emulations, not physical-device certification.

Action traces are written to `/tmp/mobile-baseline-trace.zip` and `/tmp/mobile-after-trace.zip`; open with `npx playwright show-trace <path>`. They include cold load, reopening, scrolling, landing changes, timed refresh, and map zoom. Screenshots and compact results are kept here; the larger traces stay outside the repository.

## Remaining validation limits

- Physical iOS Safari, installed iOS/Android PWAs, VoiceOver, and TalkBack have not been tested. DOM keyboard/focus tests cannot establish assistive-technology announcement quality or OS safe-area behavior.
- Drawer-to-next-frame feedback meets the 100ms target in this fixture. Map zoom has a roughly 16.7ms median frame interval but substantially slower tail frames under 4× CPU throttling; the full frame-budget target is not met. This pass preserves the existing SVG cartography and inertia. The requestAnimationFrame samples measure intervals, not isolated JavaScript execution cost.
- Timing results are local single-run comparisons, not network/device production percentiles. All pages use deterministic API fixtures for comparison. No infrastructure compression or deployment changes were made.
