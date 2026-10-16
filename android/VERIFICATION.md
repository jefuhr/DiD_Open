# Android Verification

## Ferry Kitty Branding Rename

The Gradle project is now `FerryKitty`, the app and widget preview label is `Ferry Kitty`, and the source namespace is `nyc.juliet.ferrykitty`. The installed application ID, manifest components, legacy deep links and widget refresh action, preference and cache names, and widget job IDs remain unchanged for compatibility. This rename does not claim a new physical-device or emulator acceptance run. The dated commands, class names, APK hashes, and results below describe the original builds and remain unchanged as historical evidence; current instrumentation class filters use `nyc.juliet.ferrykitty`.

Implementation base: `origin/mobile` at `7a7709d86b93ac8525b8aa21a9cde6b84c363b65`, checked on October 14, 2026. Verification uses the integrated application source, not worker support stubs. Evidence below is retained locally under ignored `artifacts/android/`.

## UX Polish Follow-up

The follow-up starts from `c9e5bc02edff4de393397e951689ead2c6e4d0d4`. It improves the tablet sidebar's full-height surface, measured map/list placement, chart boundary, label clearance, and 6 dp clock spacing. Stop names and complete clock groups now move onto another line when needed; both trip actions remain available.

| Check | Result | Evidence |
| --- | --- | --- |
| Integrated JVM tests | 209 passed: 156 app and 53 core. Zero failures/errors; one opt-in live test skipped. Repository service-parity fixtures were supplied. | `ux-polish-integrated/jvm-results/` |
| Build and lint | Debug and R8-optimized unsigned release built successfully. Debug lint: zero errors, 36 advisory warnings. Release vital lint passed. | `ux-polish-integrated/build.log`, `ux-polish-integrated/lint/` |
| APK contents | Both APKs contain all three chart assets. Debug contains 12 preview fixtures; release contains none. | `ux-polish-integrated/debug-artifact.json`, `ux-polish-integrated/release-artifact.json` |
| Android 12 / API 31 | All 35 test cases covered successfully across two runs: 34 passed in the full run; its remaining theme screenshot test passed in a focused rerun after a test-only frame-readiness correction. This was not a single 35/35 run. | `20261015T014817Z-api31/`, `20261015T020027Z-api31/` |
| Android 16 / API 36 | All 10 focused tests passed: trip/ride wrapping, actual map-label metrics, all five map-layout checks, large-text/tablet journeys, and trip/ride/offline restoration. | `20261015T020340Z-api36/` |
| Physical update | The tested debug APK updated the existing Nothing A001 installation in place. Installed APK hash matched exactly; activity launch succeeded. The phone remained locked, so physical screen acceptance is unverified. | `ux-polish-physical-device/` |
| Source identity | All 130 source/build files hashed. Production source and the debug APK are unchanged between the successful full build, API 31 full run, and focused rerun. Only two instrumentation files changed for screenshot readiness. | `ux-polish-integrated/source-manifest.json`, `ux-polish-integrated/source-manifest-final.json` |
| Review | Bounded Astra source review found no verified P0/P1/P2 blocker in its snapshot. The coordinator reviewed the final wrapping, native metric checks, and screenshot readiness changes. | `ux-polish-review-v1/ux-polish-review-v1.txt`, `ux-polish-integrated/coordinator-review.md` |

Native wrapping tests inspect line boundaries, ellipsis, glyph extents, and horizontal containment at 320/360 dp with font scales 1.2, 1.49, and 1.8, plus the regular 411 dp trip layout. They verify complete 12-hour clocks, estimate labels, stop names, and displayed trip actions. The map tests cover measured portrait/landscape placement, the 480 dp minimum chart width, camera continuity and gestures, all nine themes' chart boundaries, and actual text bounds around measured controls. The API 31 label sweep checked 3,670 accepted labels, including 1,299 rotated streets and 494 labels within 16 dp of a control, with zero overlaps.

The three runs retained 63, nine, and 37 screenshots respectively. The coordinator inspected original narrow/large-text trip and ride screens, tablet departures and map layouts, and the corrected theme rendering. All 109 images, including the preserved stale-theme failure, were additionally scanned for system error dialogs; none were detected. The scanner correctly detected the saved System UI ANR as a positive control. Logs from these three runs contained no fatal-exception or ANR marker. This supplemental OCR check does not turn the stale-theme image into passing color evidence; the focused rerun supplies that evidence. Results are in `ux-polish-integrated/native-results-summary.json` and `ux-polish-integrated/screenshot-audit-summary.json`.

Both owned emulators were stopped after testing. The final API 36 run uses the same production APK as the API 31 runs. Its focused scope covers all changed layouts and the added native regressions; it does not claim a new complete API 36 suite run. The earlier pre-wrapping phase passed 32/32 tests on each API and is retained separately under `ux-polish-phase1/`.

### Preserved Failures and Test Readiness

The clean pre-fix native run is retained in `ux-polish-followup/quota-checkpoint/clean-red-api36/`. It exposed the trip/ride wrapping failures before the coordinator's fix; its third failure was a null Android screenshot capture. The earlier source and worker artifacts remain intact.

In the integrated API 31 full run, the Kuromi screenshot contained the entire preceding Pompompurin frame. The test now waits for the independent header text color before asserting the chart veil. The original veil assertions and tolerances remain unchanged. A bounded timeout preserves the failed image if the theme never reaches the screen. The focused rerun passed all nine themes; the production APK did not change.

Two initial emulator attempts were rejected as environment failures. `20261015T012150Z-api36/` developed a System UI ANR and was deliberately aborted; its reported process crash is the induced abort, not an application crash. `20261015T012725Z-api31/` failed package installation with `Broken pipe (32)` before instrumentation. The host was heavily loaded. Subsequent sessions used the existing AVDs with hardware GPU rendering, two emulator CPU cores, and a minute of healthy package/window checks before testing. No AVD configuration or package version changed, and unrelated project processes were left running. Startup logs and exact launch commands are in `ux-polish-integrated/warm-api31/` and `ux-polish-integrated/warm-api36/`.

### Follow-up Commands and Artifact Identity

The recorded commands below used the dedicated emulator serials shown; those sessions have since stopped. The local PATH included `artifacts/android/ux-polish-tools`, which exposes the already-installed ripgrep binary. No package was installed or upgraded.

```sh
FERRY_SERVICE_CONTRACT="$PWD/artifacts/android/service-parity/fixtures" scripts/android.sh build --max-workers=1 --offline
FERRY_ANDROID_API=31 FERRY_ANDROID_SERIAL=emulator-5554 scripts/android.sh test --max-workers=1 --offline
FERRY_ANDROID_API=31 FERRY_ANDROID_SERIAL=emulator-5554 FERRY_ANDROID_TEST_CLASS='nyc.juliet.ferryboard.MapLayoutTest#everyThemeMarksTheAreaBeyondTheChartApartFromWater' scripts/android.sh test --max-workers=1 --offline
FERRY_ANDROID_API=36 FERRY_ANDROID_SERIAL=emulator-5556 FERRY_ANDROID_TEST_CLASS='nyc.juliet.ferryboard.TripWrappingTest,nyc.juliet.ferryboard.MapLabelMetricsTest,nyc.juliet.ferryboard.MapLayoutTest,nyc.juliet.ferryboard.FerryJourneysTest#largeTextAndTabletWorkspaceKeepPrimaryActionsReachable,nyc.juliet.ferryboard.FerryJourneysTest#tripRideAndCachedOfflineRestoration' scripts/android.sh test --max-workers=1 --offline
```

The debug APK SHA-256 is `09daa3018d937a5fefed2a853a9838782b2392b558a1c64391cc908f9b8b7197`. The final test APK is `5da4bf1015ef644d4d977198e112da6a17c92218ca25452086ac9dd4ee80987e`; the unsigned release APK is `2727fb90430b31a8c96fac652b2291615725047867a6e3f788f09e9a800ecf69`.

At 22:06 Eastern on October 14, `adb install -r` returned `Success` for the debug update. An explicit `am start -W -n nyc.juliet.ferryboard/.MainActivity` returned `Status: ok`, with a running process and resumed activity. The installed `base.apk` SHA-256 matched the tested debug APK. Version 1.0.0/code 1 and the original first-install time were retained. No uninstall, data clearing, fixture instrumentation, permission grant, or device setting change was performed. Keyguard remained visible and the phone was dozing; no physical-screen or real-device workflow claim is made. The captured app-process log contained no fatal-exception or ANR marker. Exact commands and package/launch/hash evidence are in `ux-polish-physical-device/`.

The initial app acceptance below records the earlier implementation and remains useful historical evidence. Current UX acceptance is recorded in this follow-up section.

## Initial Acceptance (Before UX Polish)

| Check | Result | Evidence |
| --- | --- | --- |
| Integrated JVM tests | 194 passed: 53 core and 141 app tests. One opt-in live test skipped in the ordinary core run. Zero failures or errors. | `final-unit-results/summary.json` and per-suite XML reports |
| Repository service parity | Nine canonical service-day cases and 48,702 departure projections across 30 landings and 618 landing/date cases. Includes DST and after-midnight behavior. | `service-parity/generator.log`, `service-parity/gradle.log`, `core-integrated-parity/` |
| Live API contract | One passed, zero skipped, at 18:24 UTC on October 14. Validates decoding and endpoint identity, not guaranteed upstream feed freshness. | `live-contract.log`, `live-contract/` |
| Integrated build | `:core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease` passed. Release includes R8 optimization and release vital lint. | `final-verified-build.log`, final recheck in `20261014T201048Z-api36/build.log` |
| Final test APK and lint | `:app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` passed after the last screenshot-harness correction. | `20261014T201048Z-api36/build.log` |
| Debug lint | Zero errors, 36 advisory warnings. No lint baseline or error suppression was introduced. | `final-build-results/lint-results-debug.sarif`, HTML report |
| APK contents | Both APKs contain all three offline chart assets. Debug has 12 preview fixtures; release has none. | `final-debug-artifact.json`, `final-release-artifact.json`, `final-build-results/apk-inventory.json` |
| Android 12 / API 31 | 27 passed, zero failed, in the final complete run. | `20261014T201209Z-api31/` |
| Android 16 / API 36 | 27 passed, zero failed, in the final complete run. | `20261014T201146Z-api36/` |
| Production native smoke | Real debug activity loaded the Pier 11 board, partner departures, vessel names, and alerts through the production HTTPS API without fixture extras. | `production-native-smoke/README.md`, `board-after-poll.png` |
| Physical debug installation | Verified the APK signature and hash, installed version 1.0.0 on the connected Nothing A001 running Android 15 / API 35, and received a successful activity launch. The phone remained locked, so its visible screen was not verified. | `physical-device-20261014/` |
| Source review | Astra's final bounded review found no new source-verified P0/P1/P2 blocker. The coordinator separately reviewed subsequent responsive layout and evidence-harness changes. | `final-corrections.md`, `coordinator-final-delta-review.md` |

The lint warnings comprise 11 small-text advisories, eight KTX suggestions, eight dependency-version notices, four hardcoded-label notices, two intent-filter formatting notices, and one each for data-extraction rules, resource shrinking, and a context field. The context field holds the application context. Approved dependency versions remain pinned. Small-widget rendering has separate native checks at normal and large system text.

The parity generator reports that the existing Statue of Liberty feed's calendar ended on October 12, 2026. Feed data is unchanged by the Android implementation. Existing duplicate-departure normalization is shared with the web generator.

## Emulator and Visual Coverage

The suite covers preferences and favorites across relaunch; independent operators, routes, and operational-movement filters; dates and alerts; hull search and ride switching; trip details and connections; offline recovery and ride restoration; deep links; native Back and rotation; widget defaults and per-instance Apply/Cancel; all nine themes; system font scale 1.8; and tablet layout. Dedicated component tests exercise semantic marker identity at overlapping positions and camera preservation across tab/layout remounting, repeated same-vessel focus requests, and saved-state restoration.

RemoteViews checks inflate the production renderer in an actual `AppWidgetHostView` without binding a launcher ID. They cover all three sizes, independent options and saved state, missing-location recovery, accessible last-location labels, 48 dp visible controls, the advertised 180 × 180 dp minimum, two medium-widget departures at 280 × 180 dp with 12-hour clocks, and the smallest widget at font scale 1.8. Text assertions inspect internal line bounds as well as visible view bounds.

The coordinator inspected native screenshots of the phone board, harbor map, trip/ride screens, settings, all themes, large-text trip/ride layouts, tablet workspace/map, and widget size boundaries. Screenshots use separate directories per instrumentation run so older images cannot silently substitute for current evidence. All 36 final screenshots per API were additionally scanned with the installed macOS Vision framework for system error dialogs; none were detected. The scanner correctly detected the preserved failed-run System UI dialog as a positive control. Native OCR is a supplemental check, not a substitute for the coordinator’s visual inspection. Evidence is in `api31-screenshot-audit.json`, `api36-screenshot-audit.json`, and `system-dialog-positive-control.json`. This is emulator verification, not a physical-device or manual TalkBack session.

## Regression Evidence

Initial checks exposed state-generation, midnight revalidation, per-widget expiry, offline configuration, marker-identity, camera-restoration, and responsive-widget issues. Focused regressions and the final integrated checks cover the accepted corrections. The retained red runs include `state-review-red.log`, `map-accessibility-red/`, `integrated-first-run/`, `20261014T193339Z-api31/`, and `widget-large-text-red/`.

The `20261014T194144Z-api31` run passed 26 of 27 tests; its remaining failure was a Compose forced-redraw screenshot timeout before the landing semantic assertion. The harness now uses the system screenshot method after Compose/system idleness. The assertion remains unchanged, and the final complete runs above determine acceptance. Failed runs are preserved rather than relabeled as passes.

The first API 36 run (`20261014T195717Z-api36`) reported 26 passes and a Back timeout, but its earlier screenshots already showed a System UI ANR dialog above the app. Original production navigation passed the expanded focused test after restarting the dedicated emulator (`20261014T200904Z-api36`). No speculative navigation change was retained. The helper now records preflight windows/screenshot and rejects an active application-error/ANR dialog before testing. The failed environment run and comparison remain in `api36-system-ui-investigation.md`.

## Reproduction

Use JDK 17, SDK platform 37, build tools 36.0.0, and the pinned Gradle wrapper/dependencies described in [README.md](README.md). The completed local run used Temurin 17.0.20.1 and ARM64 default API 31/36 emulator images.

```sh
scripts/android.sh parity
FERRY_LIVE_SMOKE=1 scripts/android.sh core --tests nyc.juliet.ferrykitty.core.LiveContractTest
FERRY_SERVICE_CONTRACT="$PWD/artifacts/android/service-parity/fixtures" scripts/android.sh build --max-workers=2
scripts/android.sh test --max-workers=2
FERRY_ANDROID_API=36 scripts/android.sh test --max-workers=2
python3 scripts/check-android-artifact.py android/app/build/outputs/apk/debug/app-debug.apk --variant debug
python3 scripts/check-android-artifact.py android/app/build/outputs/apk/release/app-release-unsigned.apk --variant release
```

The helper records the exact instrumentation command, build/install output, runner results, logcat, and screenshots in `artifacts/android/<UTC>-api<API>/`. Its fixture transport uses the repository's iOS preview responses with a fixed September 4, 2026 clock and separate preferences/cache. It rejects physical-device serials. Both final runs use the checked-in helper, save the exact APK hashes, and stop the dedicated emulator that each run starts. Both dedicated emulators were confirmed stopped after verification; emulator testing did not target the attached physical device. An earlier attempt to reuse a stopped emulator failed before instrumentation; its Gradle build passed and is retained separately from the final complete runs.

## Physical Installation

At the user's request, the same verified debug APK was installed separately on the connected Nothing A001 running Android 15 / API 35. The package `nyc.juliet.ferryboard` was not previously installed. `adb install -r` returned `Success`; no uninstall, app-data clearing, test instrumentation, or permission grant was performed. The APK SHA-256 was `48f3650ab885be55dfa5d8ab907453907be837ca576d08c3c078ffb50157a7bb`, matching the emulator-tested artifact.

An explicit launch of `nyc.juliet.ferryboard/.MainActivity` returned `Status: ok`, and Android reported the activity resumed with a running app process. The phone's secure keyguard remained visible, so this confirms installation and Android's launch result, not visual acceptance on the physical screen. The captured app-process log contained no fatal-exception or app-ANR marker. Commands, install/launch results, package details, keyguard state, and app logs are retained locally under `physical-device-20261014/`.

## Remaining Acceptance Boundaries

- Physical location acquisition, permission recovery on a real device, and manufacturer-specific background restrictions remain unverified.
- Native widget rendering and configuration tests do not prove launcher binding, delayed JobScheduler execution, or manual TalkBack behavior on a real widget host.
- The production smoke recovered from an initially unavailable schedule while release optimization heavily loaded the host. Its initial launch wait timed out, then Android displayed the activity and ordinary polling loaded the board. Both observations are retained; this is not a startup performance benchmark.
- Release output is an unsigned APK. Release signing and store publication were not performed; the physical installation above uses the signed debug APK.
