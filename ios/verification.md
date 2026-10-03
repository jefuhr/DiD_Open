# Native implementation verification

Checked on this Mac on 2026-09-28 with Xcode 27.0, Node 22.23.3 and XcodeGen 2.46.0.

## Installed operator filters and compact menus — 2026-10-03

This supersedes the compilation, simulator and phone installation blockers recorded below.

- Pulled `mobile` through `b5d2b71`, including four approved Sukkot returns and verified trip connections, while preserving the native changes.
- iPhone 17 simulator: **9 app unit tests and 2 UI journeys passed**, covering preferences, route limits and lookahead, independent NYC operational filters, operator expansion and reset.
- FerryCore: **25 tests passed, 1 optional live check skipped**, including movement classification and schedule parity across **30 landings, 546 cases and 45,252 departure projections**.
- JavaScript: **13 landing/catalog, 40 connection/realtime and 10 Sukkot operation tests passed**. Updated the stale Sukkot expectations to verify the four newly approved published final arrivals and the two remaining withheld returns.
- Signed Release build and strict code-signature verification passed. Installed over the existing app on Juliet's iPhone; iOS initially blocked launch while locked. After the phone was unlocked, the installed executable was running and a device screenshot showed the populated Pier 11 board with live estimates. Saved preferences before and after installation were identical.
- The current development signing profile expires **2026-10-06 23:36 UTC**. This remains a development installation.
- Production `/api/landings` still omits the optional global route catalog. Route switches work for the selected landing; routes at other docks become available when the server update is deployed. No production deployment target is configured in this checkout.

## Operator routes and operational movement filters — 2026-09-30

- Each operator has a separate left chevron and on/off switch. Expanded rows offer route switches; NYC Ferry adds Headed to Pier C, Crew shuttles and Out of service boats. Returns and shuttles remain separate from other non-passenger movements. Existing preferences migrate with all new choices enabled.
- Both departure sorts and trip connections respect route filters. Movement filters run before route limits, empty groups disappear, and a hidden first movement cannot extend the lookahead window. Show all departures resets every departure filter.
- `/api/landings` now optionally supplies routes across all docks. The native client merges this catalog with the selected landing and supports older servers without it.
- **13 Apple XCTest checks passed** using the actual core, store and preference sources compiled for macOS with a local module cache. Coverage includes verified Sukkot returns and shuttles, overlapping movement flags, partner route namespaces, grouped limits, lookahead, connections, saved choices, migration, global catalog fallback and accessibility preferences.
- **13 JavaScript landing/catalog checks passed.** Native source parsing, XcodeGen, server syntax, API JSON and Git whitespace checks passed. A UI journey for expanding and filtering routes and movements was added.
- Full iOS compilation, UI execution and phone installation subsequently passed on October 3; see the installation record above. The server catalog remains pending deployment.

## Compact board and iPad columns

Checked on 2026-09-28 with Xcode 27.0 on the iOS 27.0 **iPhone 17** and **iPad Pro 11-inch (M5)** simulators. This supersedes the pending iPad layout checks below.

- Departures take two lines. The landing, clock and live state are in the navigation bar, and wide boards keep shortcuts, date and sort in one pinned row. Zero-minute dwells are no longer listed.
- Boards at least 600 points wide use two columns, filled left to right. The iPad sidebar stays docked only while the board keeps both columns beside it; in portrait it opens over the board and closes after a choice. Riding mode uses two panes from 700 points.
- The new tablet journey failed against the previous board (portrait 09:00 and 10:00 never shared a row). It now passes in portrait and landscape, by time and by route, opening a trip from the grid, choosing a landing from the portrait sidebar, and with one column at accessibility sizes.
- The new phone journey measured the previous first row at **93 points**; rows are now about **50 points**, above the 44-point touch minimum, and phone landscape shows two columns.
- iPhone: **14 unit tests and 7 UI journeys passed**; the tablet journey skips. The four older journeys had never run and failed identically against the previous board. The map's own identifier replaced its header and vessel list identifiers, toggle taps landed on labels, and one test tapped Done on a pushed page. The identifier now applies only to the map, and the tests flip the switch control and go back first.
- iPad: **14 unit tests and the tablet journey passed**. The older journeys use the iPhone tab bar.
- Same live Pier 11 data (`https://juliet.nyc`, 17:35 Sukkot service) before and after: iPhone portrait showed about **6** departures before and **10–11** after; iPad portrait about **11** before and about **40** after.
- XCUITest crops landscape screenshots on this runtime, so landscape pictures were taken with `xcrun simctl io screenshot`. Split View and Stage Manager window sizes and a physical iPad remain unchecked.

## iPad support revision

The app targets device families 1 and 2. iPad orientations and multitasking are configured explicitly. Wide iPad windows show navigation, landings and favorites in a sidebar; narrow windows retain tabs. Board and ride content keep a readable maximum width.

XcodeGen regeneration, generated device-family inspection, Swift syntax parsing and Info.plist validation passed. iPad runtime layout, rotation and multitasking checks remain pending because the existing Xcode/service permissions are still restricted. This revision remains local with the other uncommitted work.

## Current compact UI and Sukkot revision

Latest `mobile` source files were imported through the connected GitHub app at **b3bbe4a88c1adb48594a355875a59dbc23ea08f1**, then merged with the native work. The shared Git directory remains unwritable: branch history has **not** been pulled or advanced. Source enrichment and fixes beyond that commit are local. Web asset version is now **122**.

- Full JavaScript suite: **439 passed; 1 blocked** by the sandbox denying the push integration test's `127.0.0.1` listener (`EPERM`). There are no remaining assertion failures. Focused connection tests passed after the final separate arrival/departure correction; asset version checks passed after stamping.
- Current Swift core: **18 XCTest tests passed**, including actual schedule parity over **30 landings, 546 live/stale/browsed scenarios, and 45,257 departure projections**. These include all five Sukkot dates and surrounding ordinary service dates, working assignments, crew/Pier C flags, dwells, and layovers using distinct arrival/departure delays.
- Riding backend: **22 tests passed**, including all verified holiday trips in four major landing payloads, reused feed IDs, and published-versus-feed arrival baselines.
- Fleet map: **17 tests passed**, plus **985 actual route/stop identity checks** (197 verified departures on each Sukkot date).
- Preferences compile and standalone checks passed for legacy migration, new-choice roundtrips, invalid values, and every accessibility text size. App-level launch/default tests were added but still require an iOS test host.
- Final native app, unit-test and UI-test sources pass Swift syntax checking. The Xcode project was regenerated and the 12 debug response fixtures refreshed.
- Full iOS compilation was retried: Xcode package resolution cannot write its system caches, and direct SwiftUI type checking cannot launch the sandboxed Swift macro helper. Simulator/UI execution and signed installation remain pending.

The UI now has compact board/trip/ride layouts, favorite shortcuts, a direct boat action, and settings for text size, home landing, opening screen, lookahead, route count, dwell/layover visibility, marine references, and keeping the screen awake. Native dwell display defaults to enabled; the server's existing web display preference is preserved.

Sukkot source enrichment verifies 65 published dwell pairs, 46 starts, four shuttles and 41 last-drop notes. Five conflicting last drops stay explicitly unconfirmed; details and provenance are in [the Sukkot verification record](../docs/schedule-comparison/sukkot-2026.md). Pier C start times are first pickups at the destination, and return rows are last drops at the collecting landing, without invented Pier C transit times.

## Earlier baseline checks

- `npm test`: **415 passed**.
- `npm run test:staff-app`: root and `/ferryTimesMobile/`, at 390, 768 and 1440 pixels, including CSP, offline modules and warmed landing switches.
- `npm run test:riding-mode`: both deployment paths and **36 theme/viewport combinations**.
- `swift test --package-path ios/FerryCore` with the live smoke check enabled: **11 passed**, including the canonical shared schedule cases, both DST transitions, crew coverage, holiday-only departures, offline cache replacement/corruption/isolation, connection expiry, and distinct saved arrival/departure times.
- Every native response model decoded its endpoint on `https://juliet.nyc`, including a physical-vessel ride and trip connections.
- After review, **all 12 schedule tests passed**, including five new dwell/layover regressions. These were compiled and executed with Apple's XCTest using an isolated runner in `ios/DerivedData/ReviewModules`; all core test sources also passed type checking. This check needs no simulator or system-service access.
- Initial iPhone arm64 application build with signing disabled: **passed**.
- Simulator arm64 application and unit/UI test bundle build: **passed** before the final review fixes described below.
- Privacy plist validation, shell syntax and Git whitespace checks: **passed**.

## Remaining checks

- The iOS 27 runtime finished downloading, but registration failed because its personalization manifest was missing. Retry installation through Xcode Components or `xcodebuild -downloadPlatform iOS` when system access is available; the downloaded asset is retained.
- The session switched to restricted access during setup. CoreSimulator now returns `Operation not permitted`, and SwiftUI macro compilation cannot launch its helper. Rebuild and run the native unit tests and six UI journeys once Full Access is effective.
- Device provisioning has created the app profile and a development certificate. The first signed build is waiting for macOS Keychain access to finish.

Final review corrected startup ordering so saved riding data appears before network requests, prevents a disappeared vessel's old detail snapshot from being treated as fresh, and restores dwell/live-layover parity with the web app. Regression tests for cached startup and vessel switching have been added; their simulator execution remains pending. The latest shared core compiles, and syntax checks pass for the final app changes; a complete app rebuild remains pending.

The connected iPhone was detected with Developer Mode enabled. Installation and launch are not yet certified. Real location permission and a live sailing's feed behavior still need a physical-device check.
