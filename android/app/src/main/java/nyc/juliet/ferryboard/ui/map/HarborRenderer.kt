package nyc.juliet.ferryboard.ui.map

import androidx.compose.runtime.Immutable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import nyc.juliet.ferryboard.core.Boat
import nyc.juliet.ferryboard.core.Bridge
import nyc.juliet.ferryboard.core.Landing
import nyc.juliet.ferryboard.core.Seamark
import nyc.juliet.ferryboard.ui.theme.ColorMath
import nyc.juliet.ferryboard.ui.theme.FerryColors
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** The chart's colors for one theme: the web map's palette (`MapPalette`) plus the board's ink, card and status colors. */
@Immutable
internal class MapColors(
	val water: Color,
	val waterArgb: Long,
	val land: Color,
	val landStroke: Color,
	val street: Color,
	val streetCasing: Color,
	val priorityStreet: Color,
	val park: Color,
	val channel: Color,
	val bridge: Color,
	val bridgeCasing: Color,
	val bridgeLabel: Color,
	val buoyGreen: Color,
	val buoyRed: Color,
	val light: Color,
	val routeCasing: Color,
	val placeWater: Color,
	val ink: Color,
	val muted: Color,
	val card: Color,
	val accent: Color,
	val warning: Color,
	val vesselRim: Color,
) {
	companion object {
		fun of(colors: FerryColors): MapColors {
			val map = colors.theme.map
			val palette = colors.theme.palette
			return MapColors(
				water = Color(map.water),
				waterArgb = map.water,
				land = Color(map.land),
				landStroke = Color(map.landStroke),
				street = Color(map.street),
				streetCasing = Color(map.streetCasing),
				priorityStreet = Color(ColorMath.blend(palette.muted, map.land, 0.45)),
				park = colors.muted,
				channel = Color(map.channel),
				bridge = Color(map.bridge),
				bridgeCasing = Color(map.bridgeCasing),
				bridgeLabel = Color(map.bridgeLabel),
				buoyGreen = Color(map.buoyGreen),
				buoyRed = Color(map.buoyRed),
				light = Color(map.light),
				routeCasing = if (colors.dark) Color(ColorMath.blend(map.water, palette.muted, 0.6)) else Color(map.water),
				placeWater = Color(ColorMath.blend(palette.muted, map.water, 0.75)),
				ink = colors.ink,
				muted = colors.muted,
				card = colors.card,
				accent = colors.accent,
				warning = colors.warning,
				vesselRim = if (colors.dark) colors.ink else colors.card,
			)
		}
	}
}

internal class RouteShape(val routeId: String, val color: Color, val path: Path, val bounds: UnitRect)

internal class LandingMark(
	val landing: Landing,
	val x: Float,
	val y: Float,
	val major: Boolean,
	/** The departures board's landing: an accent ring. */
	val board: Boolean,
	/** The selected vessel's next stop: amber. */
	val target: Boolean,
	/** The landing whose callout is open. */
	val chosen: Boolean,
)

internal class VesselMark(
	val boat: Boat,
	val x: Float,
	val y: Float,
	val color: Color,
	val text: Color,
	val hull: String,
	val stale: Boolean,
	val selected: Boolean,
)

internal class BridgeMark(val bridge: Bridge, val segment: FloatArray)

internal class SeamarkMark(val seamark: Seamark, val x: Float, val y: Float, val style: SeamarkStyle, val label: String)

internal class PositionMark(val x: Float, val y: Float, val stale: Boolean)

/** Everything the chart draws besides the camera; rebuilt when data or theme change, never per frame. */
@Immutable
internal class MapScene(
	val chart: ChartLoad,
	val colors: MapColors,
	val routes: List<RouteShape> = emptyList(),
	val routeFilter: String? = null,
	val landings: List<LandingMark> = emptyList(),
	val vessels: List<VesselMark> = emptyList(),
	/** Empty while Marine references is off. */
	val bridges: List<BridgeMark> = emptyList(),
	val seamarks: List<SeamarkMark> = emptyList(),
	val position: PositionMark? = null,
)

internal fun routeShapes(lines: List<RouteLine>): List<RouteShape> = lines.map { line ->
	RouteShape(line.routeId, Color(line.color), Path().apply { addPolyline(line.points, close = false) }, line.bounds)
}

internal enum class LabelStyle { BOROUGH, WATER, PARK, ISLAND, STREET, PRIORITY_STREET, LANDING, MARINE, VESSEL, POSITION }

private fun LabelStyle.textStyle(): TextStyle = when (this) {
	LabelStyle.BOROUGH -> TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Black, letterSpacing = 0.13.em)
	LabelStyle.WATER -> TextStyle(fontSize = 12.sp, fontStyle = FontStyle.Italic, letterSpacing = 0.06.em)
	LabelStyle.PARK -> TextStyle(fontSize = 11.sp, fontStyle = FontStyle.Italic, letterSpacing = 0.04.em)
	LabelStyle.ISLAND -> TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Black, letterSpacing = 0.02.em)
	LabelStyle.STREET -> TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold)
	LabelStyle.PRIORITY_STREET -> TextStyle(fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
	LabelStyle.LANDING -> TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold)
	LabelStyle.MARINE -> TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold)
	LabelStyle.VESSEL -> TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Black)
	LabelStyle.POSITION -> TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold)
}

/** Measured labels, kept per style so each name is measured once per density and font scale. */
internal class MapTextCache(private val measurer: TextMeasurer, private val fontScale: Float) {
	private val layouts = Array(LabelStyle.entries.size) { HashMap<String, TextLayoutResult>() }
	private val styles = LabelStyle.entries.map { it.textStyle() }
	private val hulls = HashMap<String, TextLayoutResult>()

	fun layout(style: LabelStyle, text: String): TextLayoutResult =
		layouts[style.ordinal].getOrPut(text) { measurer.measure(text, styles[style.ordinal], maxLines = 1, softWrap = false) }

	/** The measured width when known, else an estimate, so off-screen candidates are not measured. */
	fun width(style: LabelStyle, text: String, fontPx: Float): Float =
		layouts[style.ordinal][text]?.size?.width?.toFloat() ?: MapLabels.estimateWidth(text, fontPx)

	/** Hull labels belong to the 32 dp marker graphic: sized in dp, shrunk until they fit inside the circle. */
	fun hull(text: String, maxWidthPx: Float): TextLayoutResult = hulls.getOrPut(text) {
		var size = 11f
		var result = measureHull(text, size)
		while (result.size.width > maxWidthPx && size > 7f) {
			size -= 1f
			result = measureHull(text, size)
		}
		result
	}

	private fun measureHull(text: String, sizeDp: Float) = measurer.measure(text,
		TextStyle(fontSize = (sizeDp / fontScale).sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace), maxLines = 1, softWrap = false)
}

/** Reusable per-canvas drawing state: the label placer and scratch storage for placed street labels. */
internal class MapPainter {
	val placer = LabelPlacer()
	val shape = Path()
	var streets = IntArray(64)
	var streetCount = 0
	var marine = IntArray(32)
	var marineCount = 0
	var landings = IntArray(32)
	var landingLeft = BooleanArray(32)
	var landingCount = 0
	val places = BooleanArray(ChartGeometry.PLACES.size)

	fun addStreet(index: Int) {
		if (streetCount == streets.size) streets = streets.copyOf(streets.size * 2)
		streets[streetCount++] = index
	}

	fun addMarine(index: Int) {
		if (marineCount == marine.size) marine = marine.copyOf(marine.size * 2)
		marine[marineCount++] = index
	}

	fun addLanding(index: Int, left: Boolean) {
		if (landingCount == landings.size) {
			landings = landings.copyOf(landings.size * 2)
			landingLeft = landingLeft.copyOf(landingLeft.size * 2)
		}
		landingLeft[landingCount] = left
		landings[landingCount++] = index
	}
}

/**
 * Draws the harbor: water, land with a hairline shore, parks, dashed channels, streets, route lines, bridges and
 * seamarks, then collision-free labels, landings and vessels on top. [fitZoom] is the zoom that fits the harbor, which
 * decides close-zoom detail.
 */
internal fun DrawScope.drawHarbor(scene: MapScene, camera: CameraPosition, fitZoom: Float, text: MapTextCache, painter: MapPainter) {
	val colors = scene.colors
	drawRect(colors.water)
	if (size.width <= 0f || size.height <= 0f) return
	val zoom = camera.zoom
	val ratio = if (fitZoom > 0f) zoom / fitZoom else 1f
	val close = ratio >= MapCamera.CLOSE_OF_FIT
	val detail = ((ratio - 1f) / (MapCamera.CLOSE_OF_FIT - 1f)).coerceIn(0f, 1f)
	val unit = 1f / zoom
	val margin = 12.dp.toPx() * unit
	val halfWidth = size.width / 2f * unit
	val halfHeight = size.height / 2f * unit
	val visible = UnitRect(camera.centerX - halfWidth - margin, camera.centerY - halfHeight - margin, camera.centerX + halfWidth + margin,
		camera.centerY + halfHeight + margin)
	val chart = (scene.chart as? ChartLoad.Ready)?.paths

	withTransform({
		translate(size.width / 2f, size.height / 2f)
		scale(zoom, zoom, Offset.Zero)
		translate(-camera.centerX, -camera.centerY)
	}) {
		if (chart != null) drawChart(chart, colors, visible, unit, detail)
		drawRoutes(scene, visible, unit)
		drawBridges(scene, visible, unit)
	}

	val screen = Screen(camera, size.width, size.height)
	placeLabels(scene, screen, close, text, painter)
	drawSeamarks(scene, screen, close, painter)
	if (chart != null) drawStreetLabels(scene, screen, text, painter)
	if (scene.chart is ChartLoad.Ready) drawPlaces(colors, screen, text, painter)
	drawMarineLabels(scene, screen, text, painter)
	drawLandings(scene, screen, text, painter)
	drawVessels(scene, screen, text)
	scene.position?.let { drawPosition(it, colors, screen, text) }
}

/** Unit to screen conversion without allocating per point. */
private class Screen(val camera: CameraPosition, val width: Float, val height: Float) {
	fun x(unitX: Float): Float = (unitX - camera.centerX) * camera.zoom + width / 2f
	fun y(unitY: Float): Float = (unitY - camera.centerY) * camera.zoom + height / 2f
	fun inside(x: Float, y: Float, slack: Float): Boolean = x >= -slack && y >= -slack && x <= width + slack && y <= height + slack
}

private fun DrawScope.drawChart(paths: ChartPaths, colors: MapColors, visible: UnitRect, unit: Float, detail: Float) {
	val shore = Stroke(width = 1.dp.toPx() * unit, join = StrokeJoin.Round)
	for (land in paths.land) {
		if (!land.bounds.intersects(visible)) continue
		drawPath(land.path, colors.land)
		drawPath(land.path, colors.landStroke, style = shore)
	}
	val park = Stroke(width = 1.8.dp.toPx() * unit, join = StrokeJoin.Round)
	for (outline in paths.parks) if (outline.bounds.intersects(visible)) drawPath(outline.path, colors.park, alpha = 0.6f, style = park)
	val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx() * unit, 4.dp.toPx() * unit))
	val channel = Stroke(width = 1.2.dp.toPx() * unit, pathEffect = dash)
	for (fairway in paths.channels) if (fairway.bounds.intersects(visible)) drawPath(fairway.path, colors.channel, style = channel)

	// Streets thin out at the overview and reach the web map's widths at close zoom.
	val casingWidth = (1.6f + 1.4f * detail).dp.toPx() * unit
	val lineWidth = (0.7f + 0.6f * detail).dp.toPx() * unit
	val casing = Stroke(width = casingWidth, cap = StrokeCap.Round, join = StrokeJoin.Round)
	val highwayCasing = Stroke(width = casingWidth + 1.dp.toPx() * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
	val line = Stroke(width = lineWidth, cap = StrokeCap.Round, join = StrokeJoin.Round)
	val priorityLine = Stroke(width = lineWidth + 0.2.dp.toPx() * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
	val highwayLine = Stroke(width = lineWidth + 0.8.dp.toPx() * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
	for (street in paths.streets) {
		if (street.street.bounds.intersects(visible)) drawPath(street.path, colors.streetCasing, style = if (street.street.highway) highwayCasing else casing)
	}
	for (street in paths.streets) {
		val feature = street.street
		if (!feature.bounds.intersects(visible)) continue
		when {
			feature.highway -> drawPath(street.path, colors.priorityStreet, style = highwayLine)
			feature.priority -> drawPath(street.path, colors.priorityStreet, style = priorityLine)
			else -> drawPath(street.path, colors.street, style = line)
		}
	}
}

/** Translucent until a route is chosen; the chosen route then stands alone. */
private fun DrawScope.drawRoutes(scene: MapScene, visible: UnitRect, unit: Float) {
	if (scene.routes.isEmpty()) return
	val filter = scene.routeFilter
	val casing = Stroke(width = 6.dp.toPx() * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
	val line = Stroke(width = 2.8.dp.toPx() * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
	for (route in scene.routes) {
		if ((filter == null || route.routeId == filter) && route.bounds.intersects(visible)) {
			drawPath(route.path, scene.colors.routeCasing, alpha = 0.8f, style = casing)
		}
	}
	val alpha = if (filter == null) 0.45f else 0.9f
	for (route in scene.routes) {
		if ((filter == null || route.routeId == filter) && route.bounds.intersects(visible)) drawPath(route.path, route.color, alpha = alpha, style = line)
	}
}

private fun DrawScope.drawBridges(scene: MapScene, visible: UnitRect, unit: Float) {
	val casing = 4.dp.toPx() * unit
	val deck = 2.dp.toPx() * unit
	for (mark in scene.bridges) {
		val s = mark.segment
		val bounds = UnitRect(minOf(s[0], s[2]), minOf(s[1], s[3]), maxOf(s[0], s[2]), maxOf(s[1], s[3]))
		if (!bounds.intersects(visible)) continue
		drawLine(scene.colors.bridgeCasing, Offset(s[0], s[1]), Offset(s[2], s[3]), strokeWidth = casing, cap = StrokeCap.Round)
		drawLine(scene.colors.bridge, Offset(s[0], s[1]), Offset(s[2], s[3]), strokeWidth = deck, cap = StrokeCap.Round, alpha = 0.65f)
	}
}

/** Decides every label before drawing: vessels, landings and places claim space first, then marine and street names. */
private fun DrawScope.placeLabels(scene: MapScene, screen: Screen, close: Boolean, text: MapTextCache, painter: MapPainter) {
	val placer = painter.placer
	placer.reset(screen.width, screen.height)
	painter.streetCount = 0
	painter.marineCount = 0
	painter.landingCount = 0
	painter.places.fill(false)

	val vesselRadius = 18.dp.toPx()
	for (vessel in scene.vessels) {
		val x = screen.x(vessel.x)
		val y = screen.y(vessel.y)
		if (!screen.inside(x, y, vesselRadius)) continue
		placer.reserve(x - vesselRadius, y - vesselRadius, x + vesselRadius, y + vesselRadius)
		if (vessel.selected) {
			val label = text.layout(LabelStyle.VESSEL, vessel.boat.name)
			val left = MapLabels.flipsLeft(x, vesselRadius + 6.dp.toPx(), label.size.width.toFloat(), screen.width)
			val start = if (left) x - vesselRadius - 6.dp.toPx() - label.size.width else x + vesselRadius + 6.dp.toPx()
			placer.reserve(start, y - label.size.height / 2f, start + label.size.width, y + label.size.height / 2f)
		}
	}

	val dot = 6.dp.toPx()
	for (mark in scene.landings) {
		val x = screen.x(mark.x)
		val y = screen.y(mark.y)
		if (screen.inside(x, y, dot)) placer.reserve(x - dot, y - dot, x + dot, y + dot)
	}
	// Landing names: the selected vessel's next stop and the open callout always, then major landings, then all up close.
	val gap = 9.dp.toPx()
	for (pass in 0..2) {
		scene.landings.forEachIndexed { index, mark ->
			val wanted = when (pass) {
				0 -> mark.target || mark.chosen
				1 -> !(mark.target || mark.chosen) && (mark.major || mark.board)
				else -> close && !(mark.target || mark.chosen || mark.major || mark.board)
			}
			if (!wanted) return@forEachIndexed
			val x = screen.x(mark.x)
			val y = screen.y(mark.y)
			if (!screen.inside(x, y, 0f)) return@forEachIndexed
			val label = text.layout(LabelStyle.LANDING, mark.landing.displayName)
			val width = label.size.width.toFloat()
			val height = label.size.height.toFloat()
			val left = MapLabels.flipsLeft(x, gap, width, screen.width)
			val start = if (left) x - gap - width else x + gap
			if (pass == 0) {
				placer.reserve(start, y - height / 2f, start + width, y + height / 2f)
				painter.addLanding(index, left)
			} else if (placer.place(start, y - height / 2f, start + width, y + height / 2f)) {
				painter.addLanding(index, left)
			}
		}
	}

	if (scene.chart is ChartLoad.Ready) for ((index, place) in ChartGeometry.PLACES.withIndex()) {
		val x = screen.x(place.x)
		val y = screen.y(place.y)
		val label = text.layout(place.kind.labelStyle, place.name)
		val width = label.size.width.toFloat()
		val height = label.size.height.toFloat()
		if (screen.inside(x, y, width)) {
			painter.places[index] = placer.place(x - width / 2f, y - height / 2f, x + width / 2f, y + height / 2f)
		}
	}

	if (close) {
		val marineFont = 10.sp.toPx()
		scene.bridges.forEachIndexed { index, mark ->
			val s = mark.segment
			val x = screen.x((s[0] + s[2]) / 2f)
			val y = screen.y((s[1] + s[3]) / 2f)
			val width = text.width(LabelStyle.MARINE, mark.bridge.name, marineFont)
			val height = marineFont * 1.4f
			if (placer.place(x - width / 2f, y - height - 3.dp.toPx(), x + width / 2f, y - 3.dp.toPx())) painter.addMarine(index)
		}
		scene.seamarks.forEachIndexed { index, mark ->
			val x = screen.x(mark.x)
			val y = screen.y(mark.y)
			val width = text.width(LabelStyle.MARINE, mark.label, marineFont)
			val height = marineFont * 1.4f
			val start = x + 7.dp.toPx()
			if (placer.place(start, y - height / 2f, start + width, y + height / 2f)) painter.addMarine(scene.bridges.size + index)
		}
	}

	val streets = (scene.chart as? ChartLoad.Ready)?.geometry?.streets ?: return
	val streetFont = 10.sp.toPx()
	val priorityFont = 10.5.sp.toPx()
	streets.forEachIndexed { index, street ->
		if (!MapLabels.showsStreet(street.priority, street.highway, close)) return@forEachIndexed
		val x = screen.x(street.labelX)
		val y = screen.y(street.labelY)
		if (!screen.inside(x, y, 0f)) return@forEachIndexed
		val style = if (street.priority) LabelStyle.PRIORITY_STREET else LabelStyle.STREET
		val font = if (street.priority) priorityFont else streetFont
		val width = text.width(style, street.label, font)
		val height = font * 1.45f
		val radians = Math.toRadians(street.angle.toDouble())
		val cosine = abs(cos(radians)).toFloat()
		val sine = abs(sin(radians)).toFloat()
		val halfX = (cosine * width + sine * height) / 2f
		val halfY = (sine * width + cosine * height) / 2f
		if (placer.place(x - halfX, y - halfY, x + halfX, y + halfY, name = street.label)) painter.addStreet(index)
	}
}

private val PlaceKind.labelStyle: LabelStyle
	get() = when (this) {
		PlaceKind.BOROUGH -> LabelStyle.BOROUGH
		PlaceKind.WATER -> LabelStyle.WATER
		PlaceKind.PARK -> LabelStyle.PARK
		PlaceKind.ISLAND -> LabelStyle.ISLAND
	}

private fun DrawScope.haloText(label: TextLayoutResult, topLeft: Offset, color: Color, halo: Color, haloWidth: Float) {
	drawText(label, color = halo, topLeft = topLeft, drawStyle = Stroke(width = haloWidth, join = StrokeJoin.Round))
	// TextLayoutResult reuses its paragraph paint; explicitly restore fill after the halo's stroke.
	drawText(label, color = color, topLeft = topLeft, drawStyle = Fill)
}

private fun DrawScope.drawSeamarks(scene: MapScene, screen: Screen, close: Boolean, painter: MapPainter) {
	if (scene.seamarks.isEmpty()) return
	val colors = scene.colors
	val outline = Stroke(width = 1.dp.toPx())
	for (mark in scene.seamarks) {
		val x = screen.x(mark.x)
		val y = screen.y(mark.y)
		if (!screen.inside(x, y, 12.dp.toPx())) continue
		val center = Offset(x, y)
		when (mark.style.shape) {
			SeamarkShape.LIGHT -> {
				drawCircle(colors.light, radius = 7.dp.toPx(), center = center, alpha = 0.22f)
				drawCircle(colors.light, radius = 3.dp.toPx(), center = center)
				drawCircle(colors.land, radius = 3.dp.toPx(), center = center, style = outline)
			}
			else -> if (close) {
				val fill = when (mark.style.kind) {
					SeamarkKind.BUOY_GREEN -> colors.buoyGreen
					SeamarkKind.BUOY_RED -> colors.buoyRed
					SeamarkKind.BUOY_SAFE_WATER -> colors.land
					else -> colors.muted
				}
				val half = 4.5.dp.toPx()
				val path = painter.shape
				path.reset()
				when (mark.style.shape) {
					SeamarkShape.NUN -> {
						path.moveTo(x, y - half * 1.2f)
						path.lineTo(x + half, y + half)
						path.lineTo(x - half, y + half)
						path.close()
					}
					SeamarkShape.CAN -> {
						path.moveTo(x - half, y - half)
						path.lineTo(x + half, y - half)
						path.lineTo(x + half, y + half)
						path.lineTo(x - half, y + half)
						path.close()
					}
					SeamarkShape.SPHERE -> path.addOval(androidx.compose.ui.geometry.Rect(center, half))
					else -> {
						path.moveTo(x, y - half)
						path.lineTo(x + half, y)
						path.lineTo(x, y + half)
						path.lineTo(x - half, y)
						path.close()
					}
				}
				drawPath(path, fill)
				val edge = if (mark.style.kind == SeamarkKind.BUOY_SAFE_WATER) colors.buoyRed else colors.land
				drawPath(path, edge, style = Stroke(width = if (mark.style.kind == SeamarkKind.BUOY_SAFE_WATER) 1.6.dp.toPx() else 0.8.dp.toPx()))
			}
		}
	}
}

private fun DrawScope.drawStreetLabels(scene: MapScene, screen: Screen, text: MapTextCache, painter: MapPainter) {
	val streets = (scene.chart as? ChartLoad.Ready)?.geometry?.streets ?: return
	val colors = scene.colors
	val halo = 3.dp.toPx()
	for (slot in 0 until painter.streetCount) {
		val street = streets[painter.streets[slot]]
		val style = if (street.priority) LabelStyle.PRIORITY_STREET else LabelStyle.STREET
		val label = text.layout(style, street.label)
		val x = screen.x(street.labelX)
		val y = screen.y(street.labelY)
		val topLeft = Offset(x - label.size.width / 2f, y - label.size.height / 2f)
		val color = if (street.priority) colors.ink else colors.muted
		if (street.angle == 0f) haloText(label, topLeft, color, colors.land, halo)
		else rotate(street.angle, Offset(x, y)) { haloText(label, topLeft, color, colors.land, halo) }
	}
}

private fun DrawScope.drawPlaces(colors: MapColors, screen: Screen, text: MapTextCache, painter: MapPainter) {
	val halo = 3.dp.toPx()
	for ((index, place) in ChartGeometry.PLACES.withIndex()) {
		if (!painter.places[index]) continue
		val label = text.layout(place.kind.labelStyle, place.name)
		val x = screen.x(place.x)
		val y = screen.y(place.y)
		if (!screen.inside(x, y, label.size.width.toFloat())) continue
		val topLeft = Offset(x - label.size.width / 2f, y - label.size.height / 2f)
		when (place.kind) {
			PlaceKind.WATER -> haloText(label, topLeft, colors.placeWater, colors.water, halo)
			else -> haloText(label, topLeft, colors.muted, colors.land, halo)
		}
	}
}

private fun DrawScope.drawMarineLabels(scene: MapScene, screen: Screen, text: MapTextCache, painter: MapPainter) {
	val colors = scene.colors
	val halo = 3.dp.toPx()
	for (slot in 0 until painter.marineCount) {
		val index = painter.marine[slot]
		if (index < scene.bridges.size) {
			val mark = scene.bridges[index]
			val s = mark.segment
			val label = text.layout(LabelStyle.MARINE, mark.bridge.name)
			val x = screen.x((s[0] + s[2]) / 2f)
			val y = screen.y((s[1] + s[3]) / 2f)
			haloText(label, Offset(x - label.size.width / 2f, y - 3.dp.toPx() - label.size.height), colors.bridgeLabel, colors.water, halo)
		} else {
			val mark = scene.seamarks[index - scene.bridges.size]
			val label = text.layout(LabelStyle.MARINE, mark.label)
			val x = screen.x(mark.x)
			val y = screen.y(mark.y)
			haloText(label, Offset(x + 7.dp.toPx(), y - label.size.height / 2f), colors.bridgeLabel, colors.water, halo)
		}
	}
}

private fun DrawScope.drawLandings(scene: MapScene, screen: Screen, text: MapTextCache, painter: MapPainter) {
	val colors = scene.colors
	val radius = 5.dp.toPx()
	val rim = Stroke(width = 1.5.dp.toPx())
	val ring = Stroke(width = 2.dp.toPx())
	for (mark in scene.landings) {
		val x = screen.x(mark.x)
		val y = screen.y(mark.y)
		if (!screen.inside(x, y, 12.dp.toPx())) continue
		val center = Offset(x, y)
		if (mark.board) drawCircle(colors.accent, radius = 9.dp.toPx(), center = center, style = ring)
		val fill = when {
			mark.target -> colors.warning
			mark.chosen -> colors.accent
			else -> colors.card
		}
		drawCircle(fill, radius = radius, center = center)
		drawCircle(colors.ink, radius = radius, center = center, style = rim)
	}
	val gap = 9.dp.toPx()
	val halo = 3.dp.toPx()
	for (slot in 0 until painter.landingCount) {
		val mark = scene.landings[painter.landings[slot]]
		val label = text.layout(LabelStyle.LANDING, mark.landing.displayName)
		val x = screen.x(mark.x)
		val y = screen.y(mark.y)
		val start = if (painter.landingLeft[slot]) x - gap - label.size.width else x + gap
		haloText(label, Offset(start, y - label.size.height / 2f), colors.ink, colors.land, halo)
	}
}

private fun DrawScope.drawVessels(scene: MapScene, screen: Screen, text: MapTextCache) {
	if (scene.vessels.isEmpty()) return
	val colors = scene.colors
	val radius = 16.dp.toPx()
	val rim = Stroke(width = 2.dp.toPx())
	val staleRim = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.5.dp.toPx())))
	val ring = Stroke(width = 2.5.dp.toPx())
	val shadow = Color(0x33000000)
	fun vessel(mark: VesselMark) {
		val x = screen.x(mark.x)
		val y = screen.y(mark.y)
		if (!screen.inside(x, y, radius * 2)) return
		val center = Offset(x, y)
		if (mark.stale) {
			drawCircle(mark.color, radius = radius, center = center, alpha = VesselSearch.STALE_OPACITY.toFloat())
			drawCircle(colors.vesselRim, radius = radius - 1.dp.toPx(), center = center, style = staleRim)
		} else {
			drawCircle(shadow, radius = radius + 0.5.dp.toPx(), center = Offset(x, y + 1.dp.toPx()))
			drawCircle(mark.color, radius = radius, center = center)
			drawCircle(colors.vesselRim, radius = radius - 1.dp.toPx(), center = center, style = rim)
		}
		if (mark.selected) drawCircle(colors.ink, radius = radius + 4.dp.toPx(), center = center, style = ring)
		val hull = text.hull(mark.hull, radius * 2 - 6.dp.toPx())
		drawText(hull, color = mark.text, topLeft = Offset(x - hull.size.width / 2f, y - hull.size.height / 2f))
		if (mark.selected) {
			val label = text.layout(LabelStyle.VESSEL, mark.boat.name)
			val gap = radius + 6.dp.toPx()
			val left = MapLabels.flipsLeft(x, gap, label.size.width.toFloat(), screen.width)
			val start = if (left) x - gap - label.size.width else x + gap
			haloText(label, Offset(start, y - label.size.height / 2f), colors.ink, colors.card, 4.dp.toPx())
		}
	}
	for (mark in scene.vessels) if (!mark.selected) vessel(mark)
	for (mark in scene.vessels) if (mark.selected) vessel(mark)
}

/** The ride mini map's single marker: accent while live, muted and labeled "Last reported" when stale. */
private fun DrawScope.drawPosition(mark: PositionMark, colors: MapColors, screen: Screen, text: MapTextCache) {
	val x = screen.x(mark.x)
	val y = screen.y(mark.y)
	val center = Offset(x, y)
	val radius = 10.dp.toPx()
	val fill = if (mark.stale) colors.muted else colors.accent
	if (!mark.stale) drawCircle(colors.accent, radius = radius + 7.dp.toPx(), center = center, alpha = 0.2f)
	drawCircle(fill, radius = radius, center = center)
	val rim = if (mark.stale) Stroke(width = 2.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.5.dp.toPx())))
	else Stroke(width = 2.5.dp.toPx())
	drawCircle(colors.card, radius = radius, center = center, style = rim)
	drawCircle(colors.card, radius = 3.5.dp.toPx(), center = center)
	if (mark.stale) {
		val label = text.layout(LabelStyle.POSITION, "Last reported")
		val gap = radius + 6.dp.toPx()
		val left = MapLabels.flipsLeft(x, gap, label.size.width.toFloat(), screen.width)
		val start = if (left) x - gap - label.size.width else x + gap
		haloText(label, Offset(start, y - label.size.height / 2f), colors.ink, colors.card, 4.dp.toPx())
	}
}
