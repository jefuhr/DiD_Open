package nyc.juliet.ferrykitty.platform

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import nyc.juliet.ferrykitty.contract.*
import nyc.juliet.ferrykitty.core.*
import java.time.Instant
import java.time.LocalDate

/** Pure state engine. Calls are confined to the injected scope's single UI/test dispatcher. */
class FerryStateStore(
	private val repository: FerryRepository,
	private val settings: FerrySettings,
	private val scope: CoroutineScope,
	private val clock: () -> Instant = { Instant.now() },
	private val onEffect: (FerryAction) -> Unit = {},
	private val onWidgetDefaultsChanged: () -> Unit = {},
	private val widgetDraft: Boolean = false,
) {
	private val widgets = WidgetSettingsStore(settings)
	private var customWidgetOptions = widgets.defaults()
	private val restoredPreferences = PreferenceCodec.decode(settings.read("preferences"))
	private val initialPreferences = if (restoredPreferences.launchLanding == "home") restoredPreferences.copy(landingId = restoredPreferences.homeLandingId) else restoredPreferences
	private val initialTab = when (initialPreferences.launchTab) { "map" -> FerryTab.MAP; "lastUsed" -> initialPreferences.lastTab; else -> FerryTab.DEPARTURES }
	private val restoredSession = settings.read("ride-session")?.let { runCatching { ferryJson.decodeFromString<RideSession>(it) }.getOrNull() }
		?.takeIf { it.vessel.id.isNotBlank() && it.startedAtEpochMillis >= 0 }
	private val mutableState = MutableStateFlow(FerryUiState(preferences = initialPreferences, tab = initialTab, now = clock(), rideSession = restoredSession, widgetOptions = widgets.defaults()))
	val state: StateFlow<FerryUiState> = mutableState.asStateFlow()
	private var active = false
	private var lifecycleGeneration = 0L
	private var landingGeneration = 0L
	private var rideGeneration = 0L
	private var tripGeneration = 0L
	private var feedGeneration = 0L
	private var locationGeneration = 0L
	private var lastAlerts: Instant? = null
	private var realtimeReceivedAt: Instant? = null
	private var pendingLink: FerryWidgetLink? = null
	private var navigatingFromLink = false
	private var hydrated = false
	private var initialActivation = true
	private var polling: Job? = null
	private val requests = mutableMapOf<String, Job>()

	fun setActive(value: Boolean) {
		if (active == value) return
		active = value; lifecycleGeneration++; locationGeneration++
		polling?.cancel(); polling = null
		requests.values.toList().forEach { it.cancel() }; requests.clear()
		update { markSaved(it).copy(loadingLanding = false, refreshing = false, locating = false) }
		if (!value) return
		if (!widgetDraft && restoredSession != null && !navigatingFromLink && initialActivation) update { it.copy(showingRide = true) }
		initialActivation = false
		val life = lifecycleGeneration
		launchRequest("bootstrap-$life") {
			if (!hydrated && !widgetDraft) hydrate(life)
			if (!current(life)) return@launchRequest
			refreshRoster(life)
			if (!widgetDraft) loadShared(life)
			refreshVisible()
		}
		polling = scope.launch {
			var seconds = 0
			while (isActive && current(life)) {
				delay(1_000)
				if (!current(life)) break
				update { expire(it.copy(now = clock())) }
				seconds++
				if (seconds % 15 == 0) refreshVisible()
			}
		}
		// Visible feeds start independently; a slow landing roster cannot delay a restored ride.
		if (!widgetDraft) state.value.preferences.landingId?.let { loadLanding(it) }
		refreshVisible()
	}

	fun close() { setActive(false) }
	private fun current(life: Long) = active && life == lifecycleGeneration
	private fun landingCurrent(id: Int, generation: Long, life: Long) = current(life) && generation == landingGeneration && state.value.preferences.landingId == id
	private fun rideCurrent(id: String, generation: Long, life: Long) = current(life) && generation == rideGeneration && state.value.rideSession?.vessel?.id == id
	private fun launchRequest(key: String, block: suspend () -> Unit) {
		if (!active || requests[key]?.isActive == true) return
		lateinit var job: Job
		job = scope.launch(start = CoroutineStart.LAZY) {
			try { block() } catch (_: CancellationException) { /* Generation guards also reject uncancellable transports. */ }
			finally { if (requests[key] === job) requests.remove(key) }
		}
		requests[key] = job; job.start()
	}
	private fun update(change: (FerryUiState) -> FerryUiState) {
		val next = change(state.value)
		val today = next.schedule?.let { ScheduleEngine.frame(it, now = next.now).today }
		// A browsed future date can become today during foreground polling or a background/resume.
		mutableState.value = project(if (next.viewDate != null && next.viewDate == today) next.copy(viewDate = null) else next)
	}
	private fun persistPreferences(value: AppPreferences) {
		runCatching { settings.write("preferences", PreferenceCodec.encode(value)) }.onFailure { update { it.copy(offlineWarning = "Settings could not be saved. Please try again.") } }
	}
	private fun persistSession(value: RideSession?) {
		runCatching { settings.write("ride-session", value?.let { ferryJson.encodeToString(it) }) }.onFailure { update { it.copy(rideError = "Your ride session could not be saved.") } }
	}
	private fun changeTab(tab: FerryTab) {
		feedGeneration++
		val prefs = state.value.preferences.copy(lastTab = tab)
		val session = state.value.rideSession?.let { if (!state.value.showingRide) it.copy(returnTab = tab) else it }
		update { it.copy(tab = tab, preferences = prefs, rideSession = session) }
		persistPreferences(prefs); persistSession(session)
		refreshVisible()
	}

	fun dispatch(action: FerryAction) {
		when (action) {
			is FerryAction.SelectTab -> changeTab(action.tab)
			is FerryAction.OpenSheet -> {
				tripGeneration++
				update { it.copy(sheet = action.sheet, trip = if (action.sheet == FerrySheet.TRIP) it.trip else null) }
				if (action.sheet == FerrySheet.ALERTS) refreshAlerts()
				if (action.sheet in setOf(FerrySheet.VESSELS, FerrySheet.CHANGELOG)) loadShared(lifecycleGeneration, force = true)
			}
			is FerryAction.SelectLanding -> selectLanding(action.id)
			is FerryAction.ToggleFavorite -> {
				if (action.id <= 0 || state.value.roster?.landings?.none { it.id == action.id } == true) return
				val p = state.value.preferences
				val next = p.copy(favorites = if (action.id in p.favorites) p.favorites - action.id else p.favorites + action.id)
				update { it.copy(preferences = next) }; persistPreferences(next)
			}
			is FerryAction.SetPreferences -> {
				val oldId = state.value.preferences.landingId
				val next = PreferenceCodec.normalize(action.preferences).copy(lastTab = state.value.tab)
				update { it.copy(preferences = next) }; persistPreferences(next)
				if (oldId != next.landingId) invalidateLanding(next.landingId)
			}
			is FerryAction.SelectDate -> selectDate(action.date)
			is FerryAction.StepDate -> {
				val data = state.value.schedule ?: return
				val frame = ScheduleEngine.frame(data, viewDate = state.value.viewDate, now = state.value.now)
				selectDate(ServiceClock.addDays(frame.dateKey, action.days))
			}
			FerryAction.Refresh -> refreshAll()
			FerryAction.ResetFilters -> dispatch(FerryAction.SetPreferences(state.value.preferences.copy(hiddenOperators = emptySet(), hiddenRoutes = emptySet(), hiddenNYCMovements = emptySet())))
			FerryAction.FindNearest -> { locationGeneration++; update { it.copy(locating = true, locationStatus = "Finding the nearest landing…") }; onEffect(action) }
			is FerryAction.OpenTrip -> openTrip(action.row)
			is FerryAction.OpenBoat -> {
				update { it.copy(selectedBoatId = action.id, selectedBoat = it.boats?.boats?.firstOrNull { boat -> boat.id == action.id }, sheet = FerrySheet.BOAT, wantedVesselName = null, boatFocusRequest = null) }
			}
			is FerryAction.FindBoat -> {
				if (action.name.isBlank()) return
				update { it.copy(wantedVesselName = action.name.trim(), boatFocusRequest = java.util.UUID.randomUUID().toString(), selectedBoatId = null, selectedBoat = null, mapSearch = "", routeFilter = null, sheet = null, showingRide = false) }
				resolveWantedBoat(); changeTab(FerryTab.MAP)
			}
			is FerryAction.SetMapSearch -> update { it.copy(mapSearch = action.query) }
			is FerryAction.SetRouteFilter -> update { it.copy(routeFilter = action.id) }
			is FerryAction.OpenBridge -> update { it.copy(selectedBridge = action.bridge, sheet = FerrySheet.BRIDGE) }
			is FerryAction.OpenSeamark -> update { it.copy(selectedSeamark = action.seamark, sheet = FerrySheet.SEAMARK) }
			is FerryAction.StartRide -> startRide(action.vessel)
			FerryAction.ShowRide -> if (state.value.rideSession != null) { feedGeneration++; update { it.copy(showingRide = true, sheet = null) }; refreshRide() }
			FerryAction.MinimizeRide -> { feedGeneration++; val tab = state.value.rideSession?.returnTab ?: FerryTab.DEPARTURES; update { it.copy(showingRide = false) }; changeTab(tab) }
			FerryAction.ExitRide -> exitRide()
			is FerryAction.SetWidgetOptions -> setWidgetOptions(action.options)
			is FerryAction.SetWidgetUseDefaults -> {
				if (!state.value.widgetUseAppDefaults) customWidgetOptions = state.value.widgetOptions
				update { it.copy(widgetUseAppDefaults = action.enabled, widgetOptions = if (action.enabled) widgets.defaults() else customWidgetOptions) }
			}
			FerryAction.CopySettingsToWidget -> setWidgetOptions(copyMainSettings(state.value.widgetOptions, state.value.preferences, state.value.roster))
			FerryAction.ResetWidgetFilters -> setWidgetOptions(state.value.widgetOptions.copy(hiddenOperators = emptySet(), hiddenRoutes = emptySet(), hiddenNYCMovements = emptySet()))
			FerryAction.EnableWidgetLocation, FerryAction.RefreshWidgets, FerryAction.PinWidget, is FerryAction.OpenUrl -> onEffect(action)
		}
	}

	private fun setWidgetOptions(options: WidgetOptions) {
		val normalized = PreferenceCodec.normalize(options)
		customWidgetOptions = normalized
		update { it.copy(widgetOptions = normalized, widgetUseAppDefaults = false, widgetStatus = null) }
		if (!widgetDraft) runCatching { widgets.saveDefaults(normalized); onWidgetDefaultsChanged() }.onFailure { update { it.copy(widgetStatus = "Widget settings could not be saved.") } }
	}
	fun configureWidget(record: WidgetSettings) { customWidgetOptions = record.options; update { it.copy(configuringWidget = true, widgetUseAppDefaults = record.useAppDefaults, widgetOptions = if (record.useAppDefaults) widgets.defaults() else record.options) } }
	fun widgetRecord() = WidgetSettings(state.value.widgetUseAppDefaults, if (state.value.widgetUseAppDefaults) customWidgetOptions else state.value.widgetOptions)
	fun widgetStatus(message: String?) { update { it.copy(widgetStatus = message) } }
	fun locationRequestToken() = locationGeneration
	fun locationResult(token: Long, landingId: Int?, message: String) {
		if (!active || token != locationGeneration) return
		if (landingId != null) selectLanding(landingId)
		update { it.copy(locating = false, locationStatus = message) }
	}

	fun handleLink(link: FerryWidgetLink) {
		navigatingFromLink = true; pendingLink = link; feedGeneration++; tripGeneration++
		update { it.copy(showingRide = false, tab = FerryTab.DEPARTURES, viewDate = null, sheet = null, trip = null) }
		resolvePendingLink()
	}
	private fun resolvePendingLink() {
		when (val link = pendingLink ?: return) {
			FerryWidgetLink.Nearby -> { pendingLink = null; update { it.copy(sheet = FerrySheet.WIDGET) } }
			is FerryWidgetLink.Landing -> {
				val roster = state.value.roster ?: return
				pendingLink = null
				if (roster.landings.any { it.id == link.id }) selectLanding(link.id) else update { it.copy(sheet = FerrySheet.LANDINGS) }
			}
		}
	}

	private fun selectLanding(id: Int) {
		if (id <= 0 || state.value.roster?.landings?.none { it.id == id } == true) { update { it.copy(sheet = FerrySheet.LANDINGS) }; return }
		locationGeneration++
		update { it.copy(locating = false, locationStatus = null) }
		val p = state.value.preferences.copy(landingId = id, lastTab = FerryTab.DEPARTURES)
		if (p.landingId == state.value.preferences.landingId && state.value.schedule != null) {
			update { it.copy(sheet = null, showingRide = false) }; changeTab(FerryTab.DEPARTURES); return
		}
		update { it.copy(preferences = p, showingRide = false, sheet = null) }
		invalidateLanding(id)
		changeTab(FerryTab.DEPARTURES)
	}
	private fun invalidateLanding(id: Int?) {
		landingGeneration++; tripGeneration++; locationGeneration++
		requests.filterKeys { it.startsWith("landing-") || it.startsWith("realtime-") || it.startsWith("connections-") }.values.toList().forEach { it.cancel() }
		realtimeReceivedAt = null
		update { it.copy(schedule = null, scheduleSaved = false, realtime = Realtime.empty, viewDate = null, boardError = null, offlineWarning = null, loadingLanding = id != null && active, locating = false, locationStatus = null, trip = null) }
		if (id != null) loadLanding(id)
	}
	private fun selectDate(date: String?) {
		val data = state.value.schedule ?: return
		val today = ScheduleEngine.frame(data, now = state.value.now).today
		val selected = date?.takeUnless { it == today }
		if (selected != null && (runCatching { LocalDate.parse(selected) }.isFailure || ScheduleEngine.range(data)?.contains(selected) != true)) return
		tripGeneration++; update { it.copy(viewDate = selected, trip = null, sheet = if (it.sheet == FerrySheet.TRIP) null else it.sheet) }
	}

	private suspend fun hydrate(life: Long) {
		val session = state.value.rideSession
		val rideGen = rideGeneration
		if (session != null) {
			val saved = repository.saved<Ride>(FerryEndpoint("api/ride", mapOf("vesselId" to session.vessel.id))) { require(it.vessel.id == session.vessel.id) }
			if (saved != null && rideCurrent(session.vessel.id, rideGen, life) && state.value.ride == null) update { it.copy(ride = saved.value.copy(stale = true, positionStale = true), rideError = "Saved boat data") }
		}
		val roster = repository.saved<LandingRoster>(FerryEndpoint("api/landings"))
		if (!current(life)) return
		if (roster != null) applyRoster(roster.value)
		val id = state.value.preferences.landingId
		val generation = landingGeneration
		if (id != null) {
			val saved = repository.saved<DisplayData>(FerryEndpoint("api/display-data", mapOf("landingId" to "$id"))) { it.validate(id) }
			if (saved != null && landingCurrent(id, generation, life) && state.value.schedule == null) applySchedule(saved)
		}
		val harbor = repository.saved<Harbor>(FerryEndpoint("api/map"))
		val vessels = repository.saved<Vessels>(FerryEndpoint("api/vessels"))
		val changelog = repository.saved<Changelog>(FerryEndpoint("api/changelog"))
		if (current(life)) {
			update { it.copy(harbor = it.harbor ?: harbor?.value, vessels = it.vessels.ifEmpty { vessels?.value?.vessels.orEmpty() }, changelog = it.changelog ?: changelog?.value) }
			hydrated = true
		}
	}
	private fun applyRoster(roster: LandingRoster) {
		update { it.copy(roster = roster) }
		resolvePendingLink()
		if (widgetDraft) return
		val p = state.value.preferences
		if (p.landingId == null || roster.landings.none { it.id == p.landingId }) {
			val configured = roster.configured.takeIf { id -> roster.landings.any { it.id == id } }
			val next = p.copy(landingId = configured)
			update { it.copy(preferences = next) }; persistPreferences(next)
			invalidateLanding(configured)
		}
	}
	private fun refreshRoster(life: Long) = launchRequest("roster-$life") {
		try {
			val response = repository.fetch<LandingRoster>(FerryEndpoint("api/landings"))
			if (current(life)) applyRoster(response.value)
		} catch (e: Exception) {
			if (current(life) && e !is CancellationException && state.value.roster == null) update { it.copy(boardError = "Connect to load the landing list.") }
		}
	}
	private fun loadLanding(id: Int) {
		val generation = landingGeneration; val life = lifecycleGeneration
		launchRequest("landing-$id-$generation-$life") {
			if (!landingCurrent(id, generation, life)) return@launchRequest
			update { it.copy(loadingLanding = true) }
			val endpoint = FerryEndpoint("api/display-data", mapOf("landingId" to "$id"))
			try {
				val saved = repository.saved<DisplayData>(endpoint) { it.validate(id) }
				if (saved != null && landingCurrent(id, generation, life)) applySchedule(saved)
				val response = repository.fetch<DisplayData>(endpoint) { it.validate(id) }
				if (landingCurrent(id, generation, life)) { applySchedule(response); refreshRealtime() }
			} catch (e: Exception) {
				if (landingCurrent(id, generation, life) && e !is CancellationException) update { it.copy(boardError = "Schedule unavailable. Reconnect and try again.", offlineWarning = if (it.schedule != null) "Showing a saved schedule" else null) }
			} finally { if (landingCurrent(id, generation, life)) update { it.copy(loadingLanding = false, refreshing = false) } }
		}
	}
	private fun applySchedule(response: SavedResponse<DisplayData>) {
		update { it.copy(schedule = response.value, scheduleSaved = response.saved, updatedAt = response.receivedAt, boardError = response.warning, offlineWarning = response.warning) }
	}

	private fun refreshVisible() {
		if (!active || widgetDraft) return
		update { expire(it.copy(now = clock())) }
		val s = state.value
		if (!s.showingRide) {
			if (s.tab == FerryTab.DEPARTURES) {
				if (s.schedule == null) s.preferences.landingId?.let { loadLanding(it) }
				if (s.viewDate == null) refreshRealtime()
				if (lastAlerts == null || java.time.Duration.between(lastAlerts, s.now).seconds >= 60) refreshAlerts()
			} else refreshMap()
		}
		if (s.sheet == FerrySheet.ALERTS && (lastAlerts == null || java.time.Duration.between(lastAlerts, s.now).seconds >= 60)) refreshAlerts()
		if (s.rideSession != null) refreshRide()
		if (s.sheet == FerrySheet.TRIP) refreshConnections()
	}
	private fun refreshAll() {
		if (!active) return
		update { it.copy(refreshing = true) }
		refreshRoster(lifecycleGeneration)
		state.value.preferences.landingId?.let { loadLanding(it) } ?: update { it.copy(refreshing = false) }
		loadShared(lifecycleGeneration, force = true); refreshAlerts(); refreshVisible()
	}
	private fun refreshRealtime() {
		val s = state.value; val id = s.preferences.landingId ?: return
		if (s.schedule?.meta?.landingNumber != id || s.tab != FerryTab.DEPARTURES || s.showingRide || s.viewDate != null) return
		val generation = landingGeneration; val life = lifecycleGeneration; val feed = feedGeneration
		launchRequest("realtime-$id-$generation-$life-$feed") {
			try {
				val response = repository.fetch<Realtime>(FerryEndpoint("api/realtime", mapOf("landingId" to "$id")))
				if (landingCurrent(id, generation, life) && feed == feedGeneration) {
					realtimeReceivedAt = response.receivedAt
					update { expire(it.copy(realtime = if (response.saved) response.value.copy(stale = true) else response.value, offlineWarning = response.warning ?: if (it.scheduleSaved) it.offlineWarning else null)) }
				}
			} catch (e: Exception) {
				if (landingCurrent(id, generation, life) && feed == feedGeneration && e !is CancellationException) update { it.copy(realtime = it.realtime.copy(stale = true), offlineWarning = "Live updates unavailable. Times are scheduled.") }
			}
		}
	}
	private fun refreshAlerts() {
		val life = lifecycleGeneration
		launchRequest("alerts-$life") {
			lastAlerts = clock()
			try {
				val response = repository.fetch<Alerts>(FerryEndpoint("api/alerts"))
				if (current(life)) update { it.copy(alerts = if (response.saved) response.value.copy(stale = true) else response.value) }
			} catch (e: Exception) { if (current(life) && e !is CancellationException) update { it.copy(alerts = it.alerts?.copy(stale = true)) } }
		}
	}
	private fun loadShared(life: Long, force: Boolean = false) {
		if (force || state.value.harbor == null) launchRequest("harbor-$life") {
			try {
				val response = repository.fetch<Harbor>(FerryEndpoint("api/map"))
				if (current(life)) update { it.copy(harbor = response.value, mapError = response.warning) }
			} catch (e: Exception) { if (current(life) && e !is CancellationException) update { it.copy(mapError = "Harbor information unavailable. Reconnect and try again.") } }
		}
		if (force || state.value.vessels.isEmpty()) launchRequest("vessels-$life") {
			try { val response = repository.fetch<Vessels>(FerryEndpoint("api/vessels")); if (current(life)) update { it.copy(vessels = response.value.vessels) } }
			catch (_: Exception) { /* Existing cached vessel roster remains available. */ }
		}
		if (force || state.value.changelog == null) launchRequest("changelog-$life") {
			try { val response = repository.fetch<Changelog>(FerryEndpoint("api/changelog")); if (current(life)) update { it.copy(changelog = response.value) } }
			catch (_: Exception) { /* An unavailable changelog does not block the board. */ }
		}
	}
	private fun refreshMap() {
		val life = lifecycleGeneration; val feed = feedGeneration
		loadShared(life)
		launchRequest("boats-$life-$feed") {
			try {
				val response = repository.fetch<Boats>(FerryEndpoint("api/boats"))
				if (current(life) && feed == feedGeneration) {
					update { it.copy(boats = if (response.saved) response.value.copy(stale = true) else response.value, mapError = response.warning ?: if (response.saved) "Saved vessel positions" else null, refreshing = false) }
					resolveWantedBoat()
				}
			} catch (e: Exception) { if (current(life) && feed == feedGeneration && e !is CancellationException) update { it.copy(boats = it.boats?.copy(stale = true), mapError = "Vessel positions unavailable. Reconnect and try again.", refreshing = false) } }
		}
	}
	private fun resolveWantedBoat() {
		update { s ->
			val boat = s.wantedVesselName?.let { name -> s.boats?.boats?.firstOrNull { it.name == name || it.number == name || it.vesselId == name || it.id == name } }
				?: s.selectedBoatId?.let { id -> s.boats?.boats?.firstOrNull { it.id == id } }
			s.copy(selectedBoatId = boat?.id ?: s.selectedBoatId, selectedBoat = boat)
		}
	}

	private fun startRide(vessel: Vessel) {
		if (vessel.id.isBlank()) return
		rideGeneration++; feedGeneration++; tripGeneration++
		requests.filterKeys { it.startsWith("ride-") }.values.toList().forEach { it.cancel() }
		val session = RideSession(vessel, clock().toEpochMilli(), state.value.tab)
		update { it.copy(rideSession = session, ride = if (it.rideSession?.vessel?.id == vessel.id) it.ride else null, showingRide = true, sheet = null, trip = null, rideError = null) }
		persistSession(session)
		val generation = rideGeneration; val life = lifecycleGeneration
		launchRequest("ride-saved-${vessel.id}-$generation-$life") {
			val saved = repository.saved<Ride>(FerryEndpoint("api/ride", mapOf("vesselId" to vessel.id))) { require(it.vessel.id == vessel.id) }
			if (saved != null && rideCurrent(vessel.id, generation, life) && state.value.ride == null) update { it.copy(ride = saved.value.copy(stale = true, positionStale = true), rideError = "Saved boat data") }
		}
		refreshRide()
	}
	private fun exitRide() {
		rideGeneration++; feedGeneration++
		requests.filterKeys { it.startsWith("ride-") }.values.toList().forEach { it.cancel() }
		val tab = state.value.rideSession?.returnTab ?: state.value.tab
		update { it.copy(rideSession = null, ride = null, showingRide = false, rideError = null) }
		persistSession(null); changeTab(tab)
	}
	private fun refreshRide() {
		val id = state.value.rideSession?.vessel?.id ?: return
		val generation = rideGeneration; val life = lifecycleGeneration
		launchRequest("ride-$id-$generation-$life") {
			try {
				val response = repository.fetch<Ride>(FerryEndpoint("api/ride", mapOf("vesselId" to id))) { require(it.vessel.id == id) }
				if (rideCurrent(id, generation, life)) update { it.copy(ride = if (response.saved) response.value.copy(stale = true, positionStale = true) else response.value, rideError = response.warning ?: if (response.saved) "Saved boat data" else null) }
			} catch (e: Exception) { if (rideCurrent(id, generation, life) && e !is CancellationException) update { it.copy(ride = it.ride?.copy(stale = true, positionStale = true), rideError = "Reconnect to load this boat’s confirmed trips.") } }
		}
	}

	private fun openTrip(row: ScheduledDeparture) {
		val data = state.value.schedule ?: return
		tripGeneration++
		update { it.copy(sheet = FerrySheet.TRIP, trip = TripDetail(row, data, loading = true)) }
		refreshConnections()
	}
	private fun refreshConnections() {
		val trip = state.value.trip ?: return
		val row = trip.row; val data = trip.data
		val id = if (data.tripSchedules.containsKey(row.departure.tripId)) row.departure.tripId else row.departure.liveTripId ?: row.departure.tripId
		if (row.departure.timetableOnly == true || data.tripSchedules[id]?.timetableOnly == true) { update { it.copy(trip = trip.copy(loading = false, note = "Published stop times. Live arrival estimates and through-trip connections are unavailable.")) }; return }
		val live = row.live && ServiceClock.addDays(row.serviceDate, (row.departure.seconds / 86_400).toInt()) == ServiceClock.parts(clock(), data.meta.timezone).dateKey
		if (!live) { update { it.copy(trip = trip.copy(loading = false, connections = null, note = "Connections are shown for today only.")) }; return }
		val generation = tripGeneration; val life = lifecycleGeneration
		launchRequest("connections-${row.id}-$generation-$life") {
			try {
				val at = clock()
				val response = repository.fetch<Connections>(FerryEndpoint("api/connections", mapOf("tripId" to id))) { require(it.usable(id, row.serviceDate, at)) }
				if (current(life) && generation == tripGeneration && state.value.trip?.row?.id == row.id) {
					val result = if (response.saved) response.value.copy(stale = true) else response.value
					update { it.copy(trip = it.trip?.copy(connections = result, loading = false, note = response.warning)) }
				}
			} catch (e: Exception) { if (current(life) && generation == tripGeneration && e !is CancellationException) update { it.copy(trip = it.trip?.copy(connections = null, loading = false, note = "Connections unavailable. Showing the trip’s published stops.")) } }
		}
	}

	private fun markSaved(s: FerryUiState) = s.copy(realtime = s.realtime.copy(stale = true), boats = s.boats?.copy(stale = true), alerts = s.alerts?.copy(stale = true), ride = s.ride?.copy(stale = true, positionStale = true), trip = s.trip?.copy(connections = s.trip.connections?.copy(stale = true), loading = false))
	private fun expire(s: FerryUiState): FerryUiState {
		fun expired(text: String?) = ServiceClock.instant(text)?.let { java.time.Duration.between(it, s.now).seconds !in 0..300 } ?: true
		val staleRealtime = realtimeReceivedAt == null || java.time.Duration.between(realtimeReceivedAt, s.now).seconds !in 0..300 || expired(s.realtime.fetchedAt)
		return s.copy(realtime = if (staleRealtime) s.realtime.copy(stale = true) else s.realtime, boats = s.boats?.let { if (expired(it.fetchedAt)) it.copy(stale = true) else it }, ride = s.ride?.let { if (expired(it.fetchedAt ?: it.generatedAt)) it.copy(stale = true, positionStale = true) else it }, trip = s.trip?.let { if (it.connections?.usable(it.connections.tripId, it.row.serviceDate, s.now) == false) it.copy(connections = null, note = "Connections need a refresh.") else it })
	}
	private fun project(s: FerryUiState): FerryUiState {
		val original = s.schedule
		val title = original?.meta?.landing?.displayName ?: s.roster?.landings?.firstOrNull { it.id == s.preferences.landingId }?.displayName ?: "Choose a landing"
		if (original == null) return s.copy(boardRows = emptyList(), boardGroups = emptyList(), landingTitle = title, boardStatus = if (s.loadingLanding) "CONNECTING" else "SCHEDULED", boardNote = null)
		val p = s.preferences
		val data = original.copy(meta = original.meta.copy(showDwellTimes = p.showDwellTimes, showLayoverTimes = p.showLayoverTimes, departuresShown = p.departuresPerRoute.takeIf { it > 0 } ?: original.meta.departuresShown, departureWindowMinutes = p.departureWindowMinutes.takeIf { it > 0 } ?: original.meta.departureWindowMinutes))
		fun visible(row: ScheduledDeparture) = p.filters.allows(row.departure, row.departure.operator ?: data.routes[row.departure.routeId]?.operator ?: data.meta.agencyName ?: "NYC Ferry")
		val frame = ScheduleEngine.frame(data, viewDate = s.viewDate, now = s.now)
		val rows = ScheduleEngine.timeline(data, s.realtime, s.viewDate, s.now).filter(::visible)
		val window = (data.meta.departureWindowMinutes.takeIf { it > 0 } ?: 180) * 60.0
		val groups = ScheduleEngine.groups(data, s.realtime, s.viewDate, s.now).mapNotNull { group ->
			val allowed = group.departures.filter(::visible)
			if (allowed.isEmpty() || (frame.live && allowed.first().delta > window)) null else group.copy(departures = allowed.take(data.meta.departuresShown.coerceAtLeast(0))).takeIf { it.departures.isNotEmpty() }
		}
		val notes = mutableListOf<String>()
		(ScheduleEngine.crewCoverage(data, frame.dateKey)?.message ?: data.meta.crewScheduleStatus?.takeIf { it.status == "unconfirmed" }?.message)?.let(notes::add)
		if (data.meta.landing.stopIds?.contains("home-port") == true) notes.add("* Listed times are first pickups. Home-port departure is at the captain’s discretion.")
		data.meta.holidaySchedule?.takeIf { frame.dateKey in it.dates }?.message?.let(notes::add)
		return s.copy(boardRows = rows, boardGroups = groups, landingTitle = title, boardNote = notes.takeIf { it.isNotEmpty() }?.joinToString(" · "), boardStatus = when { !frame.live -> "SCHEDULED"; s.scheduleSaved -> "SAVED"; s.realtime.available != false && !s.realtime.stale -> "LIVE"; else -> "SCHEDULED" })
	}
}
