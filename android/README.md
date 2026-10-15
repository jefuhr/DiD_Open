# Ferry Board for Android

Native Kotlin and Jetpack Compose client for Android 12 and later, using the existing Ferry Board HTTPS API. The Android project lives beside the iOS and web clients and shares their service-day fixtures and API contract.

## Build

Use JDK 17, Android SDK platform 37, and build tools 36.0.0. The Gradle wrapper pins Gradle 9.6.0 with a distribution checksum. Dependencies are pinned in the build files; no API key or map service account is required.

```sh
scripts/android.sh doctor
scripts/android.sh core
scripts/android.sh parity
scripts/android.sh build
```

The helper respects `JAVA_HOME` and `ANDROID_HOME`/`ANDROID_SDK_ROOT`. On macOS it can discover JDK 17 and the standard Android SDK location. It does not install system packages, SDKs, or emulator images.

`parity` uses the existing Node generator to compare Android with the web schedule engine across the repository's actual landing and service-date data. It preserves the generated inputs and logs under `artifacts/android/service-parity`. Ordinary `core` tests remain deterministic; a deployment check is explicitly opt-in:

```sh
FERRY_LIVE_SMOKE=1 scripts/android.sh core --tests nyc.juliet.ferryboard.core.LiveContractTest
```

You can also open the `android` directory in Android Studio, or run Gradle directly:

```sh
cd android
./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Release compilation produces an unsigned APK; supply your own signing configuration separately for distribution. Application ID: `nyc.juliet.ferryboard`.

## Native behavior

The app covers landing search and favorites, departure and route views, date browsing, operator and movement filters, trip details and connections, vessel search, ride history and restoration, alerts, nine themes, and configurable Home Screen widgets. Preferences and downloaded snapshots belong to the Android app; browser storage is not imported.

The harbor chart uses the repository's bundled shoreline and marine data, rendered natively. Geometry is available without an external tile service. Vessel positions still require the ferry API or a saved snapshot. Attribution and marine reference limitations remain visible in the app.

Downloaded schedules survive network failures. Saved responses retain their original bytes and receipt times, and invalid replacement responses cannot overwrite a usable schedule. Date browsing follows the same service calendars, DST transitions, after-midnight departures, crew rules, and prediction labels as the iOS and web clients.

Visible feeds refresh while the app is in the foreground. Backgrounding cancels app polling and marks live state stale. An active ride persists independently of whether its dashboard is minimized.

## Home Screen widgets and location

Widgets support fixed landing and automatic nearest landing modes, app defaults and independent per-widget configuration. Fixed landing mode does not need location permission. Automatic selection requests foreground location first, then optional background access through Android settings. Location remains on the device; only the chosen landing ID is sent to the ferry API.

Android schedules background work, so automatic nearest selection is periodic rather than continuous. Widgets expose the data timestamp and saved/location status. Temporary location failure can use a clearly labeled last landing for up to six hours; revoked permission invalidates that fallback. Widget refresh and the main app use the same schedule engine and filters.

The smallest widget requires 180 × 180 dp. At large text sizes it prioritizes the departure time, destination, and freshness; optional detail and countdown remain in its accessible description and the full board. Medium and large widgets provide 48 dp refresh/settings controls. Reconfigure the small widget through the launcher's long-press action.

Links `ferryboard://nearby` and `ferryboard://landing/16` open widget setup and a landing's current departure board respectively.

## Repeatable verification

Install ARM64 default emulator images for API 31 and/or API 36 separately, then run:

```sh
scripts/android.sh test
FERRY_ANDROID_API=36 scripts/android.sh test
```

The helper creates/reuses only `FerryBoard_API31` or `FerryBoard_API36`, installs APKs using an explicit emulator serial, and saves APK hashes, a preflight window dump/screenshot, build logs, instrumentation output, logcat, and screenshots under ignored `artifacts/android/`. It rejects an active Android application-error or ANR dialog before instrumentation; restart the dedicated emulator if that preflight fails. It stops emulators it started unless `FERRY_KEEP_EMULATOR=1` is set. To reuse a running dedicated emulator, provide `FERRY_ANDROID_SERIAL=emulator-5554`; the helper verifies its AVD name and rejects physical devices.

For a focused rerun, set `FERRY_ANDROID_TEST_CLASS` to a fully qualified test class or `class#method`. The saved `command.txt` records the exact instrumentation selection.

Instrumentation launches the real activity with debug-only `FERRY_UI_TESTS`, `FERRY_RESET`, and `FERRY_OFFLINE` Boolean extras. Fixtures use a fixed clock and isolated app storage. Release builds do not package preview fixtures. Verify the packaging boundary with:

```sh
python3 scripts/check-android-artifact.py android/app/build/outputs/apk/debug/app-debug.apk --variant debug
python3 scripts/check-android-artifact.py android/app/build/outputs/apk/release/app-release-unsigned.apk --variant release
```

Consult the [verification report](VERIFICATION.md) for actual completed checks. Emulator evidence is separate from physical-device, background scheduling, and store-release acceptance.
