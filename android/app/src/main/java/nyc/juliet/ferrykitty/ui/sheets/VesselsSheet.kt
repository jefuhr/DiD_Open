package nyc.juliet.ferrykitty.ui.sheets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.Vessel
import nyc.juliet.ferrykitty.ui.FerryUi
import nyc.juliet.ferrykitty.ui.components.Footnote
import nyc.juliet.ferrykitty.ui.components.RowDivider
import nyc.juliet.ferrykitty.ui.components.SearchField
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.theme.FerryText
import nyc.juliet.ferrykitty.ui.theme.TextScale
import nyc.juliet.ferrykitty.ui.theme.ferryColors

/** Choose or switch boats. A suggested vessel (from a trip or the map) is listed first, to be confirmed by name. */
@Composable
internal fun VesselPickerContent(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	var search by rememberSaveable { mutableStateOf("") }
	val suggested = ui.vesselSuggestion
	val choices = remember(state.vessels, search, suggested) {
		val needle = search.trim()
		state.vessels.filter { needle.isEmpty() || "${it.name} ${it.number.orEmpty()}".contains(needle, ignoreCase = true) }
			.sortedWith { a, b ->
				val first = a.name == suggested
				val second = b.name == suggested
				if (first != second) (if (first) -1 else 1) else FilterLogic.natural.compare(a.name, b.name)
			}
	}
	Column(modifier) {
		SearchField(search, { search = it }, "Vessel or hull number", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), tag = "vesselPickerSearch")
		LazyColumn(Modifier.fillMaxWidth().weight(1f).testTag("vesselPicker")) {
			items(choices, key = { it.id }) { vessel ->
				VesselRow(vessel, vessel.name == suggested) { ui.startRide(vessel) }
				RowDivider()
			}
			if (choices.isEmpty()) {
				item(key = "empty") { Footnote(if (state.vessels.isEmpty()) "Reconnect to load the vessel list." else "No matching vessels.", Modifier.padding(vertical = 12.dp)) }
			}
			item(key = "footer") { Footnote("Confirm your boat’s name or hull. Trips shown are feed-confirmed.", Modifier.padding(vertical = 8.dp)) }
		}
	}
}

@Composable
private fun VesselRow(vessel: Vessel, suggested: Boolean, onClick: () -> Unit) {
	val stacked = TextScale.isAccessibilityText(LocalDensity.current.fontScale)
	val details = @Composable {
		Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
			if (suggested) Text("Suggested", style = FerryText.captionStrong, color = ferryColors.accent)
			vessel.number?.let { Text(it, style = FerryText.caption.copy(fontFeatureSettings = "tnum"), color = ferryColors.muted) }
		}
	}
	val rowModifier = Modifier
		.fillMaxWidth()
		.testTag("vessel-${vessel.id}")
		.clickable(role = Role.Button, onClickLabel = "Ride this boat", onClick = onClick)
		.semantics(mergeDescendants = true) { if (suggested) stateDescription = "Suggested, confirm your boat" }
		.heightIn(min = TouchTarget)
		.padding(horizontal = 16.dp, vertical = 6.dp)
	if (stacked) {
		Column(rowModifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
			Text(vessel.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = ferryColors.ink)
			details()
		}
	} else {
		Row(rowModifier, verticalAlignment = Alignment.CenterVertically) {
			Text(vessel.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = ferryColors.ink, maxLines = 1,
				overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(end = 8.dp))
			details()
		}
	}
}
