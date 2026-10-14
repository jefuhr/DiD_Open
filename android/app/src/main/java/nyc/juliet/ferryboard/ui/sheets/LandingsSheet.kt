package nyc.juliet.ferryboard.ui.sheets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.NearMe
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import nyc.juliet.ferryboard.contract.FerryAction
import nyc.juliet.ferryboard.contract.FerryTab
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.Landing
import nyc.juliet.ferryboard.ui.FerryUi
import nyc.juliet.ferryboard.ui.components.RowDivider
import nyc.juliet.ferryboard.ui.components.SearchField
import nyc.juliet.ferryboard.ui.components.SectionHeader
import nyc.juliet.ferryboard.ui.components.TouchTarget
import nyc.juliet.ferryboard.ui.theme.FerryText
import nyc.juliet.ferryboard.ui.theme.TextScale
import nyc.juliet.ferryboard.ui.theme.ferryColors

/**
 * Every landing, searchable by name or number, favorites first. In a sheet a choice closes the sheet and opens that
 * board; in the tablet sidebar it simply switches the board beside it.
 */
@Composable
internal fun LandingsContent(state: FerryUiState, ui: FerryUi, inSheet: Boolean, modifier: Modifier = Modifier) {
	var search by rememberSaveable { mutableStateOf("") }
	val favorites = state.preferences.favorites
	val landings = remember(state.roster, search, favorites) { FilterLogic.landings(state.roster?.landings.orEmpty(), search, favorites) }
	Column(modifier) {
		SearchField(search, { search = it }, "Landing name or number", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), tag = "landingSearch")
		LazyColumn(Modifier.fillMaxWidth().weight(1f).testTag("landingPicker")) {
			item(key = "nearest") {
				NearestRow(state) {
					ui.send(FerryAction.FindNearest)
					if (inSheet) ui.close()
				}
				RowDivider()
			}
			items(landings, key = { it.id }) { landing ->
				LandingRow(
					landing = landing,
					favorite = landing.id in favorites,
					current = landing.id == state.preferences.landingId,
					onFavorite = { ui.send(FerryAction.ToggleFavorite(landing.id)) },
					onSelect = { ui.selectLanding(landing.id, closeSheet = inSheet) },
				)
			}
			if (landings.isEmpty()) {
				item(key = "empty") {
					Text(
						if (state.roster == null) "Connect to load the landing list." else "No matching landings.",
						color = ferryColors.muted,
						modifier = Modifier.padding(16.dp),
					)
				}
			}
		}
	}
}

@Composable
private fun NearestRow(state: FerryUiState, onClick: () -> Unit) {
	Row(
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		modifier = Modifier
			.fillMaxWidth()
			.testTag("landingsNearest")
			.clickable(enabled = !state.locating && state.roster != null, role = Role.Button, onClick = onClick)
			.heightIn(min = TouchTarget)
			.padding(horizontal = 16.dp, vertical = 6.dp),
	) {
		if (state.locating) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
		else Icon(Icons.Filled.NearMe, contentDescription = null, tint = ferryColors.accent, modifier = Modifier.size(20.dp))
		Column(Modifier.weight(1f)) {
			Text(if (state.locating) "Finding the nearest landing…" else "Nearest landing", style = MaterialTheme.typography.bodyLarge, color = ferryColors.accent)
			state.locationStatus?.let { Text(it, style = FerryText.caption, color = ferryColors.muted) }
		}
	}
}

@Composable
private fun LandingRow(landing: Landing, favorite: Boolean, current: Boolean, onFavorite: () -> Unit, onSelect: () -> Unit) {
	val accessibilityText = TextScale.isAccessibilityText(LocalDensity.current.fontScale)
	Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp)) {
		IconToggleButton(
			checked = favorite,
			onCheckedChange = { onFavorite() },
			modifier = Modifier.testTag("favorite-${landing.id}").semantics {
				contentDescription = "${if (favorite) "Unfavorite" else "Favorite"} ${landing.displayName}"
			},
		) {
			Icon(if (favorite) Icons.Filled.Star else Icons.Filled.StarBorder, contentDescription = null,
				tint = if (favorite) ferryColors.warning else ferryColors.muted, modifier = Modifier.size(20.dp))
		}
		Row(
			verticalAlignment = Alignment.CenterVertically,
			horizontalArrangement = Arrangement.spacedBy(6.dp),
			modifier = Modifier
				.weight(1f)
				.testTag("landing-${landing.id}")
				.clickable(role = Role.Button, onClickLabel = "Show departures", onClick = onSelect)
				.semantics(mergeDescendants = true) {
					selected = current
					stateDescription = if (current) "Selected, landing ${landing.id}" else "Landing ${landing.id}"
				}
				.heightIn(min = TouchTarget)
				.padding(vertical = 6.dp),
		) {
			Text(
				landing.displayName,
				style = MaterialTheme.typography.bodyLarge,
				fontWeight = if (favorite) FontWeight.Bold else FontWeight.Medium,
				color = ferryColors.ink,
				maxLines = if (accessibilityText) Int.MAX_VALUE else 1,
				overflow = TextOverflow.Ellipsis,
				modifier = Modifier.weight(1f),
			)
			if (current) Icon(Icons.Filled.Check, contentDescription = null, tint = ferryColors.accent, modifier = Modifier.size(18.dp))
			Text(landing.id.toString(), style = FerryText.caption.copy(fontFeatureSettings = "tnum"), color = ferryColors.muted)
		}
	}
}

/** The tablet sidebar: workspace destinations, then the landing list beside the board, as on iPad. */
@Composable
fun LandingSidebar(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	Surface(color = ferryColors.card, contentColor = ferryColors.ink, modifier = modifier) {
		Column {
			Text(
				"Ferry Board",
				style = MaterialTheme.typography.titleLarge,
				fontWeight = FontWeight.Bold,
				color = ferryColors.heading,
				modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp),
			)
			SectionHeader("Workspace", Modifier.padding(top = 0.dp))
			WorkspaceRow("Departures", Icons.Filled.DirectionsBoat, state.tab == FerryTab.DEPARTURES, "navigation-departures") { ui.selectTab(FerryTab.DEPARTURES) }
			WorkspaceRow("Harbor map", Icons.Filled.Map, state.tab == FerryTab.MAP, "navigation-map") { ui.selectTab(FerryTab.MAP) }
			WorkspaceRow(state.rideSession?.vessel?.name ?: "Your boat", Icons.Filled.DirectionsBoat, state.showingRide, "sidebarBoat") { ui.yourBoat(state) }
			SectionHeader("Landings")
			LandingsContent(state, ui, inSheet = false, modifier = Modifier.weight(1f))
		}
	}
}

@Composable
private fun WorkspaceRow(title: String, icon: ImageVector, selected: Boolean, tag: String, onClick: () -> Unit) {
	NavigationDrawerItem(
		label = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
		selected = selected,
		onClick = onClick,
		icon = { Icon(icon, contentDescription = null) },
		colors = NavigationDrawerItemDefaults.colors(
			selectedContainerColor = ferryColors.accent.copy(alpha = 0.14f),
			selectedIconColor = ferryColors.accent,
			selectedTextColor = ferryColors.heading,
			unselectedContainerColor = ferryColors.card,
			unselectedIconColor = ferryColors.muted,
			unselectedTextColor = ferryColors.ink,
		),
		modifier = Modifier.padding(horizontal = 8.dp).testTag(tag),
	)
}
