# Android Implementation Contract

Ferry Kitty targets Android 12 and later (minimum SDK 31, target/compile SDK 37). The Android app consumes the same API and schema 11 as the iOS app. Kotlin code uses tabs where practical.

## Modules and ownership

- `:core`, package `nyc.juliet.ferrykitty.core`: serializable wire models, schedule engine, filters, clock, network/cache repository, and widget projection. No Android dependencies.
- `:app`, package `nyc.juliet.ferrykitty`: Android lifecycle, preferences, permission flows, widgets, and Compose presentation.
- Installed Android identity remains `nyc.juliet.ferryboard`. `MainActivity` and the widget configuration activity, provider, job service, and boot receiver retain their original fully qualified class names in three compatibility source files under `nyc/juliet/ferryboard/`. Keep their manifest names explicit; relative names resolve against the new Gradle namespace.
- `contract/FerryContract.kt` is coordinator-owned. UI reads `FerryUiState` and emits `FerryAction`; it does not perform networking or persist preferences.
- The Compose entry point is `nyc.juliet.ferrykitty.ui.FerryApp(state: FerryUiState, onAction: (FerryAction) -> Unit)`. Widget setup also exposes `WidgetSettingsContent(state: FerryUiState, onAction: (FerryAction) -> Unit, modifier: Modifier = Modifier)` for the configuration activity.

## Core API conventions

Port the public iOS FerryCore types and behavior, retaining wire field names. Kotlin acronym parameters use `Id` (for example `landingId`, `tripId`). Wire `operator` fields retain their serialized name. Optional additive fields have sensible defaults; validation still rejects invalid replacement data. All temporal APIs use `java.time.Instant` and seconds as `Double` where the wire contract uses seconds.

- `Realtime.empty` supplies an unavailable/stale empty snapshot.
- `NYCFerryMovement` constants are `PIER_C`, `CREW_SHUTTLE`, and `OUT_OF_SERVICE`, serialized as `pierC`, `crewShuttle`, and `outOfService`.
- `DepartureFilters(hiddenOperators, hiddenRoutes, hiddenNYCMovements)` exposes `isActive` and `allows(departure, operatorName)` / `allows(routeId, operatorName)`.
- `ServiceClock.parts(now, timezone)` returns `dateKey` and `seconds`; `instant(text)` parses an optional Instant; `addDays(date, amount)` and `time(seconds, twelveHour)` match iOS behavior.
- `ScheduleEngine.frame(data, viewDate = null, now)`, `timeline(data, realtime = Realtime.empty, viewDate = null, now)`, and `groups(...)` preserve iOS semantics. Also expose `range`, `crewCoverage`, `departurePauses(data, row, realtime)` and `tripLayover(data, tripId, call, connectionTurnaround = null, live = false)`.
- `ScheduledDeparture` exposes the iOS properties, including `departure`, `serviceDate`, `delay`, `delta`, `live`, `hasLiveTiming`, boat names, LAST flags, `id`, and `relativeTime`.
- `FerryEndpoint(path, parameters = emptyMap())` has a deterministic `cacheKey`.
- `FerryTransport` has `suspend fun data(endpoint: FerryEndpoint): ByteArray`; `HTTPTransport(baseUrl: String)` implements it.
- `SnapshotCache(directory: java.io.File)` preserves original bytes with receipt time and atomic replacement.
- `FerryRepository(transport, cache, namespace = "production", clock = { Instant.now() })` exposes `suspend inline fun <reified T> fetch(endpoint, noinline validate: (T) -> Unit = {}): SavedResponse<T>` and nullable `saved<T>(...)` with the same arguments. `SavedResponse<T>` contains `value`, `saved`, `receivedAt: Instant`, and `warning: String?`.
- `DisplayData.validate(landingId: Int? = null)` checks the iOS invariants. `Connections.usable(tripId, serviceDate, now)` and `RideStop.instant(arrival, stale)` retain the existing rules.
- `WidgetOptions` matches iOS, with `landingId` rather than `landingID`; `NearbyWidgetBoard` shares filtering/timing behavior and location/live freshness limits.

## Assets and fixtures

Gradle copies the repository's bundled harbor geometry into production assets. The debug variant also includes `ios/FerryKitty/PreviewData`; the release variant must never include test fixtures or honor fixture launch flags. Debug fixture behavior uses the existing fixed clock `2026-09-04T12:50:00Z` and isolated storage. Tests must use deterministic transport and clock injection.

## Verification

Run `./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease`. Instrumentation uses only a coordinator-owned emulator, never an attached physical device by default. Do not install packages outside the approved dependency set or change unrelated iOS, web, server, feed, or deployment files.
