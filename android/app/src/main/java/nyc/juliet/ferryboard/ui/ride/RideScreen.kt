@file:OptIn(ExperimentalMaterial3Api::class)

package nyc.juliet.ferryboard.ui.ride

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import nyc.juliet.ferryboard.contract.FerryAction
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.Ride
import nyc.juliet.ferryboard.core.RidePosition
import nyc.juliet.ferryboard.core.RideStop
import nyc.juliet.ferryboard.core.RideTrip
import nyc.juliet.ferryboard.ui.FerryUi
import nyc.juliet.ferryboard.ui.board.BoardFormat
import nyc.juliet.ferryboard.ui.components.StatusPill
import nyc.juliet.ferryboard.ui.components.TouchTarget
import nyc.juliet.ferryboard.ui.map.RideMiniMap
import nyc.juliet.ferryboard.ui.theme.FerryText
import nyc.juliet.ferryboard.ui.theme.TextScale
import nyc.juliet.ferryboard.ui.theme.ferryColors
import java.util.Locale

/**
 * Your boat: where it is headed next and every trip the feed has confirmed for it today. Minimize keeps the ride one
 * tap away in the ride bar; Switch boats and Exit boat are always visible.
 */
@Composable
fun RideScreen(state: FerryUiState, ui: FerryUi, wide: Boolean, modifier: Modifier = Modifier) {
	BackHandler { ui.send(FerryAction.MinimizeRide) }
	val ride = state.ride
	val accessibilityText = TextScale.isAccessibilityText(LocalDensity.current.fontScale)
	Scaffold(
		modifier = modifier.fillMaxSize(),
		containerColor = ferryColors.background,
		contentWindowInsets = WindowInsets(0),
		topBar = {
			TopAppBar(
				colors = TopAppBarDefaults.topAppBarColors(containerColor = ferryColors.background),
				navigationIcon = {
					IconButton(onClick = { ui.send(FerryAction.MinimizeRide) }, modifier = Modifier.testTag("minimizeRide")) {
						Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Minimize")
					}
				},
				title = { Text("Your boat", fontWeight = FontWeight.SemiBold, color = ferryColors.heading) },
				actions = {
					IconButton(onClick = { ui.openVessels(null) }, modifier = Modifier.testTag("switchBoat")) {
						Icon(Icons.Filled.SwapHoriz, contentDescription = "Switch boats")
					}
					IconButton(onClick = { ui.send(FerryAction.ExitRide) }, modifier = Modifier.testTag("exitRide")) {
						Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Exit boat")
					}
				},
			)
		},
	) { padding ->
		val bottom = WindowInsets.navigationBars.only(WindowInsetsSides.Bottom).asPaddingValues()
		PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { ui.send(FerryAction.Refresh) }, modifier = Modifier.padding(padding).fillMaxSize()) {
			if (wide && !accessibilityText) {
				BoxWithConstraints(Modifier.fillMaxSize()) {
					val paneWidth = min(420.dp, maxWidth * 0.42f)
					Row(Modifier.fillMaxSize()) {
						Column(
							verticalArrangement = Arrangement.spacedBy(10.dp),
							modifier = Modifier
								.width(paneWidth)
								.fillMaxHeight()
								.verticalScroll(rememberScrollState())
								.padding(12.dp)
								.padding(bottom),
						) {
							VesselHeader(state)
							Now(state, ui, mapOpen = true)
						}
						VerticalDivider(thickness = 0.5.dp, color = ferryColors.line)
						LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
							trips(state, ui, ride)
							item { Spacer(Modifier.padding(bottom)) }
						}
					}
				}
			} else {
				Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
					LazyColumn(
						verticalArrangement = Arrangement.spacedBy(10.dp),
						contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
						modifier = Modifier.widthIn(max = 900.dp).fillMaxSize(),
					) {
						item(key = "header") { VesselHeader(state) }
						item(key = "now") { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { Now(state, ui, mapOpen = false) } }
						trips(state, ui, ride)
						item(key = "bottom") { Spacer(Modifier.padding(bottom)) }
					}
				}
			}
		}
	}
}

private fun Modifier.fillMaxHeight(): Modifier = this.then(Modifier.fillMaxSize())

private fun isLive(ride: Ride?): Boolean = ride != null && !ride.stale && !ride.positionStale

@Composable
private fun VesselHeader(state: FerryUiState) {
	val ride = state.ride
	val live = isLive(ride)
	val vessel = state.rideSession?.vessel
	Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
		Text(
			vessel?.name ?: "Your boat",
			style = MaterialTheme.typography.headlineSmall,
			fontWeight = FontWeight.Bold,
			color = ferryColors.heading,
			modifier = Modifier.testTag("rideVesselName").semantics { heading() },
		)
		Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
			Text(vessel?.number ?: "NYC Ferry", style = FerryText.caption, color = ferryColors.muted, modifier = Modifier.weight(1f))
			StatusPill(
				when {
					live -> "LIVE"
					ride == null -> "CONNECTING"
					else -> "SAVED"
				},
				if (live) BoardFormat.Tone.POSITIVE else BoardFormat.Tone.NEUTRAL,
			)
		}
	}
}

/** The current trip, the next landing and the boat's position. */
@Composable
private fun Now(state: FerryUiState, ui: FerryUi, mapOpen: Boolean) {
	val ride = state.ride
	if (ride == null) {
		Text(state.rideError ?: "Loading confirmed trips for your saved boat…", style = MaterialTheme.typography.bodyMedium, color = ferryColors.muted)
		TextButton(onClick = { ui.send(FerryAction.Refresh) }, modifier = Modifier.heightIn(min = TouchTarget).testTag("rideRetry")) { Text("Try again") }
		return
	}
	ride.trips.firstOrNull { it.state == "current" }?.let { current ->
		Text(
			buildAnnotatedString {
				withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(current.route + (current.boatAssignment?.toString() ?: "")) }
				append(" → ${current.destination}")
			},
			style = MaterialTheme.typography.bodyLarge,
			color = ferryColors.ink,
		)
		if (current.outOfService == true) Text("Out of service · no passenger boarding", style = FerryText.captionStrong, color = ferryColors.muted)
	}
	state.rideError?.let { Text(it, style = FerryText.caption, color = ferryColors.muted) }
	NextStop(state, ride)
	val position = ride.position ?: return
	if (mapOpen) {
		PositionMap(state, ui, ride, position, height = 220)
	} else {
		var showing by rememberSaveable { mutableStateOf(false) }
		Row(
			verticalAlignment = Alignment.CenterVertically,
			horizontalArrangement = Arrangement.spacedBy(10.dp),
			modifier = Modifier
				.fillMaxWidth()
				.testTag("rideMapDisclosure")
				.clickable(role = Role.Button) { showing = !showing }
				.semantics { stateDescription = if (showing) "Expanded" else "Collapsed" }
				.heightIn(min = TouchTarget),
		) {
			Icon(Icons.Filled.Map, contentDescription = null, tint = ferryColors.accent, modifier = Modifier.size(20.dp))
			Text(if (showing) "Vessel position" else "Show map", style = MaterialTheme.typography.bodyLarge, color = ferryColors.accent, modifier = Modifier.weight(1f))
			Icon(if (showing) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = ferryColors.muted)
		}
		AnimatedVisibility(showing) { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { PositionMap(state, ui, ride, position, height = 160) } }
	}
}

@Composable
private fun PositionMap(state: FerryUiState, ui: FerryUi, ride: Ride, position: RidePosition, height: Int) {
	val live = isLive(ride)
	RideMiniMap(
		position,
		!live,
		state.harbor?.landings.orEmpty(),
		modifier = Modifier
			.fillMaxWidth()
			.height(height.dp)
			.clip(RoundedCornerShape(10.dp))
			.semantics { contentDescription = "${if (live) "Current" else "Last reported"} vessel position" },
	)
	OutlinedButton(
		onClick = {
			ui.send(FerryAction.MinimizeRide)
			ui.send(FerryAction.FindBoat(ride.vessel.name))
		},
		modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget).testTag("rideOpenMap"),
	) {
		Icon(Icons.Filled.Map, contentDescription = null, modifier = Modifier.size(18.dp))
		Spacer(Modifier.width(8.dp))
		Text("Open full map")
	}
	if (state.harbor == null) Text("Harbor routes load with a connection; the chart itself is bundled.", style = FerryText.caption, color = ferryColors.muted)
}

@Composable
private fun NextStop(state: FerryUiState, ride: Ride) {
	val live = isLive(ride)
	val position = ride.position
	val atLanding = position?.status == "stopped"
	val twelveHour = state.preferences.twelveHour
	Column(
		verticalArrangement = Arrangement.spacedBy(6.dp),
		modifier = Modifier
			.fillMaxWidth()
			.background(ferryColors.card, RoundedCornerShape(12.dp))
			.padding(12.dp),
	) {
		Row(verticalAlignment = Alignment.CenterVertically) {
			Text(
				if (live) (if (atLanding) "AT LANDING" else "NEXT LANDING") else "LAST REPORTED NEXT LANDING",
				style = FerryText.overline,
				color = ferryColors.muted,
				modifier = Modifier.weight(1f),
			)
			val speed = position?.speedKnots
			if (live && speed != null) {
				val knots = String.format(Locale.US, "%.1f", speed)
				Text("$knots kn", style = FerryText.clock, color = ferryColors.ink,
					modifier = Modifier.semantics { contentDescription = "Speed $knots knots" })
			}
		}
		val stop = ride.nextStop
		Text(stop?.name ?: "Not yet reported", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = ferryColors.heading)
		if (stop != null) {
			RideFormat.service(stop)?.let { Text(it, style = FerryText.captionStrong, color = ferryColors.muted) }
			StopClocks(stop, ride.stale, ride.timezone, twelveHour, arrivalTag = "rideArrival", fullWords = true)
			StopDurations(state, stop, ride.stale)
			if (live) {
				val estimate = if (atLanding) stop.estimatedDepartureSeconds else stop.estimatedArrivalSeconds
				val instant = stop.instant(arrival = !atLanding, stale = false)
				if (estimate != null && instant != null) {
					Text(RideFormat.countdown(arrival = !atLanding, at = instant, now = state.now), style = FerryText.captionStrong, color = ferryColors.accent)
				}
			}
		}
		position?.let {
			val reported = RideFormat.time(RideFormat.epochMillis(it.reportedAt), ride.timezone, twelveHour)
			Text(if (live) "Position $reported" else "Saved position $reported · speed unavailable", style = FerryText.caption, color = ferryColors.muted)
		}
	}
}

/** Both clocks stay visible: a scheduled dwell must not be flattened into one ETA. */
@Composable
private fun StopClocks(stop: RideStop, stale: Boolean, timezone: String, twelveHour: Boolean, arrivalTag: String? = null, fullWords: Boolean = false) {
	val accessibilityText = TextScale.isAccessibilityText(LocalDensity.current.fontScale)
	val clocks = @Composable {
		if (stop.arrivalSeconds != null || stop.arrivalAt != null) Clock(stop, arrival = true, stale, timezone, twelveHour, fullWords, arrivalTag)
		if (stop.departureSeconds != null || stop.departureAt != null) Clock(stop, arrival = false, stale, timezone, twelveHour, fullWords, null)
	}
	if (accessibilityText) Column(verticalArrangement = Arrangement.spacedBy(3.dp)) { clocks() }
	else Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) { clocks() }
}

@Composable
private fun Clock(stop: RideStop, arrival: Boolean, stale: Boolean, timezone: String, twelveHour: Boolean, fullWords: Boolean, tag: String?) {
	val estimated = !stale && (if (arrival) stop.estimatedArrivalSeconds else stop.estimatedDepartureSeconds) != null
	val time = RideFormat.time(stop.instant(arrival, stale), timezone, twelveHour)
	val quality = if (fullWords) (if (estimated) "estimated" else "scheduled") else (if (estimated) "est" else "sched")
	Row(
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(4.dp),
		modifier = Modifier
			.then(if (tag != null) Modifier.testTag(tag) else Modifier)
			.semantics(mergeDescendants = true) {
				contentDescription = "${if (arrival) "Arrival" else "Departure"} $time, ${if (estimated) "estimated" else "scheduled"}"
			},
	) {
		Text(if (arrival) "ARR" else "DEP", style = FerryText.overline, color = ferryColors.muted)
		Text(time, style = FerryText.clock, color = ferryColors.ink)
		Text(quality, style = FerryText.caption, color = if (estimated) ferryColors.accent else ferryColors.muted)
	}
}

@Composable
private fun StopDurations(state: FerryUiState, stop: RideStop, stale: Boolean) {
	val lines = mutableListOf<String>()
	val arrival = stop.instant(arrival = true, stale = stale)
	val departure = stop.instant(arrival = false, stale = stale)
	if (state.preferences.showDwellTimes && arrival != null && departure != null && departure.isAfter(arrival)) {
		val estimated = !stale && (stop.estimatedArrivalSeconds != null || stop.estimatedDepartureSeconds != null)
		lines += "Dwell ${RideFormat.duration((departure.toEpochMilli() - arrival.toEpochMilli()) / 1000.0)} · ${if (estimated) "estimated" else "scheduled"}"
	}
	val layover = stop.layoverSeconds
	if (state.preferences.showLayoverTimes && layover != null && !(stale && stop.layoverEstimated == true)) {
		lines += "Layover ${RideFormat.duration(layover)} · ${if (stop.layoverEstimated == true) "estimated" else "scheduled"}"
	}
	for (line in lines) Text(line, style = FerryText.caption, color = ferryColors.muted)
}

private fun LazyListScope.trips(state: FerryUiState, ui: FerryUi, ride: Ride?) {
	if (ride == null) return
	item(key = "tripsHeader") {
		Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
			Text("Confirmed trips", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = ferryColors.heading,
				modifier = Modifier.weight(1f).semantics { heading() })
			Text(ride.date, style = FerryText.caption.copy(fontFeatureSettings = "tnum"), color = ferryColors.muted)
		}
	}
	if (ride.trips.isEmpty()) {
		item(key = "noTrips") {
			Text("Waiting for confirmed assignments. Your boat is saved.", style = MaterialTheme.typography.bodyMedium, color = ferryColors.muted,
				modifier = Modifier.padding(vertical = 8.dp))
		}
	}
	items(ride.trips, key = { "trip|${it.id}" }) { trip -> TripCard(state, ui, trip, ride) }
	item(key = "history") { Text(ride.historyNote, style = FerryText.caption, color = ferryColors.muted) }
}

@Composable
private fun TripCard(state: FerryUiState, ui: FerryUi, trip: RideTrip, ride: Ride) {
	var expanded by rememberSaveable(trip.id) { mutableStateOf(trip.state == "current") }
	val twelveHour = state.preferences.twelveHour
	Column(Modifier.fillMaxWidth().background(ferryColors.card, RoundedCornerShape(12.dp)).testTag("rideTrip-${trip.id}")) {
		Row(
			verticalAlignment = Alignment.CenterVertically,
			modifier = Modifier
				.fillMaxWidth()
				.clickable(role = Role.Button, onClickLabel = if (expanded) "Hide stops" else "Show stops") { expanded = !expanded }
				.semantics(mergeDescendants = true) { stateDescription = if (expanded) "Expanded" else "Collapsed" }
				.heightIn(min = TouchTarget)
				.padding(horizontal = 12.dp, vertical = 6.dp),
		) {
			Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
				Text("${trip.route}${trip.boatAssignment?.toString() ?: ""} → ${trip.destination}", style = MaterialTheme.typography.bodyLarge,
					fontWeight = FontWeight.SemiBold, color = ferryColors.ink)
				Text(
					"${RideFormat.time(RideFormat.epochMillis(trip.startAt), ride.timezone, twelveHour)} · ${RideFormat.tripState(trip.state)}" +
						if (trip.outOfService == true) " · Out of service" else "",
					style = FerryText.caption,
					color = if (trip.state == "current") ferryColors.accent else ferryColors.muted,
				)
			}
			Icon(if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = ferryColors.muted)
		}
		AnimatedVisibility(expanded) {
			Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 6.dp)) {
				trip.stops.forEachIndexed { index, stop ->
					if (index > 0) HorizontalDivider(thickness = 0.5.dp, color = ferryColors.line)
					TripStop(state, ui, trip, stop, ride, final = index == trip.stops.lastIndex)
				}
			}
		}
	}
}

@Composable
private fun TripStop(state: FerryUiState, ui: FerryUi, trip: RideTrip, stop: RideStop, ride: Ride, final: Boolean) {
	val landing = stop.landingId
	Column(
		verticalArrangement = Arrangement.spacedBy(3.dp),
		modifier = Modifier
			.fillMaxWidth()
			.then(if (landing != null) Modifier.clickable(role = Role.Button, onClickLabel = "Open departures at ${stop.name}") {
				ui.send(FerryAction.MinimizeRide)
				ui.send(FerryAction.SelectLanding(landing))
			} else Modifier)
			.heightIn(min = TouchTarget)
			.padding(vertical = 6.dp),
	) {
		Row(verticalAlignment = Alignment.CenterVertically) {
			Text(stop.name, style = MaterialTheme.typography.bodyMedium, fontWeight = if (stop.current) FontWeight.Bold else FontWeight.Medium,
				color = if (stop.current) ferryColors.accent else ferryColors.ink, modifier = Modifier.weight(1f))
			if (landing != null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = ferryColors.muted, modifier = Modifier.size(18.dp))
		}
		when {
			stop.skipped -> Text("SKIPPED", style = FerryText.captionStrong, color = ferryColors.muted)
			trip.state == "canceled" -> Text("CANCELED", style = FerryText.captionStrong, color = ferryColors.warning)
			else -> {
				RideFormat.service(stop, final)?.let { Text(it, style = FerryText.overline, color = ferryColors.muted) }
				StopClocks(stop, ride.stale, ride.timezone, state.preferences.twelveHour)
				StopDurations(state, stop, ride.stale)
			}
		}
	}
}
