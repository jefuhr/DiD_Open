package nyc.juliet.ferryboard

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import nyc.juliet.ferryboard.contract.AppPreferences
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.FerryJson
import nyc.juliet.ferryboard.core.Harbor
import nyc.juliet.ferryboard.ui.map.BridgeMark
import nyc.juliet.ferryboard.ui.map.CameraPosition
import nyc.juliet.ferryboard.ui.map.ChartGeometry
import nyc.juliet.ferryboard.ui.map.ChartLoad
import nyc.juliet.ferryboard.ui.map.HarborCameraState
import nyc.juliet.ferryboard.ui.map.HarborChartStore
import nyc.juliet.ferryboard.ui.map.HarborFeatures
import nyc.juliet.ferryboard.ui.map.HarborMapScreen
import nyc.juliet.ferryboard.ui.map.HarborProjection
import nyc.juliet.ferryboard.ui.map.LabelStyle
import nyc.juliet.ferryboard.ui.map.MapCamera
import nyc.juliet.ferryboard.ui.map.MapColors
import nyc.juliet.ferryboard.ui.map.MapLabels
import nyc.juliet.ferryboard.ui.map.MapOverlaysKey
import nyc.juliet.ferryboard.ui.map.MapPainter
import nyc.juliet.ferryboard.ui.map.MapScene
import nyc.juliet.ferryboard.ui.map.MapTextCache
import nyc.juliet.ferryboard.ui.map.Screen
import nyc.juliet.ferryboard.ui.map.SeamarkMark
import nyc.juliet.ferryboard.ui.map.ViewportSize
import nyc.juliet.ferryboard.ui.map.placeLabels
import nyc.juliet.ferryboard.ui.map.rememberHarborCameraState
import nyc.juliet.ferryboard.ui.rememberFerryUi
import nyc.juliet.ferryboard.ui.theme.FerryTheme
import nyc.juliet.ferryboard.ui.theme.ferryColors
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import kotlin.math.cos
import kotlin.math.sin

/**
 * Street, bridge and seamark names, measured by the chart's own text cache and drawn at their real anchors (centered and
 * rotated streets, bridge names above the deck, seamark names 7 dp right of the buoy, all with their 3 dp halo), stay
 * off the measured zoom and fit controls, scale bar and attribution at normal and accessibility text sizes.
 */
@RunWith(AndroidJUnit4::class)
class MapLabelMetricsTest {
	@get:Rule val compose = createComposeRule()
	private val context get() = ApplicationProvider.getApplicationContext<Context>()
	private val space = mutableStateOf(DpSize(411.dp, 690.dp))
	private val fontScale = mutableStateOf(1f)
	private lateinit var camera: HarborCameraState
	private lateinit var measurer: TextMeasurer
	private lateinit var density: Density
	private lateinit var colors: MapColors
	private lateinit var scope: CoroutineScope

	private fun show() {
		val harbor = FerryJson.decode<Harbor>(context.assets.open("map.json").use { it.readBytes() })
		val state = FerryUiState(preferences = AppPreferences(showMarineReferences = true), harbor = harbor, now = Instant.parse("2026-09-04T12:50:00Z"))
		compose.setContent {
			camera = rememberHarborCameraState()
			scope = rememberCoroutineScope()
			val base = LocalDensity.current
			CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale.value)) {
				FerryTheme(themeId = "nyc-ferry", textSize = "system") {
					// The same density, measurer and palette the chart canvas uses.
					density = LocalDensity.current
					measurer = rememberTextMeasurer(cacheSize = 0)
					colors = MapColors.of(ferryColors)
					Box(Modifier.requiredSize(space.value).consumeWindowInsets(WindowInsets.safeDrawing)) {
						HarborMapScreen(state, rememberFerryUi {}, camera, PaddingValues(0.dp))
					}
				}
			}
		}
		compose.waitUntil(20_000) { HarborChartStore.chart(context).value is ChartLoad.Ready && camera.ready }
		compose.waitForIdle()
	}

	private class Tally(var streets: Int = 0, var rotated: Int = 0, var bridges: Int = 0, var seamarks: Int = 0, var near: Int = 0)

	/** The drawn extent of a label: its laid-out box and full line, plus the halo stroke's outer half. */
	private fun extent(label: TextLayoutResult, halo: Float): Rect {
		val left = minOf(0f, label.getLineLeft(0))
		val right = maxOf(label.size.width.toFloat(), label.getLineRight(0))
		val bottom = maxOf(label.size.height.toFloat(), label.getLineBottom(0))
		return Rect(left - halo, minOf(0f, label.getLineTop(0)) - halo, right + halo, bottom + halo)
	}

	/** Separating-axis test of a convex quadrilateral against an axis-aligned rectangle. */
	private fun overlaps(corners: List<Offset>, area: Rect): Boolean {
		if (corners.maxOf { it.x } <= area.left || corners.minOf { it.x } >= area.right) return false
		if (corners.maxOf { it.y } <= area.top || corners.minOf { it.y } >= area.bottom) return false
		val box = listOf(area.topLeft, area.topRight, area.bottomRight, area.bottomLeft)
		for (index in 0 until 2) {
			val edge = corners[index + 1] - corners[index]
			val axis = Offset(-edge.y, edge.x)
			fun project(points: List<Offset>) = points.map { it.x * axis.x + it.y * axis.y }
			val a = project(corners)
			val b = project(box)
			if (a.max() <= b.min() || b.max() <= a.min()) return false
		}
		return true
	}

	private fun near(corners: List<Offset>, area: Rect, margin: Float): Boolean =
		corners.maxOf { it.x } > area.left - margin && corners.minOf { it.x } < area.right + margin &&
			corners.maxOf { it.y } > area.top - margin && corners.minOf { it.y } < area.bottom + margin

	private fun Density.sweep(geometry: ChartGeometry, areas: List<Rect>, viewport: ViewportSize, fit: CameraPosition, text: MapTextCache,
		overlapping: MutableList<String>): Tally {
		val bridges = geometry.bridges.mapNotNull { bridge -> HarborFeatures.bridgeSegment(bridge)?.let { BridgeMark(bridge, it) } }
		val seamarks = geometry.seamarks.mapNotNull { seamark ->
			if (!seamark.latitude.isFinite() || !seamark.longitude.isFinite()) return@mapNotNull null
			val style = ChartGeometry.styleFor(seamark, geometry.seamarkStyles)
			SeamarkMark(seamark, HarborProjection.x(seamark.longitude), HarborProjection.y(seamark.latitude), style, MapLabels.seamarkLabel(seamark.name, style.kind))
		}
		val scene = MapScene(ChartLoad.Unavailable, colors, bridges = bridges, seamarks = seamarks)
		val painter = MapPainter()
		val halo = 1.5.dp.toPx()
		val margin = 16.dp.toPx()
		val tally = Tally()
		val bounds = geometry.bounds
		fun verify(kind: String, name: String, corners: List<Offset>, camera: CameraPosition) {
			for (area in areas) {
				if (overlaps(corners, area)) overlapping += "$kind \"$name\" at $corners overlaps $area with $camera"
				if (near(corners, area, margin)) tally.near++
			}
		}
		for (factor in listOf(1f, 1.6f, 2.2f, 3f, 5f, 8f, 12f)) for (column in 0..6) for (row in 0..6) {
			val camera = CameraPosition(bounds.left + bounds.width * column / 6f, bounds.top + bounds.height * row / 6f, fit.zoom * factor)
			val screen = Screen(camera, viewport.width, viewport.height)
			placeLabels(scene, screen, factor >= MapCamera.CLOSE_OF_FIT, text, painter, geometry, areas)
			for (slot in 0 until painter.streetCount) {
				val street = geometry.streets[painter.streets[slot]]
				val label = text.layout(if (street.priority) LabelStyle.PRIORITY_STREET else LabelStyle.STREET, street.label)
				// drawStreetLabels centers the label on its anchor and rotates it about the anchor.
				val x = screen.x(street.labelX)
				val y = screen.y(street.labelY)
				val box = extent(label, halo).translate(x - label.size.width / 2f, y - label.size.height / 2f)
				val radians = Math.toRadians(street.angle.toDouble())
				val cosine = cos(radians).toFloat()
				val sine = sin(radians).toFloat()
				val corners = listOf(box.topLeft, box.topRight, box.bottomRight, box.bottomLeft).map {
					val dx = it.x - x
					val dy = it.y - y
					Offset(x + dx * cosine - dy * sine, y + dx * sine + dy * cosine)
				}
				verify("Street", street.label, corners, camera)
				tally.streets++
				if (street.angle != 0f) tally.rotated++
			}
			for (slot in 0 until painter.marineCount) {
				val index = painter.marine[slot]
				val box = if (index < scene.bridges.size) {
					val mark = scene.bridges[index]
					val s = mark.segment
					val label = text.layout(LabelStyle.MARINE, mark.bridge.name)
					tally.bridges++
					// drawMarineLabels writes a bridge's name centered 3 dp above the deck's midpoint.
					extent(label, halo).translate(screen.x((s[0] + s[2]) / 2f) - label.size.width / 2f, screen.y((s[1] + s[3]) / 2f) - 3.dp.toPx() - label.size.height)
				} else {
					val mark = scene.seamarks[index - scene.bridges.size]
					val label = text.layout(LabelStyle.MARINE, mark.label)
					tally.seamarks++
					// …and a seamark's 7 dp right of its mark, centered vertically.
					extent(label, halo).translate(screen.x(mark.x) + 7.dp.toPx(), screen.y(mark.y) - label.size.height / 2f)
				}
				verify("Marine", if (index < scene.bridges.size) scene.bridges[index].bridge.name else scene.seamarks[index - scene.bridges.size].label,
					listOf(box.topLeft, box.topRight, box.bottomRight, box.bottomLeft), camera)
			}
		}
		return tally
	}

	private fun shot(name: String) {
		compose.waitForIdle()
		InstrumentationRegistry.getInstrumentation().waitForIdleSync()
		val bitmap = settledScreenshot()
		File(screenshotDirectory(), "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
		bitmap.recycle()
	}

	@Test fun streetAndMarineNamesAsMeasuredAndDrawnStayOffTheControlsAndFooter() {
		show()
		val geometry = (HarborChartStore.chart(context).value as ChartLoad.Ready).geometry
		val overlapping = mutableListOf<String>()
		val report = StringBuilder()
		var near = 0
		for (size in listOf(DpSize(411.dp, 690.dp), DpSize(600.dp, 1000.dp))) for (scale in listOf(1f, 1.8f)) {
			compose.runOnIdle {
				space.value = size
				fontScale.value = scale
			}
			compose.waitForIdle()
			val overlays = compose.onNodeWithTag("harborMap").fetchSemanticsNode().config[MapOverlaysKey]
			val (areas, viewport, fit) = compose.runOnIdle { Triple(overlays.areas, camera.viewport, checkNotNull(camera.fit)) }
			check(areas.size == 3) { "Expected the controls, scale bar and attribution: $areas" }
			report.appendLine("${size.width.value.toInt()}x${size.height.value.toInt()} dp at text $scale: viewport $viewport, kept clear $areas")
			// Measured on this test thread with the canvas's own settings, so the app's main thread stays free.
			val text = MapTextCache(measurer, density.fontScale)
			val tally = with(density) { sweep(geometry, areas, viewport, fit, text, overlapping) }
			report.appendLine("  accepted labels checked: ${tally.streets} streets (${tally.rotated} rotated), ${tally.bridges} bridges, ${tally.seamarks} seamarks; within 16 dp of a control: ${tally.near}")
			near += tally.near
			// A close view of lower Manhattan, where street and marine names crowd the controls.
			compose.runOnIdle { camera.focus(scope, HarborProjection.x(-74.012), HarborProjection.y(40.708)) }
			compose.waitForIdle()
			shot("map-label-metrics-${size.width.value.toInt()}x${size.height.value.toInt()}-text-$scale")
			compose.runOnIdle { camera.fitHarbor(scope) }
			compose.waitForIdle()
		}
		report.appendLine("overlaps: ${overlapping.size}")
		overlapping.forEach { report.appendLine("  $it") }
		File(screenshotDirectory(), "map-label-metrics.txt").writeText(report.toString())
		android.util.Log.i("MapLabelMetricsTest", report.toString())
		assertTrue("The sweep checked names beside the controls", near > 0)
		assertTrue(overlapping.take(20).joinToString("\n"), overlapping.isEmpty())
	}
}
