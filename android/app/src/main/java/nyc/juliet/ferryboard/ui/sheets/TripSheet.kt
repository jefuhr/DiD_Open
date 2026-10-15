package nyc.juliet.ferryboard.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.Connection
import nyc.juliet.ferryboard.core.ConnectionStop
import nyc.juliet.ferryboard.core.DisplayData
import nyc.juliet.ferryboard.core.ScheduleEngine
import nyc.juliet.ferryboard.core.ScheduledDeparture
import nyc.juliet.ferryboard.core.ServiceClock
import nyc.juliet.ferryboard.core.TripCall
import nyc.juliet.ferryboard.core.Vessel
import nyc.juliet.ferryboard.ui.FerryUi
import nyc.juliet.ferryboard.ui.board.BoardFormat
import nyc.juliet.ferryboard.ui.board.BoardModel
import nyc.juliet.ferryboard.ui.components.Footnote
import nyc.juliet.ferryboard.ui.components.RouteBadge
import nyc.juliet.ferryboard.ui.components.RowDivider
import nyc.juliet.ferryboard.ui.components.TouchTarget
import nyc.juliet.ferryboard.ui.theme.ColorMath
import nyc.juliet.ferryboard.ui.theme.FerryText
import nyc.juliet.ferryboard.ui.theme.TextScale
import nyc.juliet.ferryboard.ui.theme.ferryColors
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

/** The vessel a trip names: confirmed, predicted, or the last saved assignment during an outage. */
internal data class DisplayedVessel(val name: String, val predicted: Boolean, val saved: Boolean)

/** Facts about one trip, ported from the iOS TripView so the sheet and tests agree. */
internal class TripFacts(state: FerryUiState, val row: ScheduledDeparture, val data: DisplayData) {
	private val departure = row.departure
	val liveId: String = departure.liveTripId ?: departure.tripId
	// Published calls are keyed by the display trip; verified realtime uses a separate id.
	val sourceId: String = if (data.tripSchedules[departure.tripId] != null) departure.tripId else liveId
	private val trip = data.tripSchedules[sourceId]
	val timetableOnly: Boolean = trip?.timetableOnly == true || departure.timetableOnly == true
	val hasLiveMapping: Boolean = departure.scheduleOnly != true || departure.liveTripId != null
	val calls: List<TripCall> = trip?.stops.orEmpty().sortedBy { it.sequence }
	val live: Boolean = row.live && ServiceClock.addDays(row.serviceDate, floor(departure.seconds / 86400).toInt()) ==
		ServiceClock.parts(state.now, data.meta.timezone).dateKey
	val connections = state.trip?.connections?.takeIf { it.usable(sourceId, row.serviceDate, state.now) }
	val freshConnections: Boolean = live && connections?.stale == false
	val canRide: Boolean = live && hasLiveMapping && !departure.routeId.contains(":") && departure.mode != "bus"

	/** A loop may call at a pier twice: highlight the call whose own time matches the selected row. */
	val selectedSequence: Int? = calls.filter { it.stopId == departure.stopId }.minByOrNull { call ->
		val own = if (departure.arrival == true) call.arrivalSeconds else call.departureSeconds
		abs((own ?: call.arrivalSeconds ?: call.departureSeconds ?: 0.0) - departure.seconds)
	}?.sequence

	val vessel: DisplayedVessel? = run {
		if (!live || !hasLiveMapping) return@run null
		val realtime = state.realtime
		val vehicles = realtime.vehicles.orEmpty()
		val saved = realtime.stale || realtime.vehiclesStale == true || realtime.available == false
		vehicles.firstOrNull { it.tripId == liveId && !it.boatName.isNullOrEmpty() }?.boatName?.let { return@run DisplayedVessel(it, false, saved) }
		departure.predictTripId?.let { predicted ->
			vehicles.firstOrNull { it.tripId == predicted && !it.boatName.isNullOrEmpty() }?.boatName?.let { return@run DisplayedVessel(it, true, saved) }
		}
		departure.boatAssignment?.let { number ->
			vehicles.filter { it.boat == "${departure.routeId}$number" && !it.boatName.isNullOrEmpty() }
				.maxByOrNull { it.updatedAtEpochSeconds ?: 0.0 }?.boatName?.let { return@run DisplayedVessel(it, true, saved) }
		}
		// A fresh feed clearing the assignment clears the name; during an outage the row's saved assignment remains.
		if (!saved) return@run null
		val name = row.boatName ?: row.predictedBoatName ?: return@run null
		DisplayedVessel(name, row.boatName == null, true)
	}

	val movement: String? = when {
		departure.arrival == true -> "ARRIVAL · DROP OFF ONLY"
		departure.crewShuttle == true -> "CREW SHUTTLE · NO PICKUP"
		departure.outOfService == true -> "OUT OF SERVICE · NO PICKUP"
		departure.fromHomePort == true -> "HOME-PORT DEPARTURE · time at captain’s discretion"
		departure.endsShift == "unsure" -> "FINAL? · return trip unconfirmed"
		!departure.endsShift.isNullOrEmpty() -> "FINAL · no return trip"
		else -> null
	}

	fun matching(call: TripCall): ConnectionStop? = connections?.stops?.firstOrNull { it.sequence == call.sequence && it.stopId == call.stopId }

	fun restriction(call: TripCall): String? = when {
		call.pickupType == 1 && call.dropOffType == 0 -> "DROP OFF ONLY"
		call.dropOffType == 1 && call.pickupType == 0 -> "PICKUP ONLY"
		else -> listOfNotNull(if (call.pickupType == 1) "NO PICKUP" else null, if (call.dropOffType == 1) "NO DROP-OFF" else null)
			.joinToString(" · ").ifEmpty { null }
	}

	fun dwellMinutes(call: TripCall): Int? {
		if (data.meta.showDwellTimes != true) return null
		val arrival = call.arrivalSeconds ?: return null
		val leaving = call.departureSeconds ?: return null
		if (!(leaving - arrival).isFinite() || leaving < arrival) return null
		return floor((leaving - arrival) / 60 + 0.5).toInt()
	}

	fun note(loading: Boolean, rootNote: String?): String? = when {
		connections?.stale == true -> "Saved connections · times shown as scheduled"
		connections != null -> null
		rootNote != null -> rootNote
		timetableOnly -> "Published stop times. Live arrival estimates and through-trip connections are unavailable."
		!live -> "Connections are shown for today only."
		loading -> "Checking connections…"
		else -> "Connections unavailable. Showing the trip’s published stops."
	}
}

@Composable
internal fun TripContent(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	val detail = state.trip
	if (detail == null) {
		Footnote("Trip details are unavailable.", Modifier.padding(vertical = 16.dp))
		return
	}
	val data = remember(detail.data, state.preferences) { BoardModel.displaySchedule(detail.data, state.preferences) ?: detail.data }
	val facts = TripFacts(state, detail.row, data)
	val twelveHour = state.preferences.twelveHour
	val accessibilityText = TextScale.isAccessibilityText(LocalDensity.current.fontScale)
	LazyColumn(modifier.fillMaxWidth().testTag("tripStops")) {
		item(key = "summary") { TripSummary(state, ui, facts) }
		item(key = "stopsHeader") {
			Text("STOPS · SCHEDULED UNLESS MARKED EST", style = FerryText.overline, color = ferryColors.muted,
				modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp).semantics { heading() })
		}
		items(facts.calls, key = { "call|${it.sequence}" }) { call ->
			StopRow(state, ui, facts, call, twelveHour, accessibilityText)
			RowDivider()
		}
		facts.note(detail.loading, detail.note)?.let { note -> item(key = "note") { Footnote(note, Modifier.padding(vertical = 10.dp)) } }
	}
}

@Composable
private fun TripSummary(state: FerryUiState, ui: FerryUi, facts: TripFacts) {
	val row = facts.row
	val departure = row.departure
	val twelveHour = state.preferences.twelveHour
	val route = facts.data.routes[departure.routeId]
	val working = BoardFormat.working(departure, route?.shortName)
	val vessel = facts.vessel
	Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
		Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
			RouteBadge(departure.routeId, departure.variant, route, FilterLogic.operatorName(departure, facts.data), Modifier.padding(top = 2.dp))
			Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
				Text(departure.destination, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = ferryColors.heading)
				Text("${row.serviceDate} · ${BoardFormat.publishedTime(departure, twelveHour)} ${if (departure.fromHomePort == true) "first pickup" else "scheduled"}",
					style = FerryText.caption.copy(fontFeatureSettings = "tnum"), color = ferryColors.muted)
				val parts = listOfNotNull(
					working,
					vessel?.let { it.name + if (it.predicted) "?" else "" },
					if (vessel == null) departure.crewBoats?.takeIf { it.isNotEmpty() }?.joinToString(" ") else null,
					if (vessel?.saved == true) "saved vessel" else null,
				)
				if (parts.isNotEmpty()) {
					val spoken = listOfNotNull(
						working?.let { "Working $it" },
						vessel?.let { if (it.predicted) "Predicted vessel ${it.name}, unconfirmed" else "Vessel ${it.name}" },
						if (vessel == null) departure.crewBoats?.takeIf { it.isNotEmpty() }?.joinToString(", ") else null,
						if (vessel?.saved == true) "Saved assignment" else null,
					).joinToString(", ")
					Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = ferryColors.ink,
						modifier = Modifier.semantics { contentDescription = spoken })
				}
			}
		}
		facts.movement?.let { Text("${facts.data.meta.landing.displayName}: $it", style = FerryText.captionStrong, color = ferryColors.warning) }
		if (row.isLastOfDay || row.isLastGovernorsIsland) {
			Text(if (row.isLastOfDay) "LAST DEPARTURE" else "LAST TO GOVERNORS ISLAND", style = FerryText.captionStrong, color = ferryColors.danger)
		}
		BoardFormat.via(departure)?.let { Text(it, style = if (it.startsWith("VIA ")) FerryText.captionStrong else FerryText.caption, color = ferryColors.muted) }
		facts.data.meta.holidaySchedule?.takeIf { row.serviceDate in it.dates }?.let { Text(it.message, style = FerryText.caption, color = ferryColors.muted) }
		if (vessel != null || facts.canRide) {
			FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
				if (vessel != null) {
					TextButton(onClick = { ui.findBoat(vessel.name) }, modifier = Modifier.heightIn(min = TouchTarget).testTag("tripMap")) {
						Icon(Icons.Filled.Map, contentDescription = null, modifier = Modifier.size(18.dp))
						Spacer(Modifier.width(6.dp))
						Text("${vessel.name}${if (vessel.predicted) "?" else ""} on map")
					}
				}
				if (facts.canRide) {
					TextButton(onClick = { beginRide(state, ui, facts) }, modifier = Modifier.heightIn(min = TouchTarget).testTag("tripRide")) {
						Icon(Icons.Filled.Person, contentDescription = null, modifier = Modifier.size(18.dp))
						Spacer(Modifier.width(6.dp))
						Text("Ride this boat")
					}
				}
			}
		}
	}
}

/** A live, fresh vehicle with an id starts the ride; otherwise the picker opens with the trip's vessel suggested. */
private fun beginRide(state: FerryUiState, ui: FerryUi, facts: TripFacts) {
	val realtime = state.realtime
	val vehicle = realtime.vehicles?.firstOrNull { it.tripId == facts.liveId }
	val id = vehicle?.vesselId
	val name = vehicle?.boatName
	if (id != null && name != null && facts.live && !realtime.stale && realtime.vehiclesStale != true) ui.startRide(Vessel(id, name))
	else ui.openVessels(facts.vessel?.name)
}

@Composable
private fun StopRow(state: FerryUiState, ui: FerryUi, facts: TripFacts, call: TripCall, twelveHour: Boolean, accessibilityText: Boolean) {
	val matching = facts.matching(call)
	val info = facts.data.stops?.get(call.stopId)
	val name = info?.name ?: matching?.name ?: call.stopId
	val selected = call.sequence == facts.selectedSequence
	val landing = info?.landingId ?: matching?.landingId
	Column(
		verticalArrangement = Arrangement.spacedBy(3.dp),
		modifier = Modifier
			.fillMaxWidth()
			.background(if (selected) ferryColors.accent.copy(alpha = 0.09f) else Color.Transparent)
			.padding(horizontal = 16.dp, vertical = 6.dp),
	) {
		val nameLabel = @Composable {
			Row(
				verticalAlignment = Alignment.CenterVertically,
				horizontalArrangement = Arrangement.spacedBy(5.dp),
				modifier = Modifier
					.then(if (landing != null) Modifier.clickable(role = Role.Button, onClickLabel = "Open this landing’s departures") { ui.selectLanding(landing) } else Modifier)
					.semantics(mergeDescendants = true) { contentDescription = name + if (selected) ", selected stop" else "" }
					.heightIn(min = TouchTarget),
			) {
				if (selected) Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = ferryColors.accent, modifier = Modifier.size(16.dp))
				Text(name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
					color = if (landing != null) ferryColors.accent else ferryColors.ink)
			}
		}
		val times = @Composable {
			FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
				call.arrivalSeconds?.let { CallTime("ARR", it, if (facts.freshConnections) matching?.estimatedArrivalSeconds else null, twelveHour) }
				call.departureSeconds?.let { CallTime("DEP", it, null, twelveHour) }
			}
		}
		if (accessibilityText) {
			nameLabel()
			times()
		} else {
			// Measure the complete name and clock groups before deciding whether they share a line.
			// A weighted name would receive only the clocks' leftover width and split ordinary words.
			FlowRow(
				modifier = Modifier.fillMaxWidth(),
				horizontalArrangement = Arrangement.SpaceBetween,
				verticalArrangement = Arrangement.spacedBy(3.dp),
			) {
				Box(Modifier.width(IntrinsicSize.Max).padding(end = 12.dp).align(Alignment.CenterVertically)) { nameLabel() }
				Box(Modifier.width(IntrinsicSize.Max).align(Alignment.CenterVertically)) { times() }
			}
		}
		facts.restriction(call)?.let { Text(it, style = FerryText.captionStrong, color = ferryColors.warning) }
		PauseLine(facts, call, matching)
		if (matching != null) Connections(state, matching, facts.freshConnections, twelveHour)
	}
}

@Composable
private fun CallTime(label: String, seconds: Double, estimate: Double?, twelveHour: Boolean) {
	val shown = ServiceClock.time(estimate ?: seconds, twelveHour)
	val scheduled = ServiceClock.time(seconds, twelveHour)
	Column(Modifier.semantics(mergeDescendants = true) {
		contentDescription = "${if (label == "ARR") "Arrival" else "Departure"} $shown, ${if (estimate != null) "estimated, scheduled $scheduled" else "scheduled"}"
	}) {
		// Room between ARR or DEP, the time and EST keeps them apart at large text in 12-hour time ("9:12 AM EST").
		Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
			Text(label, style = FerryText.overline, color = ferryColors.muted)
			Text(shown, style = FerryText.clock, color = ferryColors.ink)
			if (estimate != null) Text("EST", style = FerryText.overline, color = ferryColors.accent)
		}
		if (estimate != null && estimate != seconds) Text("sched $scheduled", style = FerryText.caption.copy(fontFeatureSettings = "tnum"), color = ferryColors.muted)
	}
}

@Composable
private fun PauseLine(facts: TripFacts, call: TripCall, matching: ConnectionStop?) {
	val dwell = facts.dwellMinutes(call)
	val layover = ScheduleEngine.tripLayover(facts.data, facts.sourceId, call, matching?.turnaround, facts.freshConnections)
	if (dwell == null && layover == null) return
	val text = listOfNotNull(
		dwell?.let { "Dwell $it min scheduled" },
		layover?.let { pause -> pause.estimatedMinutes?.let { "Layover ${pause.scheduledMinutes} → $it min EST" } ?: "Layover ${pause.scheduledMinutes} min scheduled" },
	).joinToString(" · ")
	val spoken = listOfNotNull(
		dwell?.let { "Scheduled dwell $it minutes" },
		layover?.let { pause -> pause.estimatedMinutes?.let { "Scheduled layover ${pause.scheduledMinutes} minutes, currently estimated $it minutes" }
			?: "Scheduled layover ${pause.scheduledMinutes} minutes" },
	).joinToString(", ")
	Text(text, style = FerryText.caption.copy(fontFeatureSettings = "tnum"), color = ferryColors.muted, modifier = Modifier.semantics { contentDescription = spoken })
}

@Composable
private fun Connections(state: FerryUiState, stop: ConnectionStop, fresh: Boolean, twelveHour: Boolean) {
	val visible = stop.connections.filter { FilterLogic.visible(it, state.preferences.filters, state.schedule) }
	if (visible.isEmpty()) {
		Text(if (stop.connections.isEmpty()) "No connecting departures listed" else "Connections hidden by departure filters",
			style = FerryText.caption, color = ferryColors.muted)
		return
	}
	Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 3.dp)) {
		Text("CONNECT", style = FerryText.overline, color = ferryColors.muted)
		for (connection in visible.take(max(0, stop.limit ?: 3))) ConnectionRow(connection, fresh, twelveHour)
	}
}

@Composable
private fun ConnectionRow(connection: Connection, fresh: Boolean, twelveHour: Boolean) {
	val estimated = fresh && connection.hasLiveTiming == true
	val delay = if (estimated) max(0.0, connection.delaySeconds ?: 0.0) else 0.0
	val color = ColorMath.parseHex(connection.color) ?: 0xFF5D6B78
	val boat = (connection.boatName ?: connection.predictedBoatName)?.let { it + if (connection.boatName == null) "?" else "" }
	Column(Modifier.semantics(mergeDescendants = true) {}) {
		Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
			Text(ServiceClock.time(connection.seconds + delay, twelveHour), style = FerryText.clock.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize),
				color = ferryColors.ink)
			if (estimated) Text("EST", style = FerryText.overline, color = ferryColors.accent)
			Text(
				connection.shortName ?: connection.routeId,
				style = FerryText.pill,
				color = Color(ColorMath.readableOn(color)),
				modifier = Modifier.background(Color(color), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 1.dp),
			)
			Text(connection.destination, style = MaterialTheme.typography.bodyMedium, color = ferryColors.ink, modifier = Modifier.weight(1f, fill = false))
		}
		if (delay > 0 || boat != null) {
			Text(listOfNotNull(if (delay > 0) "sched ${ServiceClock.time(connection.seconds, twelveHour)}" else null, boat).joinToString(" · "),
				style = FerryText.caption, color = ferryColors.muted)
		}
	}
}
