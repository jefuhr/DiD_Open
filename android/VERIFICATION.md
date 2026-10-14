# Android Verification

Implementation base: `origin/mobile` at `7a7709d86b93ac8525b8aa21a9cde6b84c363b65`, checked on October 14, 2026. Verification uses the integrated application source, not worker support stubs. Evidence below is retained locally under ignored `artifacts/android/`.

## Completed Checks

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
FERRY_LIVE_SMOKE=1 scripts/android.sh core --tests nyc.juliet.ferryboard.core.LiveContractTest
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
