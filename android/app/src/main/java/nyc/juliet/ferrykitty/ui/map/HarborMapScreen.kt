package nyc.juliet.ferrykitty.ui.map

import android.icu.util.LocaleData
import android.icu.util.ULocale
import androidx.activity.compose.BackHandler
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.ZoomOutMap
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.first
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerrySheet
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.Boat
import nyc.juliet.ferrykitty.core.Bridge
import nyc.juliet.ferrykitty.core.Landing
import nyc.juliet.ferrykitty.core.MapRoute
import nyc.juliet.ferrykitty.core.Seamark
import nyc.juliet.ferrykitty.ui.FerryUi
import nyc.juliet.ferrykitty.ui.components.Notice
import nyc.juliet.ferrykitty.ui.components.SearchField
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.components.hexColor
import nyc.juliet.ferrykitty.ui.theme.FerryText
import nyc.juliet.ferrykitty.ui.theme.ferryColors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The harbor map: a native chart drawn from the bundled geometry with the served routes, landings and vessel
 * positions, plus the companion lists. It reads [state] and emits actions through [ui]; [camera] is hoisted by the
 * caller so the view survives rotation, tab and layout changes.
 */
@Composable
fun HarborMapScreen(state: FerryUiState, ui: FerryUi, camera: HarborCameraState, contentPadding: PaddingValues, modifier: Modifier = Modifier) {
	val colors = ferryColors
	val mapColors = remember(colors) { MapColors.of(colors) }
	val chart = rememberHarborChart()
	val geometry = chart.geometry
	val scope = rememberCoroutineScope()
	val density = LocalDensity.current

	val harbor = state.harbor
	val allBoats = state.boats?.boats.orEmpty()
	val boats = remember(allBoats, state.mapSearch, state.routeFilter) { VesselSearch.filter(allBoats, state.mapSearch, state.routeFilter) }
	val feedStale = state.boats?.stale != false
	val landings = harbor?.landings.orEmpty()
	val routes = harbor?.routes.orEmpty()
	val marine = state.preferences.showMarineReferences
	val bridges = remember(harbor?.chart?.bridges, geometry) { HarborFeatures.marine(harbor?.chart?.bridges, geometry?.bridges.orEmpty()) }
	val seamarks = remember(harbor?.chart?.seamarks, geometry) { HarborFeatures.marine(harbor?.chart?.seamarks, geometry?.seamarks.orEmpty()) }
	val seamarkStyles = geometry?.seamarkStyles.orEmpty()
	var calloutId by rememberSaveable { mutableStateOf<Int?>(null) }
	val callout = landings.firstOrNull { it.id == calloutId }
	val selectedBoat = allBoats.firstOrNull { it.id == state.selectedBoatId }
	val nextStop = remember(selectedBoat, landings) { HarborFeatures.nextStopLanding(selectedBoat, landings) }

	val routeShapes = remember(routes) { routeShapes(HarborFeatures.routeLines(routes)) }
	val landingMarks = remember(landings, state.preferences.landingId, nextStop, calloutId) {
		landings.mapNotNull { landing ->
			val point = HarborFeatures.landingPoint(landing) ?: return@mapNotNull null
			LandingMark(landing, point.x, point.y, MapLabels.isMajorLanding(landing.displayName), landing.id == state.preferences.landingId,
				landing.id == nextStop, landing.id == calloutId)
		}
	}
	val vesselMarks = remember(boats, feedStale, state.selectedBoatId, mapColors) {
		boats.mapNotNull { boat ->
			if (!boat.latitude.isFinite() || !boat.longitude.isFinite()) return@mapNotNull null
			val stale = VesselSearch.isStale(boat, feedStale)
			VesselMark(boat, HarborProjection.x(boat.longitude), HarborProjection.y(boat.latitude), Color(VesselSearch.markerColor(boat)),
				Color(VesselSearch.markerText(VesselSearch.markerFill(boat, stale, mapColors.waterArgb))), VesselSearch.hullLabel(boat.number), stale,
				boat.id == state.selectedBoatId)
		}
	}
	val bridgeMarks = remember(bridges, marine) {
		if (!marine) emptyList() else bridges.mapNotNull { bridge -> HarborFeatures.bridgeSegment(bridge)?.let { BridgeMark(bridge, it) } }
	}
	val seamarkMarks = remember(seamarks, seamarkStyles, marine) {
		if (!marine) emptyList() else seamarks.mapNotNull { seamark ->
			if (!seamark.latitude.isFinite() || !seamark.longitude.isFinite()) return@mapNotNull null
			val style = ChartGeometry.styleFor(seamark, seamarkStyles)
			SeamarkMark(seamark, HarborProjection.x(seamark.longitude), HarborProjection.y(seamark.latitude), style,
				MapLabels.seamarkLabel(seamark.name, style.kind))
		}
	}
	val scene = remember(chart, mapColors, routeShapes, state.routeFilter, landingMarks, vesselMarks, bridgeMarks, seamarkMarks) {
		MapScene(chart, mapColors, routeShapes, state.routeFilter, landingMarks, vesselMarks, bridgeMarks, seamarkMarks)
	}

	// The camera fits the served harbor (else the chart) with 24 dp padding; its center stays over the chart.
	val chartBounds = geometry?.bounds ?: ChartGeometry.DEFAULT_BOUNDS
	val harborRect = remember(harbor?.bounds, chartBounds) { MapCamera.harbor(harbor?.bounds, chartBounds) }
	val panRect = remember(harborRect, chartBounds) { chartBounds.union(harborRect) }
	val fitPadding = with(density) { MapCamera.FIT_PADDING_DP.dp.toPx() }
	SideEffect { camera.setHarbor(harborRect, panRect, fitPadding) }

	val openBoat: (Boat) -> Unit = { boat ->
		calloutId = null
		camera.focus(scope, HarborProjection.x(boat.longitude), HarborProjection.y(boat.latitude), boat.id)
		ui.send(FerryAction.OpenBoat(boat.id))
	}
	val showLanding: (Landing, Boolean) -> Unit = { landing, move ->
		calloutId = landing.id
		if (move) HarborFeatures.landingPoint(landing)?.let { camera.focus(scope, it.x, it.y) }
	}
	val openBridge: (Bridge) -> Unit = { bridge ->
		calloutId = null
		ui.send(FerryAction.OpenBridge(bridge))
	}
	val openSeamark: (Seamark) -> Unit = { seamark ->
		calloutId = null
		ui.send(FerryAction.OpenSeamark(seamark))
	}

	// Explicit requests are consumed once by the hoisted, saveable camera. A retained selection is not a new request.
	val latestBoats by rememberUpdatedState(allBoats)
	LaunchedEffect(state.boatFocusRequest, state.selectedBoatId, selectedBoat != null) {
		val request = state.boatFocusRequest ?: return@LaunchedEffect
		if (camera.consumedFocusRequest == request) return@LaunchedEffect
		val id = state.selectedBoatId ?: return@LaunchedEffect
		snapshotFlow { camera.ready }.first { it }
		val boat = latestBoats.firstOrNull { it.id == id } ?: return@LaunchedEffect
		camera.focus(scope, HarborProjection.x(boat.longitude), HarborProjection.y(boat.latitude), boat.id)
		camera.consumedFocusRequest = request
	}

	BackHandler(enabled = callout != null && state.sheet == null && !state.showingRide) { calloutId = null }

	val routeLabel = state.routeFilter?.let { id -> routes.firstOrNull { it.id == id }?.let { it.shortName ?: it.id } ?: id }
	val routeName = state.routeFilter?.let { id -> routes.firstOrNull { it.id == id }?.name ?: id }
	val summary = MapText.summary(boats.size, allBoats.size, !feedStale, landingMarks.size, routeName, marine, chart.status)
	val notes = buildList {
		MapText.notReporting(state.wantedVesselName, allBoats)?.let { add(it to Icons.Outlined.Info) }
		state.mapError?.let { add(it to Icons.Outlined.CloudOff) }
		if (chart == ChartLoad.Unavailable) add(MapText.CHART_UNAVAILABLE to Icons.Outlined.Map)
	}

	var panelTab by rememberSaveable { mutableStateOf(MapPanelTab.VESSELS) }
	var panelOpenTall by rememberSaveable { mutableStateOf(true) }
	var panelOpenShort by rememberSaveable { mutableStateOf(false) }

	BoxWithConstraints(modifier.fillMaxSize().background(colors.background)
		.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)).padding(contentPadding)) {
		// Decided from this screen's own content area, after the shell, system bars and padding.
		val sidePanel = MapLayout.sidePanelWidth(maxWidth.value, maxHeight.value, density.density)
		val short = maxHeight < 480.dp
		val header: @Composable () -> Unit = {
			MapHeader(state, ui, routes, compact = short, reporting = MapText.reporting(routeLabel, boats.size), feed = MapText.feed(state.boats),
				live = !feedStale, notes = notes)
		}
		val area: @Composable (Modifier) -> Unit = { areaModifier ->
			MapArea(scene, camera, summary, callout, state, ui, areaModifier,
				onTap = { offset -> handleTap(offset, scene, camera, density.density, openBoat, { showLanding(it, false) }, openSeamark, openBridge) { calloutId = null } },
				onBoat = openBoat, onLanding = { showLanding(it, false) },
				onCloseCallout = { calloutId = null })
		}
		val panel: @Composable (Modifier, Boolean, Dp?) -> Unit = { panelModifier, collapsible, listHeight ->
			val open = when {
				!collapsible -> true
				short -> panelOpenShort
				else -> panelOpenTall
			}
			MapPanel(
				state = state, ui = ui, boats = boats, totalBoats = allBoats.size, feedStale = feedStale, landings = landings, nextStop = nextStop,
				bridges = bridges, seamarks = seamarks, seamarkStyles = seamarkStyles, tab = panelTab, onTab = { panelTab = it }, open = open,
				onToggle = if (!collapsible) null else ({ if (short) panelOpenShort = !panelOpenShort else panelOpenTall = !panelOpenTall }),
				listHeight = listHeight, onBoat = openBoat, onLanding = { showLanding(it, true) }, onBridge = openBridge, onSeamark = openSeamark,
				modifier = panelModifier,
			)
		}
		if (sidePanel != null) {
			Row(Modifier.fillMaxSize()) {
				Column(Modifier.weight(1f).fillMaxHeight()) {
					header()
					area(Modifier.weight(1f).fillMaxWidth())
				}
				VerticalDivider(thickness = MapLayout.DIVIDER_DP.dp, color = colors.line)
				panel(Modifier.width(sidePanel.dp).fillMaxHeight(), false, null)
			}
		} else {
			val listHeight = (maxHeight * 0.32f).coerceIn(140.dp, 300.dp)
			Column(Modifier.fillMaxSize()) {
				header()
				area(Modifier.weight(1f).fillMaxWidth())
				HorizontalDivider(color = colors.line)
				panel(Modifier.fillMaxWidth(), true, listHeight)
			}
		}
	}
}

/** Taps select vessels, then landings, seamarks and bridges within 24 dp; a tap on open water closes the callout. */
private fun handleTap(
	offset: Offset,
	scene: MapScene,
	camera: HarborCameraState,
	density: Float,
	onBoat: (Boat) -> Unit,
	onLanding: (Landing) -> Unit,
	onSeamark: (Seamark) -> Unit,
	onBridge: (Bridge) -> Unit,
	onNothing: () -> Unit,
) {
	val position = camera.position ?: return
	val fit = camera.fit ?: return
	val width = camera.viewport.width
	val height = camera.viewport.height
	fun sx(x: Float) = (x - position.centerX) * position.zoom + width / 2f
	fun sy(y: Float) = (y - position.centerY) * position.zoom + height / 2f
	val close = MapCamera.isClose(position.zoom, fit)
	val vessels = FloatArray(scene.vessels.size * 2).also { points ->
		scene.vessels.forEachIndexed { index, mark -> points[index * 2] = sx(mark.x); points[index * 2 + 1] = sy(mark.y) }
	}
	val landings = FloatArray(scene.landings.size * 2).also { points ->
		scene.landings.forEachIndexed { index, mark -> points[index * 2] = sx(mark.x); points[index * 2 + 1] = sy(mark.y) }
	}
	val seamarks = FloatArray(scene.seamarks.size * 2).also { points ->
		scene.seamarks.forEachIndexed { index, mark ->
			// Buoys are only drawn, and so only tappable, at close zoom.
			val shown = close || mark.style.shape == SeamarkShape.LIGHT
			points[index * 2] = if (shown) sx(mark.x) else Float.NaN
			points[index * 2 + 1] = if (shown) sy(mark.y) else Float.NaN
		}
	}
	val bridges = FloatArray(scene.bridges.size * 4).also { points ->
		scene.bridges.forEachIndexed { index, mark ->
			points[index * 4] = sx(mark.segment[0])
			points[index * 4 + 1] = sy(mark.segment[1])
			points[index * 4 + 2] = sx(mark.segment[2])
			points[index * 4 + 3] = sy(mark.segment[3])
		}
	}
	val hit = MapHitTest.pick(offset.x, offset.y, MapHitTest.RADIUS_DP * density, vessels, landings, seamarks, bridges)
	when (hit?.layer) {
		MapLayer.VESSEL -> onBoat(scene.vessels[hit.index].boat)
		MapLayer.LANDING -> onLanding(scene.landings[hit.index].landing)
		MapLayer.SEAMARK -> onSeamark(scene.seamarks[hit.index].seamark)
		MapLayer.BRIDGE -> onBridge(scene.bridges[hit.index].bridge)
		null -> onNothing()
	}
}

@Composable
private fun MapHeader(state: FerryUiState, ui: FerryUi, routes: List<MapRoute>, compact: Boolean, reporting: String, feed: String, live: Boolean,
	notes: List<Pair<String, ImageVector>>) {
	val colors = ferryColors
	Column(Modifier.fillMaxWidth().background(colors.card)) {
		val search: @Composable (Modifier) -> Unit = { searchModifier ->
			SearchField(
				value = state.mapSearch,
				onValueChange = { ui.send(FerryAction.SetMapSearch(it)) },
				placeholder = "Vessel, hull number, or destination",
				tag = "vesselSearch",
				modifier = searchModifier,
			)
		}
		Row(
			verticalAlignment = Alignment.CenterVertically,
			modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = if (compact) 8.dp else 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
		) {
			if (compact) {
				search(Modifier.weight(1f))
			} else {
				Text("Harbor map", style = MaterialTheme.typography.titleLarge, color = colors.heading, maxLines = 1, overflow = TextOverflow.Ellipsis,
					modifier = Modifier.weight(1f).semantics { heading() })
			}
			RouteFilterMenu(state, ui, routes)
			IconButton(onClick = { ui.open(FerrySheet.SETTINGS) }, modifier = Modifier.testTag("mapSettings")) {
				Icon(Icons.Filled.Settings, contentDescription = "Settings")
			}
		}
		if (!compact) search(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp))
		Row(
			verticalAlignment = Alignment.CenterVertically,
			horizontalArrangement = Arrangement.spacedBy(8.dp),
			modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 6.dp),
		) {
			Text(reporting, style = FerryText.captionStrong, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
			Box(Modifier.size(8.dp).background(if (live) colors.positive else colors.muted, CircleShape))
			Text(feed, style = FerryText.caption, color = if (live) colors.positive else colors.muted, maxLines = 1)
		}
		for ((note, icon) in notes) Notice(note, icon, Modifier.padding(bottom = 4.dp), color = if (icon == Icons.Outlined.CloudOff) colors.warning else Color.Unspecified)
		HorizontalDivider(color = colors.line)
	}
}

/** Route filter menu with the Marine references switch, as on iOS. */
@Composable
private fun RouteFilterMenu(state: FerryUiState, ui: FerryUi, routes: List<MapRoute>) {
	val colors = ferryColors
	var open by remember { mutableStateOf(false) }
	val active = state.routeFilter != null
	val current = state.routeFilter?.let { id -> routes.firstOrNull { it.id == id }?.name ?: id } ?: "All routes"
	Box {
		IconButton(
			onClick = { open = true },
			modifier = Modifier.testTag("mapFilters").semantics { stateDescription = current }.then(
				if (active) Modifier.background(colors.accent.copy(alpha = 0.14f), CircleShape) else Modifier,
			),
		) {
			Icon(Icons.Filled.FilterList, contentDescription = "Map filters", tint = if (active) colors.accent else colors.ink)
		}
		DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
			DropdownMenuItem(
				text = { Text("All routes") },
				leadingIcon = { SelectionMark(!active) },
				onClick = {
					open = false
					ui.send(FerryAction.SetRouteFilter(null))
				},
				modifier = Modifier.testTag("mapRoute-all"),
			)
			for (route in routes) {
				DropdownMenuItem(
					text = { Text(route.shortName?.takeIf { it != route.name }?.let { "${route.name} ($it)" } ?: route.name, maxLines = 2) },
					leadingIcon = { SelectionMark(state.routeFilter == route.id) },
					trailingIcon = { Box(Modifier.size(12.dp).background(hexColor(route.color, VesselSearch.NEUTRAL_MARKER), CircleShape)) },
					onClick = {
						open = false
						ui.send(FerryAction.SetRouteFilter(route.id))
					},
					modifier = Modifier.testTag("mapRoute-${route.id}"),
				)
			}
			HorizontalDivider(color = colors.line)
			val marine = state.preferences.showMarineReferences
			DropdownMenuItem(
				text = { Text("Marine references") },
				trailingIcon = { Switch(checked = marine, onCheckedChange = null) },
				onClick = { ui.update(state.preferences.copy(showMarineReferences = !marine)) },
				modifier = Modifier.testTag("mapMarineReferences").semantics {
					role = Role.Switch
					stateDescription = if (marine) "On" else "Off"
				},
			)
		}
	}
}

@Composable
private fun SelectionMark(selected: Boolean) {
	if (selected) Icon(Icons.Filled.Check, contentDescription = "Selected") else Spacer(Modifier.size(24.dp))
}

@Composable
private fun MapArea(
	scene: MapScene,
	camera: HarborCameraState,
	summary: String,
	callout: Landing?,
	state: FerryUiState,
	ui: FerryUi,
	modifier: Modifier,
	onTap: (Offset) -> Unit,
	onBoat: (Boat) -> Unit,
	onLanding: (Landing) -> Unit,
	onCloseCallout: () -> Unit,
) {
	val scope = rememberCoroutineScope()
	val overlays = remember { MapOverlays() }
	BoxWithConstraints(modifier.clipToBounds().background(scene.colors.water)) {
		val areaWidth = maxWidth
		HarborCanvas(scene, camera, summary, overlays, onTap, onBoat, onLanding, Modifier.fillMaxSize())
		// Controls stay clear of the map's vertical center, where a horizontal swipe starts.
		val vertical = maxHeight >= 360.dp
		val buttons: @Composable () -> Unit = {
			MapButton(Icons.Filled.Add, "Zoom in", "mapZoomIn") { camera.zoomBy(scope, MapCamera.ZOOM_STEP) }
			MapButton(Icons.Filled.Remove, "Zoom out", "mapZoomOut") { camera.zoomBy(scope, 1f / MapCamera.ZOOM_STEP) }
			MapButton(Icons.Filled.ZoomOutMap, "Fit harbor", "mapFitHarbor") { camera.fitHarbor(scope) }
		}
		val controls = Modifier.align(Alignment.TopEnd).padding(8.dp).coversMap(overlays, "zoom")
		if (vertical) Column(controls, verticalArrangement = Arrangement.spacedBy(6.dp)) { buttons() }
		else Row(controls, horizontalArrangement = Arrangement.spacedBy(6.dp)) { buttons() }
		MapFooter(camera, scene.colors, overlays, wide = maxWidth >= 480.dp, onAttribution = { ui.send(FerryAction.OpenUrl(ChartGeometry.ATTRIBUTION_URL)) },
			modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth())
		if (callout != null) {
			val point = HarborFeatures.landingPoint(callout)
			if (point != null) {
				LandingCallout(
					landing = callout,
					favorite = callout.id in state.preferences.favorites,
					board = callout.id == state.preferences.landingId,
					onFavorite = { ui.send(FerryAction.ToggleFavorite(callout.id)) },
					onDepartures = { ui.selectLanding(callout.id, closeSheet = false) },
					onClose = onCloseCallout,
					modifier = Modifier.anchoredTo(camera, point.x, point.y, gap = 14.dp, margin = 8.dp).widthIn(max = minOf(320.dp, areaWidth - 16.dp)),
				)
			}
		}
	}
}

/**
 * The chart canvas. Camera reads happen only while drawing and placing, so gestures and easing never recompose it.
 * Invisible nodes over every vessel and landing give TalkBack and tests a target for each marker. Labels keep clear of
 * the controls registered in [overlays].
 */
@Composable
private fun HarborCanvas(
	scene: MapScene,
	camera: HarborCameraState,
	summary: String,
	overlays: MapOverlays,
	onTap: (Offset) -> Unit,
	onBoat: (Boat) -> Unit,
	onLanding: (Landing) -> Unit,
	modifier: Modifier,
) {
	val density = LocalDensity.current
	val measurer = rememberTextMeasurer(cacheSize = 0)
	val text = remember(measurer, density) { MapTextCache(measurer, density.fontScale) }
	val painter = remember { MapPainter() }
	val scope = rememberCoroutineScope()
	val decay = rememberSplineBasedDecay<Offset>()
	val currentTap by rememberUpdatedState(onTap)
	Box(
		modifier
			.onSizeChanged { camera.setViewport(ViewportSize(it.width.toFloat(), it.height.toFloat())) }
			.onGloballyPositioned { overlays.chartPlaced(it) }
			.testTag("harborMap")
			.semantics {
				contentDescription = summary
				this[MapOverlaysKey] = overlays
			}
			.pointerInput(camera) {
				detectHarborGestures(
					onDown = { camera.stop() },
					onTransform = { centroid, pan, zoom -> camera.transform(centroid, pan, zoom) },
					onFling = { velocity -> camera.fling(scope, velocity, decay) },
					onTap = { currentTap(it) },
					onDoubleTap = { camera.zoomBy(scope, MapCamera.ZOOM_STEP, it) },
				)
			}
			.pointerInput(camera) {
				detectScrollZoom { focus, factor ->
					camera.stop()
					camera.transform(focus, Offset.Zero, factor)
				}
			}
			.drawBehind {
				val position = camera.position ?: run {
					drawRect(scene.colors.water)
					return@drawBehind
				}
				drawHarbor(scene, position, camera.fit?.zoom ?: position.zoom, text, painter, overlays.areas)
			},
	) {
		for (mark in scene.vessels) key("vessel-${mark.boat.id}") {
			MarkerNode(camera, mark.x, mark.y, "mapBoatMarker-${mark.boat.id}", VesselSearch.spokenMarker(mark.boat, mark.stale), mark.selected,
				actionLabel = "Show vessel details") { onBoat(mark.boat) }
		}
		for (mark in scene.landings) key("landing-${mark.landing.id}") {
			MarkerNode(camera, mark.x, mark.y, "mapLandingMarker-${mark.landing.id}", "${mark.landing.displayName}, ${MapText.landingNumber(mark.landing.id)}",
				mark.chosen, actionLabel = "Show landing") { onLanding(mark.landing) }
		}
	}
}

@Composable
private fun MarkerNode(camera: HarborCameraState, x: Float, y: Float, tag: String, description: String, selected: Boolean, actionLabel: String,
	onClick: () -> Unit) {
	val side = TouchTarget
	Box(
		Modifier
			.offset {
				val position = camera.position
				val half = side.roundToPx() / 2
				if (position == null) IntOffset(-100_000, -100_000)
				else IntOffset(
					((x - position.centerX) * position.zoom + camera.viewport.width / 2f).roundToInt() - half,
					((y - position.centerY) * position.zoom + camera.viewport.height / 2f).roundToInt() - half,
				)
			}
			.size(side)
			.testTag(tag)
			.semantics {
				contentDescription = description
				role = Role.Button
				this.selected = selected
				onClick(label = actionLabel) {
					onClick()
					true
				}
			},
	)
}

@Composable
private fun MapButton(icon: ImageVector, label: String, tag: String, onClick: () -> Unit) {
	val colors = ferryColors
	Surface(
		onClick = onClick,
		shape = RoundedCornerShape(12.dp),
		color = colors.card,
		contentColor = colors.heading,
		border = BorderStroke(1.dp, colors.line),
		shadowElevation = 2.dp,
		modifier = Modifier.size(TouchTarget).testTag(tag).semantics { contentDescription = label },
	) {
		Box(contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null) }
	}
}

/** The scale bar and the chart attribution, which opens the OpenStreetMap copyright page. Labels keep clear of both. */
@Composable
private fun MapFooter(camera: HarborCameraState, colors: MapColors, overlays: MapOverlays, wide: Boolean, onAttribution: () -> Unit, modifier: Modifier) {
	val ink = ferryColors.ink
	val imperial = remember { LocaleData.getMeasurementSystem(ULocale.getDefault()) == LocaleData.MeasurementSystem.US }
	val attribution: @Composable (Modifier) -> Unit = { attributionModifier ->
		Text(
			ChartGeometry.ATTRIBUTION,
			style = TextStyle(fontSize = 10.sp, lineHeight = 13.sp),
			color = ink,
			textAlign = TextAlign.End,
			maxLines = 2,
			modifier = attributionModifier
				.coversMap(overlays, "attribution")
				.testTag("mapAttribution")
				.clickable(onClickLabel = "Open the OpenStreetMap copyright page", role = Role.Button, onClick = onAttribution)
				.heightIn(min = 32.dp)
				.background(colors.water.copy(alpha = 0.82f), RoundedCornerShape(6.dp))
				.padding(horizontal = 6.dp, vertical = 8.dp),
		)
	}
	if (wide) {
		Row(modifier.padding(start = 10.dp, end = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.Bottom) {
			MapScaleBar(camera, colors, imperial, Modifier.padding(bottom = 8.dp).coversMap(overlays, "scale"))
			Spacer(Modifier.weight(1f))
			attribution(Modifier.padding(start = 8.dp))
		}
	} else {
		Column(modifier.padding(start = 10.dp, end = 6.dp, bottom = 4.dp)) {
			MapScaleBar(camera, colors, imperial, Modifier.padding(bottom = 2.dp).coversMap(overlays, "scale"))
			attribution(Modifier.align(Alignment.End))
		}
	}
}

/** Redrawn from the camera on every frame without recomposing; decorative, so hidden from TalkBack. */
@Composable
private fun MapScaleBar(camera: HarborCameraState, colors: MapColors, imperial: Boolean, modifier: Modifier) {
	val measurer = rememberTextMeasurer()
	val style = remember { TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold) }
	val density = LocalDensity.current
	// Tall enough for its label at any text size, so the space it holds on the chart covers everything it draws.
	val labelHeight = remember(measurer, density) { with(density) { measurer.measure("0", style).size.height.toDp() } }
	Spacer(
		modifier
			.size(width = 112.dp, height = max(24.dp, labelHeight + 11.dp))
			.clearAndSetSemantics { }
			.drawBehind {
				val position = camera.position ?: return@drawBehind
				val spec = ScaleBar.of(ScaleBar.metresPerPixel(position), maxLengthPx = 96.dp.toPx(), imperial) ?: return@drawBehind
				val y = size.height - 3.dp.toPx()
				val tick = 5.dp.toPx()
				val halo = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round)
				val line = 1.5.dp.toPx()
				for ((color, width) in listOf(colors.card to halo.width, colors.ink to line)) {
					drawLine(color, Offset(0f, y), Offset(spec.lengthPx, y), strokeWidth = width, cap = StrokeCap.Round)
					drawLine(color, Offset(0f, y), Offset(0f, y - tick), strokeWidth = width, cap = StrokeCap.Round)
					drawLine(color, Offset(spec.lengthPx, y), Offset(spec.lengthPx, y - tick), strokeWidth = width, cap = StrokeCap.Round)
				}
				val label = measurer.measure(spec.label, style)
				val topLeft = Offset(3.dp.toPx(), y - tick - label.size.height)
				drawText(label, color = colors.card, topLeft = topLeft, drawStyle = Stroke(width = 3.dp.toPx()))
				drawText(label, color = colors.ink, topLeft = topLeft, drawStyle = Fill)
			},
	)
}

/** Places a callout above its landing (below when there is no room), following the camera without recomposing. */
private fun Modifier.anchoredTo(camera: HarborCameraState, x: Float, y: Float, gap: Dp, margin: Dp): Modifier = layout { measurable, constraints ->
	val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
	val width = if (constraints.hasBoundedWidth) constraints.maxWidth else placeable.width
	val height = if (constraints.hasBoundedHeight) constraints.maxHeight else placeable.height
	layout(width, height) {
		val position = camera.position
		val viewport = camera.viewport
		val inset = margin.roundToPx()
		val space = gap.roundToPx()
		val sx = position?.let { (x - it.centerX) * it.zoom + viewport.width / 2f } ?: (width / 2f)
		val sy = position?.let { (y - it.centerY) * it.zoom + viewport.height / 2f } ?: (height / 2f)
		val left = (sx - placeable.width / 2f).roundToInt().coerceIn(inset, max(inset, width - placeable.width - inset))
		val above = (sy - space - placeable.height).roundToInt()
		val top = (if (above >= inset) above else (sy + space).roundToInt()).coerceIn(inset, max(inset, height - placeable.height - inset))
		placeable.place(left, top)
	}
}

@Composable
private fun LandingCallout(
	landing: Landing,
	favorite: Boolean,
	board: Boolean,
	onFavorite: () -> Unit,
	onDepartures: () -> Unit,
	onClose: () -> Unit,
	modifier: Modifier,
) {
	val colors = ferryColors
	Surface(
		shape = RoundedCornerShape(14.dp),
		color = colors.card,
		contentColor = colors.ink,
		border = BorderStroke(1.dp, colors.line),
		shadowElevation = 6.dp,
		modifier = modifier.testTag("mapLandingCallout"),
	) {
		Column(Modifier.padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 12.dp)) {
			Row(verticalAlignment = Alignment.CenterVertically) {
				Column(Modifier.weight(1f).padding(top = 8.dp)) {
					Text(landing.displayName, style = MaterialTheme.typography.titleSmall, color = colors.heading, modifier = Modifier.semantics { heading() })
					Text(listOfNotNull(MapText.landingNumber(landing.id), "Your board".takeIf { board }).joinToString(" · "),
						style = FerryText.caption, color = colors.muted)
				}
				IconToggleButton(
					checked = favorite,
					onCheckedChange = { onFavorite() },
					modifier = Modifier.testTag("mapLandingFavorite"),
				) {
					Icon(if (favorite) Icons.Filled.Star else Icons.Filled.StarBorder, tint = if (favorite) colors.warning else colors.muted,
						contentDescription = if (favorite) "Remove ${landing.displayName} from favorites" else "Add ${landing.displayName} to favorites")
				}
				IconButton(onClick = onClose, modifier = Modifier.testTag("mapLandingClose")) {
					Icon(Icons.Filled.Close, contentDescription = "Close", tint = colors.muted)
				}
			}
			Button(
				onClick = onDepartures,
				colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.onAccent),
				modifier = Modifier.padding(top = 6.dp, end = 10.dp).fillMaxWidth().heightIn(min = TouchTarget).testTag("mapLandingDepartures"),
			) {
				Text("Departures")
			}
		}
	}
}
