package nyc.juliet.ferryboard.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.NewReleases
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import nyc.juliet.ferryboard.contract.AppPreferences
import nyc.juliet.ferryboard.contract.FerryAction
import nyc.juliet.ferryboard.contract.FerrySheet
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.ui.FerryUi
import nyc.juliet.ferryboard.ui.components.ChoiceRow
import nyc.juliet.ferryboard.ui.components.Footnote
import nyc.juliet.ferryboard.ui.components.NavigationRow
import nyc.juliet.ferryboard.ui.components.SectionHeader
import nyc.juliet.ferryboard.ui.components.SwitchRow
import nyc.juliet.ferryboard.ui.components.TouchTarget
import nyc.juliet.ferryboard.ui.theme.FerryThemes
import nyc.juliet.ferryboard.ui.theme.TextScale
import nyc.juliet.ferryboard.ui.theme.ferryColors

private const val WEBSITE = "https://juliet.nyc/ferryTimesMobile/"

/**
 * Settings. Theme is a local sub-page; the tools open their own sheets in place (so the root loads what they show) and
 * back returns here, as pushed pages do on iOS.
 */
@Composable
internal fun SettingsSheet(state: FerryUiState, ui: FerryUi, listState: LazyListState) {
	val pages = rememberPageStack("settings")
	val back: () -> Unit = { if (pages.size > 1) pages.removeAt(pages.lastIndex) }
	val tool: (FerrySheet) -> Unit = { ui.push(it, FerrySheet.SETTINGS) }
	when (pages.last()) {
		"theme" -> SheetFrame("Theme", ui, onBack = back) { ThemeList(state, ui, Modifier.weight(1f)) }
		else -> SheetFrame("Settings", ui) { SettingsRoot(state, ui, { pages.add(it) }, tool, listState, Modifier.weight(1f)) }
	}
}

@Composable
private fun SettingsRoot(
	state: FerryUiState,
	ui: FerryUi,
	push: (String) -> Unit,
	tool: (FerrySheet) -> Unit,
	listState: LazyListState,
	modifier: Modifier = Modifier,
) {
	val preferences = state.preferences
	fun update(change: AppPreferences.() -> AppPreferences) = ui.update(preferences.change())
	var choosingHome by rememberSaveable { mutableStateOf(false) }
	val landings = state.roster?.landings.orEmpty()
	val homeName = preferences.homeLandingId?.let { id -> landings.firstOrNull { it.id == id }?.displayName ?: "Landing $id" } ?: "Server default"
	LazyColumn(modifier.fillMaxWidth(), state = listState) {
		item(key = "reading") {
			SectionHeader("Reading")
			ChoiceRow("Text size", TextScale.choices, preferences.textSize, { update { copy(textSize = it) } }, tag = "textSize")
			SwitchRow("12-hour time", preferences.twelveHour, { update { copy(twelveHour = it) } }, tag = "clockFormat")
			ChoiceRow("Sort departures", listOf(false to "Departure time", true to "Route"), preferences.sortByRoute,
				{ update { copy(sortByRoute = it) } }, tag = "defaultSort")
			NavigationRow("Theme", value = FerryThemes.resolve(preferences.theme).name, tag = "settingsTheme") { push("theme") }
			Footnote("System follows your device’s font size. Larger device font sizes are always respected.")
		}
		item(key = "board") {
			SectionHeader("Departure board")
			SwitchRow("Show dwell times", preferences.showDwellTimes, { update { copy(showDwellTimes = it) } }, tag = "showDwellTimes")
			SwitchRow("Show layover times", preferences.showLayoverTimes, { update { copy(showLayoverTimes = it) } }, tag = "showLayoverTimes")
			ChoiceRow(
				"Departures per route",
				listOf(0 to "Default (${state.schedule?.meta?.departuresShown ?: 3})") + (1..5).map { it to it.toString() },
				preferences.departuresPerRoute,
				{ update { copy(departuresPerRoute = it) } },
				tag = "departuresPerRoute",
			)
			ChoiceRow(
				"Look ahead",
				listOf(0 to "Default (${state.schedule?.meta?.departureWindowMinutes ?: 180} min)", 30 to "30 minutes", 60 to "1 hour", 120 to "2 hours", 240 to "4 hours"),
				preferences.departureWindowMinutes,
				{ update { copy(departureWindowMinutes = it) } },
				tag = "departureWindow",
			)
			Footnote("Dwell and layover appear when the schedule supplies them. The route limit applies when sorting by route; look ahead applies to today.")
		}
		item(key = "launch") {
			SectionHeader("On launch")
			ChoiceRow("Opening landing", listOf("lastUsed" to "Last used", "home" to "Home landing"), preferences.launchLanding,
				{ update { copy(launchLanding = it) } }, tag = "launchLanding")
			NavigationRow("Home landing", value = homeName, tag = "homeLanding") { choosingHome = true }
			val current = preferences.landingId
			if (current != null && current != preferences.homeLandingId) {
				NavigationRow("Use ${state.landingTitle} as home", icon = Icons.Filled.Home, tag = "useAsHome", chevron = false, tint = ferryColors.accent) {
					update { copy(homeLandingId = current) }
				}
			}
			ChoiceRow("Opening screen", listOf("departures" to "Departures", "map" to "Map", "lastUsed" to "Last used"), preferences.launchTab,
				{ update { copy(launchTab = it) } }, tag = "launchTab")
			Footnote("Applied on the next app launch. An active ride still reopens on your boat.")
		}
		item(key = "shift") {
			SectionHeader("On shift")
			SwitchRow("Marine references on map", preferences.showMarineReferences, { update { copy(showMarineReferences = it) } }, tag = "showMarineReferences")
			SwitchRow("Keep screen awake", preferences.keepScreenAwake, { update { copy(keepScreenAwake = it) } }, tag = "keepScreenAwake")
			Footnote("Keep screen awake applies while Ferry Board is open. Marine references show bridges and seamarks.")
		}
		item(key = "tools") {
			SectionHeader("Tools")
			NavigationRow("Nearby ferry widget", icon = Icons.Filled.Widgets, tag = "settingsWidget") { tool(FerrySheet.WIDGET) }
			NavigationRow("Operators & routes", icon = Icons.Filled.FilterList, tag = "settingsFilters") { tool(FerrySheet.FILTERS) }
			NavigationRow("Landings & favorites", icon = Icons.Filled.Star, tag = "settingsLandings") { tool(FerrySheet.LANDINGS) }
			NavigationRow("Service alerts", icon = Icons.Filled.Warning, tag = "settingsAlerts") { tool(FerrySheet.ALERTS) }
			NavigationRow(if (state.rideSession == null) "Choose your boat" else "Switch boats", icon = Icons.Filled.DirectionsBoat,
				tag = "settingsChooseBoat") { ui.openVessels(null) }
			RefreshRow(state, ui)
		}
		item(key = "app") {
			SectionHeader("Ferry Board")
			NavigationRow("What’s new", icon = Icons.Filled.NewReleases, tag = "settingsChangelog") { tool(FerrySheet.CHANGELOG) }
			NavigationRow("Open the website", icon = Icons.AutoMirrored.Filled.OpenInNew, tag = "openWebsite", chevron = false) {
				ui.send(FerryAction.OpenUrl(WEBSITE))
			}
			Footnote("Downloaded schedules are available offline. The harbor chart is bundled with the app, so the map draws without a connection.")
			Footnote("Marine references: OpenStreetMap / OpenSeaMap contributors, ODbL. Reference information only.")
		}
	}
	if (choosingHome) {
		LandingChoiceDialog(
			title = "Home landing",
			landings = landings,
			favorites = preferences.favorites,
			selected = preferences.homeLandingId,
			tag = "homeLanding",
			noneLabel = "Server default",
			onSelect = { landing -> update { copy(homeLandingId = landing?.id) }; choosingHome = false },
			onDismiss = { choosingHome = false },
		)
	}
}

/** Refresh everything now, then say what the board is using: fresh data, a saved schedule, or nothing yet. */
@Composable
private fun RefreshRow(state: FerryUiState, ui: FerryUi) {
	var requested by rememberSaveable { mutableStateOf(false) }
	var note by rememberSaveable { mutableStateOf<String?>(null) }
	val current by rememberUpdatedState(state)
	LaunchedEffect(requested) {
		if (!requested) return@LaunchedEffect
		delay(400)
		snapshotFlow { current.refreshing }.first { !it }
		note = when {
			current.schedule == null -> "Connect to download a schedule."
			current.scheduleSaved -> "Saved schedule is still in use."
			else -> "Data refreshed."
		}
		requested = false
	}
	val busy = requested || state.refreshing
	Box {
		NavigationRow("Refresh data now", icon = Icons.Filled.Refresh, tag = "refreshData", enabled = !busy, chevron = false) {
			note = null
			requested = true
			ui.send(FerryAction.Refresh)
		}
		if (busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 16.dp).size(20.dp))
	}
	note?.let { Footnote(it) }
}

/** The nine themes with a swatch of each: accent on its own background. */
@Composable
private fun ThemeList(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	LazyColumn(modifier.fillMaxWidth()) {
		items(FerryThemes.all, key = { it.id }) { theme ->
			val chosen = theme.id == FerryThemes.resolve(state.preferences.theme).id
			Row(
				verticalAlignment = Alignment.CenterVertically,
				horizontalArrangement = Arrangement.spacedBy(14.dp),
				modifier = Modifier
					.fillMaxWidth()
					.testTag("theme-${theme.id}")
					.clickable(role = Role.RadioButton) { if (!chosen) ui.update(state.preferences.copy(theme = theme.id)) }
					.semantics { selected = chosen }
					.background(if (chosen) ferryColors.accent.copy(alpha = 0.08f) else Color.Transparent)
					.heightIn(min = TouchTarget + 8.dp)
					.padding(horizontal = 16.dp),
			) {
				Box(
					contentAlignment = Alignment.Center,
					modifier = Modifier
						.size(36.dp)
						.background(Color(theme.palette.background), RoundedCornerShape(10.dp))
						.border(1.dp, Color(theme.palette.line), RoundedCornerShape(10.dp)),
				) {
					Box(Modifier.size(18.dp).background(Color(theme.palette.accent), CircleShape))
				}
				Text(theme.name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
					color = ferryColors.ink, modifier = Modifier.weight(1f))
				if (theme.dark) Text("Dark", style = MaterialTheme.typography.labelMedium, color = ferryColors.muted)
				if (chosen) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = ferryColors.accent)
			}
		}
	}
}
