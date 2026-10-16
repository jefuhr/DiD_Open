package nyc.juliet.ferrykitty.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import nyc.juliet.ferrykitty.core.Landing
import nyc.juliet.ferrykitty.core.RidePosition
import nyc.juliet.ferrykitty.ui.theme.ferryColors

/**
 * The ride dashboard's map of the boat: the harbor chart around [position] (about 0.02° of latitude) with one marker,
 * accent while live and muted with "Last reported" when [stale]. A fixed camera, no gestures.
 */
@Composable
fun RideMiniMap(position: RidePosition, stale: Boolean, modifier: Modifier = Modifier) {
	RideMiniMap(position, stale, emptyList(), modifier)
}

/** The ride mini map with the served landings marked, for callers that have the harbor (`state.harbor?.landings`). */
@Composable
fun RideMiniMap(position: RidePosition, stale: Boolean, landings: List<Landing>, modifier: Modifier = Modifier) {
	val colors = ferryColors
	val mapColors = remember(colors) { MapColors.of(colors) }
	val chart = rememberHarborChart()
	val density = LocalDensity.current
	val measurer = rememberTextMeasurer(cacheSize = 0)
	val text = remember(measurer, density) { MapTextCache(measurer, density.fontScale) }
	val painter = remember { MapPainter() }
	val valid = position.latitude.isFinite() && position.longitude.isFinite() && position.latitude in -85.0..85.0 && position.longitude in -180.0..180.0
	val scene = remember(chart, mapColors, landings, position.latitude, position.longitude, stale, valid) {
		val marks = landings.mapNotNull { landing ->
			val point = HarborFeatures.landingPoint(landing) ?: return@mapNotNull null
			LandingMark(landing, point.x, point.y, major = MapLabels.isMajorLanding(landing.displayName), board = false, target = false, chosen = false)
		}
		MapScene(chart, mapColors, landings = marks,
			position = if (valid) PositionMark(HarborProjection.x(position.longitude), HarborProjection.y(position.latitude), stale) else null)
	}
	val description = if (stale) "Last reported vessel position" else "Current vessel position"
	Box(
		modifier
			.clipToBounds()
			.background(mapColors.water)
			.semantics { contentDescription = description }
			.drawBehind {
				val viewport = ViewportSize(size.width, size.height)
				if (viewport.isEmpty || !valid) return@drawBehind
				val camera = MapCamera.miniMap(position.latitude, position.longitude, viewport)
				val fit = CameraPosition.fit(ChartGeometry.DEFAULT_BOUNDS, viewport, MapCamera.FIT_PADDING_DP.dp.toPx())
				drawHarbor(scene, camera, fit.zoom, text, painter)
			},
	)
}
