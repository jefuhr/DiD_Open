package nyc.juliet.ferrykitty.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.ServiceAlert
import nyc.juliet.ferrykitty.core.Vessel
import nyc.juliet.ferrykitty.ui.FerryUi
import nyc.juliet.ferrykitty.ui.components.Footnote
import nyc.juliet.ferrykitty.ui.components.MessageCard
import nyc.juliet.ferrykitty.ui.components.Notice
import nyc.juliet.ferrykitty.ui.components.RowDivider
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.map.HarborProjection
import nyc.juliet.ferrykitty.ui.map.VesselSearch
import nyc.juliet.ferrykitty.ui.theme.FerryText
import nyc.juliet.ferrykitty.ui.theme.ferryColors
import java.util.Locale

/** Active service alerts, honest about saved or partial feeds. */
@Composable
internal fun AlertsContent(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	val alerts = state.alerts
	val items = alerts?.alerts.orEmpty()
	LazyColumn(modifier.fillMaxWidth().testTag("alertsList")) {
		if (alerts?.stale == true) item(key = "stale") { Notice("Saved alerts · reconnect for the latest updates", Icons.Filled.CloudOff, Modifier.padding(top = 8.dp)) }
		if (alerts?.partial == true) item(key = "partial") { Notice("Some alert sources are temporarily unavailable.", Icons.Filled.ErrorOutline) }
		itemsIndexed(items, key = { index, alert -> alert.id ?: "alert-$index" }) { index, alert -> AlertCard(alert, index, ui) }
		if (items.isEmpty()) {
			item(key = "empty") {
				MessageCard(if (alerts?.available == true) "No active alerts" else "Alerts unavailable", "Updates refresh automatically.", Icons.Filled.Campaign)
			}
		}
	}
}

@Composable
private fun AlertCard(alert: ServiceAlert, index: Int, ui: FerryUi) {
	val link = alert.url?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
	Column(
		verticalArrangement = Arrangement.spacedBy(6.dp),
		modifier = Modifier
			.fillMaxWidth()
			.padding(horizontal = 12.dp, vertical = 6.dp)
			.background(ferryColors.background, RoundedCornerShape(10.dp))
			.border(width = 1.dp, color = ferryColors.line, shape = RoundedCornerShape(10.dp))
			.padding(14.dp),
	) {
		Text((alert.agency ?: "Service notice").uppercase(Locale.US), style = FerryText.overline, color = ferryColors.warning)
		alert.header?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = ferryColors.heading,
			modifier = Modifier.semantics { heading() }) }
		alert.description?.takeIf { it != alert.header }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = ferryColors.ink) }
		if (link != null) {
			TextButton(onClick = { ui.send(FerryAction.OpenUrl(link)) }, modifier = Modifier.heightIn(min = TouchTarget).testTag("alertLink-$index")) {
				Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
				Spacer(Modifier.width(6.dp))
				Text("Read the full notice")
			}
		}
	}
}

@Composable
internal fun ChangelogContent(state: FerryUiState, modifier: Modifier = Modifier) {
	val entries = state.changelog?.entries.orEmpty()
	LazyColumn(modifier.fillMaxWidth().testTag("changelogList")) {
		itemsIndexed(entries, key = { index, entry -> "${entry.date}|$index" }) { _, entry ->
			Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
				Text(listOfNotNull(entry.date, entry.version?.let { "Version $it" }).joinToString(" · "), style = FerryText.overline, color = ferryColors.muted)
				Text(entry.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = ferryColors.heading,
					modifier = Modifier.semantics { heading() })
				for (note in entry.notes) {
					Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
						Text("•", color = ferryColors.accent)
						Text(note, style = MaterialTheme.typography.bodyMedium, color = ferryColors.ink)
					}
				}
			}
			RowDivider()
		}
		if (state.changelog == null) item(key = "none") { MessageCard("What’s new", "Connect to load the change log.", Icons.Filled.History) }
	}
}

@Composable
private fun Detail(label: String, value: String) {
	Row(
		verticalAlignment = Alignment.CenterVertically,
		modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 16.dp, vertical = 4.dp).semantics(mergeDescendants = true) {},
	) {
		Text(label, style = MaterialTheme.typography.bodyLarge, color = ferryColors.muted, modifier = Modifier.weight(1f).padding(end = 12.dp))
		Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = ferryColors.ink)
	}
}

/** A reporting vessel: where it is headed, how fresh its fix is, and how to ride it. */
@Composable
internal fun BoatContent(state: FerryUiState, ui: FerryUi) {
	val initial = state.selectedBoat
	if (initial == null) {
		Footnote("This vessel is no longer reporting a position.", Modifier.padding(vertical = 16.dp))
		return
	}
	val feed = state.boats
	val current = feed?.boats?.firstOrNull { it.id == initial.id }
	val boat = current ?: initial
	val fresh = feed != null && current != null && VesselSearch.isFresh(current, feedStale = feed.stale)
	val stop = boat.stop
	val landing = if (stop?.latitude != null && stop.longitude != null) {
		state.harbor?.landings.orEmpty()
			.mapNotNull { landing ->
				val lat = landing.latitude ?: return@mapNotNull null
				val lon = landing.longitude ?: return@mapNotNull null
				landing to HarborProjection.metresBetween(stop.latitude ?: 0.0, stop.longitude ?: 0.0, lat, lon)
			}
			.minByOrNull { it.second }?.takeIf { it.second < 250 }?.first
	} else null
	Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
		Detail("Hull", boat.number ?: "Unknown")
		Detail("Route", boat.routeName ?: boat.route ?: "Not assigned")
		Detail("Destination", boat.destination ?: "Not reported")
		Detail(if (boat.status == "stopped") "Alongside" else "Next landing", stop?.name ?: "Not reported")
		boat.speedKnots?.let { Detail("Reported speed", String.format(Locale.US, "%.1f kn", it)) }
		boat.ageSeconds?.let { Detail("Position age", "${it.toInt()} seconds") }
		if (!fresh) Notice("Last reported vessel data · current position unavailable", Icons.Filled.CloudOff, Modifier.padding(vertical = 6.dp))
		Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
			Button(
				onClick = {
					val id = boat.vesselId
					if (id != null && fresh) ui.startRide(Vessel(id, boat.name, boat.number)) else ui.openVessels(boat.name)
				},
				modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget).testTag("rideThisBoat"),
			) {
				Icon(Icons.Filled.Person, contentDescription = null, modifier = Modifier.size(18.dp))
				Spacer(Modifier.width(8.dp))
				Text("Riding this boat?")
			}
			if (landing != null) {
				OutlinedButton(
					onClick = { ui.selectLanding(landing.id) },
					modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget).testTag("boatDepartures"),
				) {
					Icon(Icons.Filled.DirectionsBoat, contentDescription = null, modifier = Modifier.size(18.dp))
					Spacer(Modifier.width(8.dp))
					Text("Departures at ${landing.displayName}")
				}
			}
		}
	}
}

@Composable
internal fun BridgeContent(state: FerryUiState) {
	val bridge = state.selectedBridge ?: return
	Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
		listOfNotNull(bridge.type, bridge.waterway).joinToString(" · ").takeIf { it.isNotEmpty() }?.let { Detail("Bridge", it) }
		bridge.clearanceFeet?.let { Detail("Reference clearance", "${it.toInt()} ft") }
		bridge.clearanceNote?.let { Footnote(it) }
		Footnote("Reference only; verify current charts, tide and vessel air draft.")
	}
}

@Composable
internal fun SeamarkContent(state: FerryUiState) {
	val mark = state.selectedSeamark ?: return
	Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
		mark.type?.let { Detail("Type", it.replaceFirstChar { c -> c.titlecase(Locale.US) }) }
		mark.characteristic?.let { Detail("Characteristic", it) }
		mark.rangeNm?.let { Detail("Range", "${if (it % 1.0 == 0.0) it.toInt().toString() else it.toString()} nm") }
		mark.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = ferryColors.ink, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
		Footnote("Marine reference data: OpenStreetMap / OpenSeaMap contributors, ODbL.")
	}
}
