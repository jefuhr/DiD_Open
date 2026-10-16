package nyc.juliet.ferrykitty.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.AddToHomeScreen
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FilterAltOff
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.WidgetOptions
import nyc.juliet.ferrykitty.ui.components.ChoiceRow
import nyc.juliet.ferrykitty.ui.components.Footnote
import nyc.juliet.ferrykitty.ui.components.NavigationRow
import nyc.juliet.ferrykitty.ui.components.SectionHeader
import nyc.juliet.ferrykitty.ui.components.SwitchRow
import nyc.juliet.ferrykitty.ui.sheets.LandingChoiceDialog
import nyc.juliet.ferrykitty.ui.theme.FerryThemes
import nyc.juliet.ferrykitty.ui.theme.TextScale
import nyc.juliet.ferrykitty.ui.theme.ferryColors

/**
 * Widget settings, shared by the app's Nearby ferry widget page and the widget configuration activity. In the app
 * these are the widget defaults; while configuring one widget ([FerryUiState.configuringWidget]) the first switch
 * chooses between those defaults and this widget's own settings.
 */
@Composable
fun WidgetSettingsContent(state: FerryUiState, onAction: (FerryAction) -> Unit, modifier: Modifier = Modifier) {
	val options = state.widgetOptions
	fun set(change: WidgetOptions.() -> WidgetOptions) = onAction(FerryAction.SetWidgetOptions(options.change()))
	val custom = !state.configuringWidget || !state.widgetUseAppDefaults
	var copied by rememberSaveable { mutableStateOf(false) }
	var choosingLanding by rememberSaveable { mutableStateOf(false) }
	// The root reports location, refresh, pin and validation results in one status. In the app it appears beside the
	// control that asked; while configuring a widget it appears with the landing choice, which Apply validates.
	var lastAction by rememberSaveable { mutableStateOf<String?>(null) }
	fun statusAt(place: String): Boolean = when {
		state.configuringWidget -> place == "landing"
		lastAction == null -> place == "refresh"
		else -> place == lastAction
	}
	val status = @Composable { place: String ->
		state.widgetStatus?.takeIf { statusAt(place) }?.let { Footnote(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
	}
	val roster = state.roster
	LazyColumn(modifier.fillMaxWidth()) {
		if (state.configuringWidget) {
			item(key = "this") {
				SectionHeader("This widget")
				SwitchRow(
					"Use app widget defaults",
					state.widgetUseAppDefaults,
					{ onAction(FerryAction.SetWidgetUseDefaults(it)) },
					subtitle = if (state.widgetUseAppDefaults) "Set in Ferry Kitty under Settings › Nearby ferry widget." else "This widget keeps its own choices below.",
					tag = "widgetUseDefaults",
				)
				if (!custom) status("landing")
			}
		} else {
			item(key = "defaults") {
				SectionHeader("Widget defaults")
				NavigationRow("Copy main app settings", icon = Icons.Filled.ContentCopy, tag = "widgetCopySettings", chevron = false, tint = ferryColors.accent) {
					onAction(FerryAction.CopySettingsToWidget)
					copied = true
				}
				if (copied) Footnote("Copied to widget defaults.", Modifier.semantics { liveRegion = LiveRegionMode.Polite })
				Footnote("Copies the current landing, operator and route filters, clock, theme, text size, dwell, layover and look-ahead options. " +
					"You can change these below. Widgets using custom settings keep their own choices.")
			}
		}
		if (custom) {
			item(key = "landing") {
				SectionHeader("Landing")
				SwitchRow("Automatically use nearest landing", options.automaticLanding, { set { copy(automaticLanding = it) } }, tag = "widgetAutomaticLanding")
				if (options.automaticLanding) {
					NavigationRow("Enable background location", icon = Icons.Filled.MyLocation, tag = "widgetEnableLocation", chevron = false,
						tint = ferryColors.accent) {
						lastAction = "location"
						onAction(FerryAction.EnableWidgetLocation)
					}
					status("location")
				} else {
					NavigationRow(
						"Fixed landing",
						icon = Icons.Filled.Place,
						value = options.landingName ?: options.landingId?.let { id -> roster?.landings?.firstOrNull { it.id == id }?.displayName } ?: "Choose a landing",
						tag = "widgetFixedLanding",
						enabled = roster != null || options.landingId != null,
					) { choosingLanding = true }
				}
				status("landing")
				Footnote("A fixed landing works without location permission. In automatic mode, allow location all the time so the widget can follow you " +
					"between updates; it takes a brief fix only when Android runs an update, and coordinates stay on your device.")
			}
			item(key = "operators") {
				SectionHeader("Operators")
				val operators = roster?.operators.orEmpty()
				if (operators.isEmpty()) Footnote("Connect to load the operators.")
				for (name in operators) {
					SwitchRow(name, name !in options.hiddenOperators, { visible ->
						set { copy(hiddenOperators = if (visible) hiddenOperators - name else hiddenOperators + name) }
					}, tag = "widgetOperator-$name")
				}
				if (options.hiddenRoutes.isNotEmpty() || options.hiddenNYCMovements.isNotEmpty()) {
					Footnote("Copied route and NYC Ferry movement filters are also active.")
					NavigationRow("Clear copied route and movement filters", tag = "widgetClearCopiedFilters", chevron = false, tint = ferryColors.accent) {
						set { copy(hiddenRoutes = emptySet(), hiddenNYCMovements = emptySet()) }
					}
				}
				if (options.filters.isActive) {
					NavigationRow("Show all departures in the widget", icon = Icons.Filled.FilterAltOff, tag = "widgetResetFilters", chevron = false, tint = ferryColors.accent) {
						onAction(FerryAction.ResetWidgetFilters)
					}
				}
			}
			item(key = "information") {
				SectionHeader("Show information")
				SwitchRow("Boat names", options.showBoatNames, { set { copy(showBoatNames = it) } }, tag = "widgetBoatNames")
				SwitchRow("Route assignments", options.showAssignments, { set { copy(showAssignments = it) } }, tag = "widgetAssignments")
				SwitchRow("Dwell times", options.showDwells, { set { copy(showDwells = it) } }, tag = "widgetDwells")
				SwitchRow("Layover times", options.showLayovers, { set { copy(showLayovers = it) } }, tag = "widgetLayovers")
				SwitchRow("Countdowns", options.showCountdown, { set { copy(showCountdown = it) } }, tag = "widgetCountdowns")
			}
			item(key = "reading") {
				SectionHeader("Reading and departures")
				SwitchRow("12-hour time", options.twelveHour, { set { copy(twelveHour = it) } }, tag = "widgetTwelveHour")
				SwitchRow("Sort by route", options.sortByRoute, { set { copy(sortByRoute = it) } }, tag = "widgetSortByRoute")
				ChoiceRow("Theme", listOf("system" to "Follow device appearance") + FerryThemes.all.map { it.id to it.name }, options.theme,
					{ set { copy(theme = it) } }, tag = "widgetTheme")
				ChoiceRow("Text size", TextScale.choices, options.textSize, { set { copy(textSize = it) } }, tag = "widgetTextSize")
				ChoiceRow("Look ahead", listOf(0 to "Schedule default", 30 to "30 minutes", 60 to "1 hour", 120 to "2 hours", 240 to "4 hours"),
					options.departureWindowMinutes, { set { copy(departureWindowMinutes = it) } }, tag = "widgetWindow")
				ChoiceRow("Departures per route", listOf(0 to "Fill widget") + (1..5).map { it to it.toString() }, options.departuresPerRoute,
					{ set { copy(departuresPerRoute = it) } }, tag = "widgetPerRoute")
			}
		}
		if (!state.configuringWidget || custom) item(key = "refresh") {
			SectionHeader(if (state.configuringWidget) "Reset" else "Refresh")
			if (!state.configuringWidget) {
				NavigationRow("Refresh widgets now", icon = Icons.Filled.Refresh, tag = "widgetRefresh", chevron = false) {
					lastAction = "refresh"
					onAction(FerryAction.RefreshWidgets)
				}
				status("refresh")
			}
			if (custom) {
				NavigationRow(if (state.configuringWidget) "Reset this widget" else "Reset widget defaults", icon = Icons.Filled.RestartAlt,
					tag = "widgetResetDefaults", chevron = false) {
					onAction(FerryAction.SetWidgetOptions(WidgetOptions()))
					copied = false
				}
			}
			if (!state.configuringWidget) {
				Footnote("Changes apply to widgets that use the app widget defaults. To give one widget its own settings, touch and hold it, " +
					"choose its settings, then turn off Use app widget defaults.")
			}
		}
		if (!state.configuringWidget) {
			item(key = "install") {
				SectionHeader("Add the widget")
				NavigationRow("Add widget to Home screen", icon = Icons.AutoMirrored.Filled.AddToHomeScreen, tag = "widgetPin", chevron = false, tint = ferryColors.accent) {
					lastAction = "pin"
					onAction(FerryAction.PinWidget)
				}
				status("pin")
				Footnote("Or touch and hold your Home screen, choose Widgets, then find Ferry Kitty. Choose a small, medium or large widget.")
			}
		}
		item(key = "notes") {
			SectionHeader("During your shift")
			Footnote("Android decides exactly when widgets update. Scheduled departures advance between downloads; live timing and vessel names expire after five minutes.")
			Footnote("If your location is temporarily unavailable, the widget labels its last location. After six hours it asks you to update location. " +
				"Tap the widget to open its landing in Ferry Kitty.")
			Spacer(Modifier.size(16.dp))
		}
	}
	if (choosingLanding) {
		LandingChoiceDialog(
			title = "Fixed landing",
			landings = roster?.landings.orEmpty(),
			favorites = state.preferences.favorites,
			selected = options.landingId,
			tag = "widgetFixedLanding",
			noneLabel = null,
			onSelect = { landing ->
				if (landing != null) set { copy(landingId = landing.id, landingName = landing.displayName) }
				choosingLanding = false
			},
			onDismiss = { choosingLanding = false },
		)
	}
}

/** The app's Nearby ferry widget page inside a sheet. */
@Composable
internal fun WidgetPage(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	WidgetSettingsContent(state, onAction = ui::send, modifier = modifier)
}
