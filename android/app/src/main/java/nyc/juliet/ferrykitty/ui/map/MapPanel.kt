package nyc.juliet.ferrykitty.ui.map

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.Boat
import nyc.juliet.ferrykitty.core.Bridge
import nyc.juliet.ferrykitty.core.Landing
import nyc.juliet.ferrykitty.core.Seamark
import nyc.juliet.ferrykitty.ui.FerryUi
import nyc.juliet.ferrykitty.ui.components.Footnote
import nyc.juliet.ferrykitty.ui.components.RowDivider
import nyc.juliet.ferrykitty.ui.components.SectionHeader
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.sheets.FilterLogic
import nyc.juliet.ferrykitty.ui.theme.FerryText
import nyc.juliet.ferrykitty.ui.theme.ferryColors
import java.util.Locale
import kotlin.math.roundToInt

internal enum class MapPanelTab(val label: String, val tag: String) {
	VESSELS("Vessels", "vessels"),
	LANDINGS("Landings", "landings"),
	MARINE("Marine", "marine"),
}

/**
 * The map's companion lists: every vessel, landing and marine reference on the chart, plus Your boat. Collapsible
 * under the map; always open beside it in landscape space wide enough for both (see [MapLayout]).
 */
@Composable
internal fun MapPanel(
	state: FerryUiState,
	ui: FerryUi,
	boats: List<Boat>,
	totalBoats: Int,
	feedStale: Boolean,
	landings: List<Landing>,
	nextStop: Int?,
	bridges: List<Bridge>,
	seamarks: List<Seamark>,
	seamarkStyles: Map<String, SeamarkStyle>,
	tab: MapPanelTab,
	onTab: (MapPanelTab) -> Unit,
	open: Boolean,
	onToggle: (() -> Unit)?,
	listHeight: Dp?,
	onBoat: (Boat) -> Unit,
	onLanding: (Landing) -> Unit,
	onBridge: (Bridge) -> Unit,
	onSeamark: (Seamark) -> Unit,
	modifier: Modifier = Modifier,
) {
	val colors = ferryColors
	val marine = state.preferences.showMarineReferences
	val counts = mapOf(
		MapPanelTab.VESSELS to boats.size,
		MapPanelTab.LANDINGS to landings.size,
		MapPanelTab.MARINE to if (marine) bridges.size + seamarks.size else 0,
	)
	BoxWithConstraints(modifier.background(colors.card).testTag("mapPanel")) {
		val inlineTabs = maxWidth >= 420.dp
		Column(if (listHeight == null) Modifier.fillMaxWidth().fillMaxHeight() else Modifier.fillMaxWidth()) {
			Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget).padding(end = 4.dp)) {
				if (onToggle != null) {
					IconButton(onClick = onToggle, modifier = Modifier.testTag("mapPanelToggle")) {
						Icon(if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowUp, contentDescription = if (open) "Hide map lists" else "Show map lists",
							tint = colors.heading)
					}
				} else {
					Spacer(Modifier.width(8.dp))
				}
				when {
					open && inlineTabs -> PanelTabs(tab, counts, onTab, Modifier.weight(1f))
					open -> Text("Harbor lists", style = MaterialTheme.typography.titleSmall, color = colors.heading, modifier = Modifier.weight(1f))
					else -> Text(
						"${tab.label} · ${counts[tab] ?: 0}",
						style = MaterialTheme.typography.titleSmall,
						color = colors.heading,
						maxLines = 1,
						overflow = TextOverflow.Ellipsis,
						modifier = Modifier.weight(1f).heightIn(min = TouchTarget).clickable(onClickLabel = "Show map lists", role = Role.Button) { onToggle?.invoke() }
							.padding(top = 14.dp),
					)
				}
				TextButton(onClick = { ui.yourBoat(state) }, modifier = Modifier.heightIn(min = TouchTarget).testTag("chooseBoat")) {
					Icon(Icons.Filled.DirectionsBoat, contentDescription = null, modifier = Modifier.size(18.dp))
					Spacer(Modifier.width(6.dp))
					Text("Your boat", maxLines = 1)
				}
			}
			if (open) {
				if (!inlineTabs) PanelTabs(tab, counts, onTab, Modifier.fillMaxWidth())
				RowDivider(start = 0)
				val listModifier = if (listHeight != null) Modifier.fillMaxWidth().height(listHeight) else Modifier.fillMaxWidth().weight(1f)
				key(tab) {
					val listState = rememberLazyListState()
					LazyColumn(state = listState, modifier = listModifier) {
						when (tab) {
							MapPanelTab.VESSELS -> vesselItems(this, boats, totalBoats, feedStale, state, onBoat)
							MapPanelTab.LANDINGS -> landingItems(this, landings, nextStop, state, ui, onLanding)
							MapPanelTab.MARINE -> marineItems(this, marine, bridges, seamarks, seamarkStyles, state, ui, onBridge, onSeamark)
						}
					}
				}
			}
		}
	}
}

@Composable
private fun PanelTabs(selected: MapPanelTab, counts: Map<MapPanelTab, Int>, onTab: (MapPanelTab) -> Unit, modifier: Modifier) {
	val colors = ferryColors
	Row(modifier.selectableGroup()) {
		for (tab in MapPanelTab.entries) {
			val active = tab == selected
			Box(
				contentAlignment = Alignment.Center,
				modifier = Modifier
					.weight(1f)
					.heightIn(min = TouchTarget)
					.testTag("mapPanelTab-${tab.tag}")
					.selectable(selected = active, role = Role.Tab, onClick = { onTab(tab) }),
			) {
				Text(
					"${tab.label} ${counts[tab] ?: 0}",
					style = MaterialTheme.typography.labelLarge.copy(fontWeight = if (active) FontWeight.Bold else FontWeight.Medium),
					color = if (active) colors.accent else colors.muted,
					maxLines = 1,
					overflow = TextOverflow.Ellipsis,
					textAlign = TextAlign.Center,
					modifier = Modifier.padding(horizontal = 4.dp),
				)
				if (active) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth(0.7f).height(3.dp).background(colors.accent, CircleShape))
			}
		}
	}
}

private fun vesselItems(scope: androidx.compose.foundation.lazy.LazyListScope, boats: List<Boat>, total: Int, feedStale: Boolean, state: FerryUiState,
	onBoat: (Boat) -> Unit) = with(scope) {
	if (boats.isEmpty()) {
		item(key = "empty") { Footnote(MapText.noVessels(total, state.mapSearch.isNotBlank(), state.routeFilter != null), Modifier.padding(vertical = 10.dp)) }
	}
	items(boats, key = { it.id }) { boat ->
		VesselRow(boat, VesselSearch.isStale(boat, feedStale), boat.id == state.selectedBoatId) { onBoat(boat) }
		RowDivider(start = 60)
	}
}

@Composable
private fun VesselRow(boat: Boat, stale: Boolean, selected: Boolean, onClick: () -> Unit) {
	val colors = ferryColors
	val background = colors.theme.palette.card
	val fillArgb = remember(boat.color, stale, background) { VesselSearch.markerFill(boat, stale, background) }
	val fill = Color(fillArgb)
	val text = Color(VesselSearch.markerText(fillArgb))
	val age = VesselSearch.ageLabel(boat.ageSeconds)
	Row(
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		modifier = Modifier
			.fillMaxWidth()
			.testTag("mapBoat-${boat.id}")
			.background(if (selected) colors.sunken else Color.Transparent)
			.clickable(onClickLabel = "Show vessel details", role = Role.Button, onClick = onClick)
			.heightIn(min = 56.dp)
			.padding(horizontal = 16.dp, vertical = 6.dp)
			.semantics { if (selected) stateDescription = "Selected" },
	) {
		Box(contentAlignment = Alignment.Center, modifier = Modifier.size(32.dp).background(fill, CircleShape)) {
			Text(VesselSearch.hullLabel(boat.number), color = text, maxLines = 1,
				style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 9.sp))
		}
		Column(Modifier.weight(1f)) {
			Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
				Text(boat.name, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.ink, maxLines = 1,
					overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
				boat.number?.takeIf { it.isNotBlank() && it != boat.name }?.let { Text(it, style = FerryText.caption, color = colors.muted, maxLines = 1) }
			}
			Text(listOfNotNull(boat.routeName ?: boat.route, VesselSearch.doing(boat)).joinToString(" · "), style = FerryText.caption, color = colors.muted,
				maxLines = 2, overflow = TextOverflow.Ellipsis)
		}
		Column(horizontalAlignment = Alignment.End) {
			Text(boat.speedKnots?.let { String.format(Locale.US, "%.1f kn", it) } ?: "—", style = FerryText.countdown, color = if (stale) colors.muted else colors.ink)
			val freshness = if (stale) listOfNotNull("Last reported", age).joinToString(" ") else age
			if (freshness != null) Text(freshness, style = FerryText.caption, color = if (stale) colors.warning else colors.muted, maxLines = 1)
		}
	}
}

private fun landingItems(scope: androidx.compose.foundation.lazy.LazyListScope, landings: List<Landing>, nextStop: Int?, state: FerryUiState, ui: FerryUi,
	onLanding: (Landing) -> Unit) = with(scope) {
	val sorted = FilterLogic.landings(landings, "", state.preferences.favorites)
	if (sorted.isEmpty()) item(key = "empty") { Footnote("Landings appear once harbor information has loaded.", Modifier.padding(vertical = 10.dp)) }
	items(sorted, key = { it.id }) { landing ->
		LandingRow(
			landing = landing,
			favorite = landing.id in state.preferences.favorites,
			board = landing.id == state.preferences.landingId,
			next = landing.id == nextStop,
			onFavorite = { ui.send(FerryAction.ToggleFavorite(landing.id)) },
			onClick = { onLanding(landing) },
		)
		RowDivider(start = 44)
	}
}

@Composable
private fun LandingRow(landing: Landing, favorite: Boolean, board: Boolean, next: Boolean, onFavorite: () -> Unit, onClick: () -> Unit) {
	val colors = ferryColors
	Row(
		verticalAlignment = Alignment.CenterVertically,
		modifier = Modifier
			.fillMaxWidth()
			.testTag("mapLanding-${landing.id}")
			.clickable(onClickLabel = "Show on map", role = Role.Button, onClick = onClick)
			.heightIn(min = 56.dp)
			.padding(start = 16.dp, end = 4.dp),
	) {
		Canvas(Modifier.size(14.dp).clearAndSetSemantics { }) {
			if (board) drawCircle(colors.accent, radius = size.minDimension / 2f, style = Stroke(width = 2.dp.toPx()))
			drawCircle(if (next) colors.warning else colors.card, radius = 4.5.dp.toPx())
			drawCircle(colors.ink, radius = 4.5.dp.toPx(), style = Stroke(width = 1.5.dp.toPx()))
		}
		Column(Modifier.weight(1f).padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp)) {
			Text(landing.displayName, style = MaterialTheme.typography.bodyMedium, color = colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
			Text(listOfNotNull(MapText.landingNumber(landing.id), "Your board".takeIf { board }, "Next stop".takeIf { next }).joinToString(" · "),
				style = FerryText.caption, color = colors.muted)
		}
		IconToggleButton(checked = favorite, onCheckedChange = { onFavorite() }, modifier = Modifier.testTag("mapLandingFavorite-${landing.id}")) {
			Icon(if (favorite) Icons.Filled.Star else Icons.Filled.StarBorder, tint = if (favorite) colors.warning else colors.muted,
				contentDescription = if (favorite) "Remove ${landing.displayName} from favorites" else "Add ${landing.displayName} to favorites")
		}
	}
}

private fun marineItems(
	scope: androidx.compose.foundation.lazy.LazyListScope,
	marine: Boolean,
	bridges: List<Bridge>,
	seamarks: List<Seamark>,
	styles: Map<String, SeamarkStyle>,
	state: FerryUiState,
	ui: FerryUi,
	onBridge: (Bridge) -> Unit,
	onSeamark: (Seamark) -> Unit,
) = with(scope) {
	if (!marine) {
		item(key = "off") {
			Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
				Footnote("Marine references are off, so bridges, lights and buoys are hidden on the map.")
				TextButton(
					onClick = { ui.update(state.preferences.copy(showMarineReferences = true)) },
					modifier = Modifier.padding(horizontal = 8.dp).heightIn(min = TouchTarget).testTag("mapShowMarine"),
				) { Text("Show marine references") }
			}
		}
		return@with
	}
	if (bridges.isNotEmpty()) item(key = "bridges") { SectionHeader("Bridges") }
	items(bridges, key = { "bridge-${it.id}" }) { bridge ->
		MarineRow(
			tag = "mapBridge-${bridge.id}",
			title = bridge.name,
			detail = listOfNotNull(bridge.clearanceNote ?: bridge.clearanceFeet?.let { "${it.roundToInt()} ft clearance" }, bridge.waterway).joinToString(" · "),
			glyph = { BridgeGlyph() },
			onClick = { onBridge(bridge) },
		)
		RowDivider(start = 50)
	}
	if (seamarks.isNotEmpty()) item(key = "seamarks") { SectionHeader("Lights and buoys") }
	items(seamarks, key = { "seamark-${it.id}" }) { seamark ->
		val style = ChartGeometry.styleFor(seamark, styles)
		MarineRow(
			tag = "mapSeamark-${seamark.id}",
			title = seamark.name,
			detail = listOfNotNull(seamark.characteristic, seamark.rangeNm?.let { "${it.roundToInt()} nm" }).joinToString(" · ").ifEmpty { seamark.type.orEmpty() },
			glyph = { SeamarkGlyph(style) },
			onClick = { onSeamark(seamark) },
		)
		RowDivider(start = 50)
	}
	if (bridges.isEmpty() && seamarks.isEmpty()) item(key = "none") { Footnote("No marine references are available yet.") }
	item(key = "note") { Footnote("Marine references are a service guide, not a navigation chart or a guarantee of clearance.", Modifier.padding(vertical = 8.dp)) }
}

@Composable
private fun MarineRow(tag: String, title: String, detail: String, glyph: @Composable () -> Unit, onClick: () -> Unit) {
	val colors = ferryColors
	Row(
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		modifier = Modifier
			.fillMaxWidth()
			.testTag(tag)
			.clickable(onClickLabel = "Show details", role = Role.Button, onClick = onClick)
			.heightIn(min = 52.dp)
			.padding(horizontal = 16.dp, vertical = 6.dp),
	) {
		Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) { glyph() }
		Column(Modifier.weight(1f)) {
			Text(title, style = MaterialTheme.typography.bodyMedium, color = colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
			if (detail.isNotEmpty()) Text(detail, style = FerryText.caption, color = colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
		}
		Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.muted, modifier = Modifier.size(20.dp))
	}
}

@Composable
private fun BridgeGlyph() {
	val map = ferryColors.theme.map
	Canvas(Modifier.size(22.dp).clearAndSetSemantics { }) {
		val y = size.height / 2f
		drawLine(Color(map.bridgeCasing), Offset(2.dp.toPx(), y), Offset(size.width - 2.dp.toPx(), y), strokeWidth = 5.dp.toPx(), cap = StrokeCap.Round)
		drawLine(Color(map.bridge), Offset(2.dp.toPx(), y), Offset(size.width - 2.dp.toPx(), y), strokeWidth = 2.5.dp.toPx(), cap = StrokeCap.Round)
	}
}

@Composable
private fun SeamarkGlyph(style: SeamarkStyle) {
	val map = ferryColors.theme.map
	val muted = ferryColors.muted
	Canvas(Modifier.size(22.dp).clearAndSetSemantics { }) {
		val center = Offset(size.width / 2f, size.height / 2f)
		val half = 5.dp.toPx()
		val fill = when (style.kind) {
			SeamarkKind.LIGHT -> Color(map.light)
			SeamarkKind.BUOY_GREEN -> Color(map.buoyGreen)
			SeamarkKind.BUOY_RED -> Color(map.buoyRed)
			SeamarkKind.BUOY_SAFE_WATER -> Color(map.land)
			SeamarkKind.OTHER -> muted
		}
		when (style.shape) {
			SeamarkShape.LIGHT -> {
				drawCircle(fill, radius = 8.dp.toPx(), center = center, alpha = 0.25f)
				drawCircle(fill, radius = 3.5.dp.toPx(), center = center)
			}
			SeamarkShape.CAN -> drawRect(fill, topLeft = Offset(center.x - half, center.y - half), size = Size(half * 2, half * 2))
			SeamarkShape.NUN -> drawPath(Path().apply {
				moveTo(center.x, center.y - half * 1.2f)
				lineTo(center.x + half, center.y + half)
				lineTo(center.x - half, center.y + half)
				close()
			}, fill)
			SeamarkShape.SPHERE -> {
				drawCircle(fill, radius = half, center = center)
				drawCircle(Color(map.buoyRed), radius = half, center = center, style = Stroke(width = 1.6.dp.toPx()))
			}
			SeamarkShape.MARK -> drawPath(Path().apply {
				moveTo(center.x, center.y - half)
				lineTo(center.x + half, center.y)
				lineTo(center.x, center.y + half)
				lineTo(center.x - half, center.y)
				close()
			}, fill)
		}
	}
}
