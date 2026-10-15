package nyc.juliet.ferryboard.ui.sheets

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import nyc.juliet.ferryboard.contract.FerryAction
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.NYCFerryMovement
import nyc.juliet.ferryboard.ui.FerryUi
import nyc.juliet.ferryboard.ui.components.Footnote
import nyc.juliet.ferryboard.ui.components.RowDivider
import nyc.juliet.ferryboard.ui.components.SectionHeader
import nyc.juliet.ferryboard.ui.components.SwitchRow
import nyc.juliet.ferryboard.ui.components.RouteBadge
import nyc.juliet.ferryboard.ui.theme.ferryColors

/** The wire names, which are also the iOS accessibility identifiers. */
internal val NYCFerryMovement.wireName: String
	get() = when (this) {
		NYCFerryMovement.PIER_C -> "pierC"
		NYCFerryMovement.CREW_SHUTTLE -> "crewShuttle"
		NYCFerryMovement.OUT_OF_SERVICE -> "outOfService"
	}

internal val NYCFerryMovement.label: String
	get() = when (this) {
		NYCFerryMovement.PIER_C -> "Headed to Pier C"
		NYCFerryMovement.CREW_SHUTTLE -> "Crew shuttles"
		NYCFerryMovement.OUT_OF_SERVICE -> "Out of service boats"
	}

/**
 * Operator switches, each expandable to its routes; NYC Ferry also lists its non-passenger movements, which filter
 * independently of the routes. Choices apply across landings and to trip connections.
 */
@Composable
internal fun FiltersContent(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	val preferences = state.preferences
	var expanded by rememberSaveable { mutableStateOf(listOf<String>()) }
	val operators = state.roster?.operators.orEmpty()
	LazyColumn(modifier.fillMaxWidth()) {
		if (operators.isEmpty()) {
			item(key = "none") { Footnote("Connect to load the operators serving your landings.") }
		}
		for (name in operators) {
			val open = name in expanded
			val shown = name !in preferences.hiddenOperators
			item(key = "operator|$name") {
				Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(start = 4.dp)) {
					IconButton(
						onClick = { expanded = if (open) expanded - name else expanded + name },
						modifier = Modifier.testTag("expandOperator-$name").semantics {
							contentDescription = "${if (open) "Collapse" else "Expand"} $name filters"
							stateDescription = if (open) "Expanded" else "Collapsed"
						},
					) {
						Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = ferryColors.muted)
					}
					SwitchRow(
						title = name,
						checked = shown,
						onCheckedChange = { visible ->
							ui.update(preferences.copy(hiddenOperators = if (visible) preferences.hiddenOperators - name else preferences.hiddenOperators + name))
						},
						tag = "operator-$name",
						modifier = Modifier.weight(1f),
					)
				}
			}
			if (open) {
				val routes = FilterLogic.routes(name, state.roster, state.schedule)
				for ((id, route) in routes) {
					item(key = "route|$name|$id") {
						val badge: (@Composable RowScope.() -> Unit)? = if (FilterLogic.routeCode(route) != null) {
							{ RouteBadge(id, null, route, operatorName = name, modifier = Modifier.padding(end = 10.dp)) }
						} else null
						SwitchRow(
							title = route.name,
							checked = id !in preferences.hiddenRoutes,
							enabled = shown,
							onCheckedChange = { visible ->
								ui.update(preferences.copy(hiddenRoutes = if (visible) preferences.hiddenRoutes - id else preferences.hiddenRoutes + id))
							},
							tag = "routeFilter-$id",
							indent = 2,
							leading = badge,
						)
					}
				}
				if (routes.isEmpty()) item(key = "noroutes|$name") { Footnote("No routes listed at this landing.", Modifier.padding(start = 40.dp)) }
				if (name == "NYC Ferry") {
					item(key = "operations|$name") { SectionHeader("Operations", Modifier.padding(start = 40.dp)) }
					for (movement in NYCFerryMovement.entries) {
						item(key = "movement|${movement.wireName}") {
							SwitchRow(
								title = movement.label,
								checked = movement !in preferences.hiddenNYCMovements,
								enabled = shown,
								onCheckedChange = { visible ->
									ui.update(preferences.copy(hiddenNYCMovements =
										if (visible) preferences.hiddenNYCMovements - movement else preferences.hiddenNYCMovements + movement))
								},
								tag = "movementFilter-${movement.wireName}",
								indent = 2,
							)
						}
					}
				}
			}
			item(key = "divider|$name") { RowDivider() }
		}
		item(key = "footer") {
			Footnote("Choices are saved across landings and apply to trip connections. Route and movement filters work together. " +
				"Pier C returns and crew shuttles have their own switches; Out of service controls other non-passenger movements.")
		}
		item(key = "reset") {
			OutlinedButton(
				onClick = { ui.send(FerryAction.ResetFilters) },
				enabled = preferences.filters.isActive,
				modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp).testTag("resetDepartureFilters"),
			) { Text("Show all departures") }
		}
	}
}
