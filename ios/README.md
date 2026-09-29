# Ferry Board for iPhone and iPad

Universal SwiftUI app for iOS and iPadOS 17 or later, using the existing HTTPS API at `https://juliet.nyc`. The web app and deployment continue to work independently. There is no WebView, JavaScript bridge, CocoaPods, or third-party iOS SDK.

## New Mac setup

1. Install Xcode from the Mac App Store. Open it, finish first launch, and install iOS support in **Xcode → Settings → Components**.
2. Install [Homebrew](https://brew.sh), then `brew install xcodegen node@22`.
3. From the repository root:

   ```sh
   export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
   export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
   npm ci
   npx playwright install chromium
   scripts/ios.sh open
   ```

XcodeGen creates the ignored `ios/FerryBoard.xcodeproj` from `project.yml`. Edit the YAML for shared project changes. The helper selects Xcode for its own process, so it does not change the machine's global command line tools selection.

## Install on your iPhone or iPad

1. In **Xcode → Settings → Apple Accounts**, sign in with your Apple account.
2. Copy `ios/Local.xcconfig.example` to `ios/Local.xcconfig`. Set `DEVELOPMENT_TEAM` to your team's ID. This file is ignored by Git. Alternatively choose the team in the generated target's **Signing & Capabilities** settings (regeneration replaces project-only changes).
3. Connect and trust the iPhone or iPad, enable **Settings → Privacy & Security → Developer Mode**, and select it in Xcode's destination menu.
4. Choose the **FerryBoard** scheme and press **Run**. Complete any Apple signing/trust prompts.

After the account is ready, the same installation can be run from the terminal:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun devicectl list devices
scripts/ios.sh device YOUR_IPHONE_UDID
```

If Xcode reports **No Accounts** or **missing Xcode-Username**, resolve the account credential in Xcode's Apple Accounts settings and run the project once there. The app cannot install with an unsigned build. Signing credentials and provisioning profiles are not stored in this repository.

## Features

- Time and route departure views, date browsing, crew/final/last badges, assignments and explicitly labeled predictions.
- Landing search, favorites, operator filters, 12/24-hour clocks, and all nine themes.
- Service alerts, published trip stops, current-day connections, and terminal layovers.
- Apple Maps with vessel and landing selection, search, route filters, bridge and marine references.
- A physical-vessel picker, riding dashboard, confirmed trip history, minimize/switch/exit, and foreground restoration.
- A one-shot **Nearest** location request. Riding mode does not request location access.
- Atomic disk snapshots of previously downloaded schedules and API responses. Preferences and ride state belong to this app and do not import browser storage.

Native departure push notifications are deferred. The web client's notification support remains available separately. Apple Maps' basemap needs a connection or Apple's cached map data.

## iPad workspace

On iPad windows at least 760 points wide, a sidebar provides Departures/Harbor map navigation, searchable landings, favorites, and direct landing selection. It stays beside the board while the board still has room for two columns, as in landscape. Otherwise it starts hidden, opens over the board from the sidebar button, and closes after a choice. Narrower multitasking windows use the compact tab layout. Rotation, Split View and resizable windows are enabled. Sheets use the system presentation for the available space.

The departure board uses two columns whenever it is at least 600 points wide, including iPad portrait and iPhone landscape. Departures fill left to right, so the next two sailings share the top row; route groups tile the same way. Each departure takes two lines: time, route, destination and status, then the countdown, working vessel, flags, and dwell or layover. Accessibility text sizes keep one column. On wide screens riding mode shows the next landing and position beside the confirmed trips.

Choose an iPad destination in Xcode with the same **FerryBoard** scheme. To run the helper against an iPad simulator, set `IOS_SIMULATOR_ID` to its device identifier.

## Settings for a shift

Settings are available from the departures and map toolbars. **Text size** offers System, Compact and Larger; System accessibility text sizes remain in effect for every choice. Clock format, sorting and all nine themes are saved on the device. **Opening landing** can restore the last landing or use a chosen home landing; **Opening screen** can be Departures, Map or the last screen. Launch defaults apply on the next launch, while an active ride still restores your boat.

The departure board also offers dwell/layover visibility, one to five departures per route group, and a 30-minute to four-hour lookahead for today. Default values use the server's route count and window. These options change display behavior without rewriting downloaded schedules; known arrival/departure times and pickup/drop-off restrictions remain visible in trip details. Marine references and **Keep screen awake** are independent switches. Screen-awake behavior ends when the app leaves the foreground.

Settings links to operators, landings/favorites, alerts, the vessel picker and manual refresh. Older saved preferences migrate without losing favorites, filters or theme choices.

## Data and freshness

`FerryCore` models schema 11 of [the shared API](../docs/api.openapi.json), ignores unknown additive fields, validates landing/vessel identity, and preserves original response bytes in the cache. Invalid or incomplete replacement responses cannot overwrite a valid saved schedule. Cache keys include the deployment, endpoint, and selected landing/vessel.

The Swift schedule engine reads the same [`schedule-contract.json`](../test/fixtures/schedule-contract.json) as JavaScript tests: service calendars and exceptions, New York time and DST, prior-service-day departures beyond 24:00, no early departures, cancellations, prediction labels, lookahead windows, ordering and LAST rules. Browsing other dates never applies today's live updates. Crew confirmation and holiday-only departures have additional regression coverage.

Visible feeds refresh every 15 seconds while active; alerts refresh once per minute. Backgrounding cancels polling and marks live information stale. In-flight requests cannot replace a newer landing selection or resurrect an exited ride. Offline riding uses scheduled arrival and departure times separately, suppresses live speed/countdowns, and displays the snapshot's service date. Connections require the selected trip/service day and a response generated within five minutes.

The app stores no user location remotely. Its privacy manifest declares UserDefaults for app-local preferences under [Apple's required-reason API rules](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest). Map attribution and reference notes appear in the app.

## Verification

```sh
scripts/ios.sh core                  # Portable schedule, cache and timing tests
scripts/ios.sh build                 # Compile for arm64 simulator without a runtime
scripts/ios.sh test                  # Store tests and native UI journeys
FERRY_LIVE_SMOKE=1 scripts/ios.sh core --filter LiveContractTests
```

`test` creates/reuses a dedicated **FerryBoard iPhone** simulator. Install an iOS runtime first; the helper prints the command if missing. Set `IOS_SIMULATOR_ID` to use another simulator. The tablet layout journey runs only on an iPad simulator, and the other journeys use the iPhone tab bar. Xcode test results and coverage are under ignored `ios/DerivedData/Logs/Test/`.

UI tests use bundled fixtures and a fixed clock, with an isolated defaults suite and cache. `FERRY_UI_TESTS`, `FERRY_RESET`, and `FERRY_OFFLINE` only affect Debug builds. Rebuild fixtures with `npm run fixtures:ios` after an intentional contract change; the generator reads the canonical shared schedule fixture. Release builds use the live API.

Web regression checks remain:

```sh
npm test
PORT=8094 node server.js
# In another terminal:
npm run test:staff-app
npm run test:riding-mode
```

See [verification.md](verification.md) for the current implementation's actual results and remaining device checks.
