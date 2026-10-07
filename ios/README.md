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
- **Nearby Ferries** Home Screen widget for iPhone and iPad: nearest or fixed landing, operator filters, and configurable boat, assignment, dwell and layover details.
- Atomic disk snapshots of previously downloaded schedules and API responses. Preferences and ride state belong to this app and do not import browser storage.

Native departure push notifications are deferred. The web client's notification support remains available separately. Apple Maps' basemap needs a connection or Apple's cached map data.

## Nearby ferry widget

In Ferry Board, open **Settings → Nearby ferry widget**. Choose **Automatic nearest landing**, or turn it off and select a fixed landing. Fixed landings need no location permission. For automatic selection, tap **Enable location / find nearest** and allow location access. Touch and hold the Home Screen, choose **Edit → Add Widget**, and search for **Ferry Board** or **Nearby Ferries**. Small, medium and large sizes are supported on iPhone and iPad. Approve location access for the widget when iOS asks; this approval is separate from the app's permission. If access is off, tapping the widget opens its setup screen.

The setup screen saves shared widget defaults: operators, boat names, route assignments, dwells, layovers, countdowns, clock format, sorting, theme, text size, lookahead and departures per route. **Copy main app settings** takes a snapshot of the current landing, operator/route/NYC movement filters, appearance and departure display preferences. It preserves the widget-only boat-name, assignment and countdown choices. Changing widget defaults does not change the main app's settings; later main app changes require copying again. Copied route and movement filters can be cleared independently.

Touch and hold a widget and choose **Edit Widget**. **Use app widget defaults** starts enabled. Turn it off to give that particular widget its own automatic/fixed landing, hidden operators, detail switches, clock and sorting. These independent choices are not replaced when app widget defaults change. Route badges and operational crew/Pier C/status flags remain visible when boat names or numeric assignments are hidden.

The widget checks location whenever WidgetKit requests a new timeline and selects the closest landing with valid coordinates from the landing roster. It requests a refresh every 15 minutes, but iOS chooses actual refresh times. It does not track location continuously, so moving between docks does not guarantee an immediate change. Coordinates stay on the device; the API receives only the selected landing ID. Temporary GPS failure uses a clearly labeled last landing for at most six hours; denied permission never uses a saved location.

Scheduled departures advance through precomputed minute entries for two hours without another network download. The widget uses the app's service calendars, operational movement and dwell/turnaround rules. Live timing and vessel names expire after five minutes based on both download time and feed timestamp, with **≈** marking estimates and **Pred.** marking predicted boats. When a timeline expires, a refresh message replaces departures. The footer shows when the schedule was downloaded and identifies cached schedules as **Saved**. Tap the widget to open that landing's current board.

Each widget size measures how many departures fit (SwiftUI [ViewThatFits](https://developer.apple.com/documentation/swiftui/viewthatfits)), so large widgets fill their height and larger text shows fewer rows rather than clipping them. Countdowns keep to a right-aligned column. Small and medium widgets mark the location state with an icon beside the landing name: an arrow for the nearest landing, a pin for a fixed landing, and an orange crossed-out arrow for a last location waiting for GPS. Large widgets also spell it out. The footer dot uses the theme accent for a fresh download and orange for a saved schedule. On tinted and clear Home Screens, the widget drops theme colors so text stays legible in one color.

The extension uses its own API client and offline cache. The app shares widget defaults, landing choices and favorite markers through an explicit Keychain access group; App Groups and paid-account capabilities are not required by this setup. If shared defaults cannot be read, the widget asks you to open its settings rather than silently replacing your choices. Widget configuration follows [Apple's configurable widget guidance](https://developer.apple.com/documentation/widgetkit/making-a-configurable-widget), and location support follows [Apple's WidgetKit location guidance](https://developer.apple.com/documentation/widgetkit/accessing-location-information-in-widgets).

## iPad workspace

On iPad windows at least 760 points wide, a sidebar provides Departures/Harbor map navigation, searchable landings, favorites, and direct landing selection. It stays beside the board while the board still has room for two columns, as in landscape. Otherwise it starts hidden, opens over the board from the sidebar button, and closes after a choice. Narrower multitasking windows use the compact tab layout. Rotation, Split View and resizable windows are enabled. Sheets use the system presentation for the available space.

The departure board uses two columns whenever it is at least 600 points wide, including iPad portrait and iPhone landscape. Departures fill left to right, so the next two sailings share the top row; route groups tile the same way. Each departure takes two lines: time, route, destination and status, then the countdown, working vessel, flags, and dwell or layover. Accessibility text sizes keep one column. On wide screens riding mode shows the next landing and position beside the confirmed trips.

Choose an iPad destination in Xcode with the same **FerryBoard** scheme. To run the helper against an iPad simulator, set `IOS_SIMULATOR_ID` to its device identifier.

## Settings for a shift

Settings are available from the departures and map toolbars. **Text size** offers System, Compact and Larger; System accessibility text sizes remain in effect for every choice. Clock format, sorting and all nine themes are saved on the device. **Opening landing** can restore the last landing or use a chosen home landing; **Opening screen** can be Departures, Map or the last screen. Launch defaults apply on the next launch, while an active ride still restores your boat.

The departure board also offers dwell/layover visibility, one to five departures per route group, and a 30-minute to four-hour lookahead for today. Default values use the server's route count and window. These options change display behavior without rewriting downloaded schedules; known arrival/departure times and pickup/drop-off restrictions remain visible in trip details. Marine references and **Keep screen awake** are independent switches. Screen-awake behavior ends when the app leaves the foreground.

Settings links to operators, landings/favorites, alerts, the vessel picker and manual refresh. Older saved preferences migrate without losing favorites, filters or theme choices.

**Operators & routes** uses a left chevron to expand each operator's route switches. NYC Ferry also has independent switches for boats headed to Pier C, crew shuttles and other out-of-service movements. Route and movement filters combine; hiding an operator hides all of its departures while keeping its saved route choices. Filters apply to both board sorts and trip connections, and **Show all departures** resets them together. The landing roster supplies a route catalog across all docks; older servers still offer the current landing's routes.

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
