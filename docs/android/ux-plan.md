# Android UX plan

This is the design and parity plan for the native Android Ferry Kitty app. It ports the shipping iOS app
(`ios/FerryKitty`, `ios/FerryKittyWidget`) to Kotlin and Jetpack Compose, using the web map
(`public/assets/map.js`, `public/assets/map.css`) as the reference for native harbor cartography. Android shows the
same data as iOS from the same HTTPS API (schema 11); it never uses a WebView.

All presentation lives in `android/app/src/main/java/nyc/juliet/ferrykitty/ui/`. The UI reads
`FerryUiState` and emits `FerryAction` (see `contract/FerryContract.kt`); it never performs networking or persists
preferences. Pure presentation rules sit in plain Kotlin objects with JVM unit tests under
`android/app/src/test/java/nyc/juliet/ferrykitty/ui/`.

## Layout

| Window | Navigation | Board |
| --- | --- | --- |
| Width below 600 dp | Bottom navigation bar: Departures, Map | One column; shortcuts scroll above the pinned date and sort bar |
| 600–839 dp, or any phone in landscape (height below 480 dp) | Navigation rail | Two columns once the board itself is 600 dp wide |
| 840 dp and wider, at least 480 dp tall | Permanent 300 dp sidebar with Departures / Harbor map and the searchable landing list (`tabletWorkspace`) | Two columns; shortcuts join the date and sort bar |

- Two columns read left to right, so the next two sailings share the top row (iOS `BoardLayout`). Accessibility text
  (font scale 1.5 and above) always keeps one column and stacks each row.
- A minimized ride shows a 56 dp ride bar above the navigation (or at the bottom of the content on rail and sidebar
  layouts).
- Every control is at least 48 dp. System back closes a sheet sub-page, then the sheet, then the ride dashboard
  (minimize), then returns from the map to the departures board.

## Theme and text

- Nine themes from `ios/FerryKitty/Theme.swift`, in iOS order: NYC Ferry, Night, Hello Kitty, Cinnamoroll,
  Pompompurin, Kuromi, Windows XP, Hacker and Burger King. Accent, background and light/dark come from iOS; surfaces,
  ink, muted text and lines come from the web board palettes. Status colors (on time, delayed or no pickup, last)
  are chosen per theme so every text color passes WCAG AA on its surface, including tinted status pills. The NYC Ferry
  accent is one step darker (`#0076A6`) than iOS so it passes AA on the board background.
- `FerryThemes`, `FerryPalette`, `MapPalette`, `ColorMath` and `TextScale` are plain Kotlin (ARGB longs) so the
  widget renderer reuses exact colors.
- Text size: System follows the device. Compact uses 0.9× only when the device font is at or below the default;
  Larger raises the scale to at least 1.2×. An enlarged device font is never reduced. When the preference resolves to
  the device scale, the device's own density (including Android 14 non-linear scaling) is kept untouched.
- Status and navigation bar icons follow the theme's light or dark appearance. Keep screen awake applies only while
  the activity is resumed.

## Departures board

Ported from `BoardView.swift`:

- Top bar: landing button (title, green dot when live, clock, freshness: Live estimates, Scheduled · saved data,
  Scheduled · live unavailable or Published schedule), filter (filled when filters are on) and settings.
- Shortcuts: Your boat (returns to an active ride or opens the vessel picker), Nearest (`FindNearest`, shows
  Locating… while the root locates), then favorite landings with the current one selected.
- Pinned bar: previous and next day limited to `ScheduleEngine.range`, the date label (Today in the accent color; a
  browsed date in amber with its weekday, which returns to today when tapped), a calendar limited to the schedule's
  range, and the Time / Route sort.
- Notices: crew and holiday notes, schedule errors, saved-data warnings, location problems, then a service alert line
  when alerts are active or the alert feed failed.
- Rows: time (with delay and `*` for approximate), countdown (Boarding / Due, minutes, hours), route badge or partner
  mark, destination, status pill (DROP OFF ONLY, NO PICKUP, +Nm, ON TIME, SCHED), LAST and FINAL / FINAL? pills, then
  working number and vessel (predicted names in italics with a question mark), crew shuttle and out-of-service
  windows, operator, VIA terminals, dwell and layover (est / sched) and the home-port note. TalkBack reads each row
  as one sentence (`BoardFormat.spoken`).
- Route sort shows groups with a tinted heading; time sort shows rows with one rule per line.
- Empty states match iOS: Schedule unavailable + Try again, No matching departures + Show all departures, No
  scheduled departures, and a date outside the saved schedule.

## Sheets

Sheets are full-height modal bottom sheets with a Done button (`dismissSheet`). Sub-pages (theme, home landing,
fixed widget landing, and the tools reached from Settings) are local pages with a back arrow (`sheetBack`).

- Landings: search by name or number, favorites first, star toggles, current landing check, landing numbers and
  Nearest.
- Operators & routes: an operator switch with an expand button for its route switches; NYC Ferry also lists the
  independent Pier C, crew shuttle and out-of-service movement switches. Routes are disabled while their operator is
  hidden. Show all departures resets every filter.
- Settings: every iOS preference (text size, 12-hour time, default sort, theme, dwell, layover, departures per route,
  look ahead, opening landing, home landing and Use … as home, opening screen, marine references, keep screen awake),
  tools (widget, filters, landings, alerts, choose or switch boats, refresh with result note) and the app section
  (what's new, website, offline and attribution notes).
- Service alerts, What's new, the vessel picker (search, suggested vessel first), trip details, vessel, bridge and
  seamark details.
- Trip details (`TripView.swift`): summary, movement and LAST lines, VIA, holiday note, vessel on map and Ride this
  boat; then every stop with ARR / DEP clocks (EST when connections are fresh, with the scheduled time beside), pickup
  restrictions, dwell and layover, and connecting departures filtered like the board. Notes say when connections are
  saved, unavailable, today-only or timetable-only.

## Ride dashboard

Ported from `RideView.swift`. A full-screen layer while `showingRide`; system back minimizes. The top bar has
Minimize, Switch boats and Exit boat as visible actions.

- Vessel name (`rideVesselName`), hull number and a LIVE / SAVED / CONNECTING pill.
- Current trip and an out-of-service note, then the next-landing card: AT LANDING / NEXT LANDING / LAST REPORTED NEXT
  LANDING, speed when live, the landing, service restrictions, arrival and departure clocks with the words estimated
  or scheduled (`rideArrival`), dwell and layover, a live countdown and the position time.
- A native mini map of the boat's position (disclosure on phones, always open on wide screens) with Open full map.
- Every confirmed trip of the day as an expandable card (the current trip opens expanded); stops with a landing open
  that landing's board. The history note closes the list.

## Harbor map (Compose Canvas)

The map is drawn natively from the bundled `assets/harbor-chart.json` (copied by Gradle from
`content/harbor-chart.json`) plus `/api/map` routes and landings and `/api/boats` positions. The pure layer is in
`ui/map`: `HarborProjection` (Web Mercator in local drawing units, Float-exact), `CameraPosition` (fit, pan,
zoom about a point, clamp, geometric interpolation), `ChartParser` / `ChartGeometry` (lenient chart parsing, seamark
styles, place labels, attribution) and `VesselSearch` (hull labels, search, staleness, readable marker text,
status lines).

Entry points: `HarborMapScreen(state, ui, camera, contentPadding, modifier)`, `HarborCameraState` /
`rememberHarborCameraState()` (hoisted in `FerryApp`, saveable) and `RideMiniMap(position, stale, modifier)`.

### Data

- Parse the chart once per process on `Dispatchers.Default` and share it with the ride mini map. A failed parse
  draws water, routes and landings and says the chart is unavailable.
- Bridges and seamarks come from `state.harbor.chart`, else from the bundled chart; seamark colors come from
  `ChartGeometry.styleFor`. They are drawn only while Marine references is on.
- Boats are `VesselSearch.filter(boats, state.mapSearch, state.routeFilter)`.

### Camera and gestures

- Fit to `state.harbor.bounds` (else the chart bounds) with 24 dp padding; zoom between 0.75× and 20× of fit; center
  clamped to the chart. North is always up.
- One-finger pan with fling, two-finger pinch about the centroid, double tap zooms in 2× about the tap, single tap
  selects (vessels, then landings, then seamarks, then bridges, within 24 dp). Zoom in, zoom out and Fit harbor are
  48 dp buttons. Camera changes only invalidate drawing; nothing recomposes per frame.
- An explicit Find boat request eases to the reporting vessel at no less than 5× fit, including a repeated request
  for the same vessel. The saveable camera consumes each request once so tab, layout and rotation restoration
  retain the user’s view. Selecting a vessel marker or list row also focuses that vessel.

### Drawing (theme `MapPalette`)

1. Water, then land polygons (even-odd with holes) with a hairline shoreline.
2. Parks outlined; navigation channels dashed.
3. Street casings and lines; priority streets darker; highways wider.
4. Route lines with a water-colored casing, translucent until a route is chosen (other routes then hide).
5. Bridges (casing and deck) and seamarks: lights with a halo; green cans, red nuns and safe-water buoys appear at
   close zoom (2.2× fit) with their labels.
6. Place labels (boroughs, waters, Central Park, Governors Island) and street labels, collision-free, upright, one
   per street name; side streets only at close zoom.
7. Landings: small card-colored circles with an ink rim; major landings are labeled at every zoom and all at close
   zoom, flipping left near the edge; the board's landing has an accent ring; the selected vessel's next stop is
   amber.
8. Vessels on top: 32 dp circles in the route color with the compact hull label (`H-204` → `H204`, `?` when unknown)
   in a readable color, no boat icons or bearing arrows (iOS commit 4b506b5). The selected vessel gets a ring and its
   name. Stale fixes (feed stale or older than 180 s) are translucent with a dashed rim.
9. Overlays: zoom buttons, a scale bar, and the attribution (`© OpenStreetMap contributors · CARTO · OpenSeaMap
   (ODbL)`), which opens the OpenStreetMap copyright page.

### Layout and interaction

- Phones: top bar (route filter menu with Marine references, settings), the search field (`vesselSearch`) and a
  status line (route, reporting count, Live or Saved / unavailable, not-reporting and error notes), the map, then a
  collapsible panel (open by default in portrait, closed in short landscape) with Vessels, Landings and Marine lists
  and Your boat (`chooseBoat`). Wide screens put that panel beside the map.
- Vessel taps send `OpenBoat(id)` and focus the camera. Landing taps open a callout with the landing's name and
  number, a favorite star and Departures (`SelectLanding`). Bridges and seamarks open their detail sheets.
- Accessibility: invisible semantic nodes sit over every vessel (`mapBoatMarker-<id>`) and landing
  (`mapLandingMarker-<id>`) with clear labels and click actions; the lists repeat every map object; the canvas has a
  summary description (`harborMap`).

### Ride mini map

The same renderer with a fixed camera centered on the boat (about 0.02° of latitude), no gestures, the landing
markers and one position marker: accent when live, muted with "Last reported" when stale.

## Widget visual guidance

The widget is rendered with RemoteViews by the platform code; this is its design, mirroring
`ios/FerryKittyWidget/NearbyWidgetView.swift`.

- Sizes: small, medium and large size-mapped RemoteViews with 12–16 dp padding. The advertised minimum is
  180 × 180 dp (a 3×3 placement hint); launcher cell dimensions vary. Small widgets open the board when tapped and
  use the launcher’s reconfigure action. Medium and large headers provide 48 dp Refresh and Settings controls.
- Header: location icon (automatic: my location in the accent; fixed: a pin; stale or last location: location off in
  amber), then the landing name in bold. The 4×4 size adds the location label underneath.
- Rows fill the height (a collection list on the large size): time in bold tabular figures (`~` when estimated),
  route code in the accent, destination on one line (its own line on the small size), a right-aligned countdown
  (positive color when estimated) when countdowns are on, and the detail line in the muted color.
- Messages (setup, filters, location unavailable, stale data) replace the rows.
- Footer: explicit Updated or Saved dates and times, plus a separate estimate timestamp when needed. Compact
  widgets shorten these labels but keep the full accessible description. Unavailable data says Not updated.
- With large system text, the smallest widget prioritizes the departure clock, destination and freshness; optional
  detail and countdown remain in the accessible description and the full board. Medium widgets reduce to one row
  when enlarged text needs the space.
- Theme: `system` follows the device; other themes use `FerryThemes.resolve(id)` with a faint top wash. Text uses
  `TextScale.resolve(systemFontScale, options.textSize)`.
- The configuration activity hosts `WidgetSettingsContent` with the per-widget Use app widget defaults switch.

## Widget settings

`WidgetSettingsContent(state, onAction, modifier)` serves both the app's Nearby ferry widget page and the widget
configuration activity (`configuringWidget`). Sections: this widget (use app defaults), widget defaults (copy main
app settings), landing (automatic nearest with Enable background location / find nearest and the status, or a fixed
landing), operators (with the copied route and movement filters note and clear), information shown (boat names,
assignments, dwell, layover, countdowns), reading (12-hour, sort by route, theme including Follow device, text size,
look ahead, departures per route), refresh and reset, add to home screen, and shift notes.

## Parity notes

| iOS | Android |
| --- | --- |
| `NavigationSplitView` landing sidebar on iPad | Permanent sidebar at 840 dp and wider; rail between 600 and 840 dp |
| `TabView` | Bottom navigation bar |
| Sheets with `NavigationStack` | Modal bottom sheets with local sub-pages and system back |
| Ride `fullScreenCover`, actions in a menu | Full-screen layer; Switch boats and Exit boat are visible top-bar actions |
| MapKit map | Compose Canvas chart from bundled geometry (no tiles, works offline) |
| Partner logo images | Coordinator-provided `partner_*` drawables |
| Dynamic Type sizes | Android font scale with the same Compact / Larger rules |
| WidgetKit timeline | Platform RemoteViews widget following the guidance above |

## Verification

See [Android Verification](../../android/VERIFICATION.md) for executed checks and retained screenshots. Automated
semantic actions and native widget inflation are separate from manual TalkBack traversal, real launcher binding
and physical-device acceptance.
