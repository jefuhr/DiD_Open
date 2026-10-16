package nyc.juliet.ferrykitty

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import nyc.juliet.ferrykitty.contract.AppPreferences
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.Boats
import nyc.juliet.ferrykitty.core.FerryJson
import nyc.juliet.ferrykitty.core.Harbor
import nyc.juliet.ferrykitty.ui.map.CameraPosition
import nyc.juliet.ferrykitty.ui.map.ChartLoad
import nyc.juliet.ferrykitty.ui.map.HarborCameraState
import nyc.juliet.ferrykitty.ui.map.HarborChartStore
import nyc.juliet.ferrykitty.ui.map.HarborMapScreen
import nyc.juliet.ferrykitty.ui.map.HarborProjection
import nyc.juliet.ferrykitty.ui.map.MapColors
import nyc.juliet.ferrykitty.ui.map.MapLayout
import nyc.juliet.ferrykitty.ui.map.MapOverlaysKey
import nyc.juliet.ferrykitty.ui.map.rememberHarborCameraState
import nyc.juliet.ferrykitty.ui.rememberFerryUi
import nyc.juliet.ferrykitty.ui.theme.FerryColors
import nyc.juliet.ferrykitty.ui.theme.FerryTheme
import nyc.juliet.ferrykitty.ui.theme.FerryThemes
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The harbor map in measured spaces, without changing device settings: where its lists go, what its camera keeps
 * across that change, where labels may not go at any text size, and how each theme marks the area beyond the chart.
 */
@RunWith(AndroidJUnit4::class)
class MapLayoutTest {
	@get:Rule val compose = createComposeRule()
	private val context get() = ApplicationProvider.getApplicationContext<Context>()
	private val space = mutableStateOf(DpSize(411.dp, 690.dp))
	private val fontScale = mutableStateOf<Float?>(null)
	private val theme = mutableStateOf("nyc-ferry")
	private lateinit var camera: HarborCameraState
	private var density = 1f

	private fun show(size: DpSize) {
		val harbor = FerryJson.decode<Harbor>(context.assets.open("map.json").use { it.readBytes() })
		val boats = FerryJson.decode<Boats>(context.assets.open("boats.json").use { it.readBytes() })
		val state = FerryUiState(preferences = AppPreferences(showMarineReferences = false), harbor = harbor, boats = boats,
			now = Instant.parse("2026-09-04T12:50:00Z"))
		space.value = size
		compose.setContent {
			camera = rememberHarborCameraState()
			val base = LocalDensity.current
			density = base.density
			CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale.value ?: base.fontScale)) {
				FerryTheme(themeId = theme.value, textSize = "system") {
					// Exactly this content area: the bars a shell would pad are already taken out.
					Box(Modifier.requiredSize(space.value).consumeWindowInsets(WindowInsets.safeDrawing)) {
						HarborMapScreen(state, rememberFerryUi {}, camera, PaddingValues(0.dp))
					}
				}
			}
		}
		compose.waitUntil(20_000) { HarborChartStore.chart(context).value is ChartLoad.Ready && camera.ready }
		compose.waitForIdle()
	}

	private fun resize(size: DpSize) {
		compose.runOnIdle { space.value = size }
		compose.waitForIdle()
	}

	private fun bounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
	private fun Rect.inDp() = Rect(left / density, top / density, right / density, bottom / density)
	private fun position(): CameraPosition = compose.runOnIdle { checkNotNull(camera.position) }
	private fun settle() {
		compose.mainClock.advanceTimeBy(600)
		compose.waitForIdle()
	}
	private fun Rect.holds(other: Rect) = left <= other.left + 1f && top <= other.top + 1f && right >= other.right - 1f && bottom >= other.bottom - 1f

	private fun shot(name: String, ready: (Bitmap) -> Boolean = { true }): Bitmap {
		compose.waitForIdle()
		InstrumentationRegistry.getInstrumentation().waitForIdleSync()
		val deadline = SystemClock.uptimeMillis() + 10_000
		var captures = 1
		var bitmap = settledScreenshot()
		while (!ready(bitmap) && SystemClock.uptimeMillis() < deadline) {
			bitmap.recycle()
			bitmap = settledScreenshot()
			captures++
		}
		File(screenshotDirectory(), "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
		File(screenshotDirectory(), "frame-readiness.txt").appendText("$name: captures=$captures ready=${ready(bitmap)}\n")
		if (!ready(bitmap)) {
			bitmap.recycle()
			fail("$name: the requested theme did not reach the captured frame within 10 seconds")
		}
		return bitmap
	}

	@Test fun portraitSpaceStacksTheListsBelowAFullWidthChart() {
		show(DpSize(411.dp, 690.dp))
		for (portrait in listOf(DpSize(411.dp, 690.dp), DpSize(765.dp, 1630.dp), DpSize(620.dp, 876.dp), DpSize(1000.dp, 1000.dp))) {
			resize(portrait)
			val chart = bounds("harborMap").inDp()
			val panel = bounds("mapPanel").inDp()
			assertTrue("$portrait: lists below the chart", panel.top >= chart.bottom)
			assertEquals("$portrait: chart width", portrait.width.value, chart.width, 1f)
			assertEquals("$portrait: list width", portrait.width.value, panel.width, 1f)
		}
	}

	@Test fun landscapeSpaceKeepsTheListsBesideOnlyWhileTheChartKeeps480Dp() {
		show(DpSize(979.dp, 728.dp))
		val sizes = listOf(979, 1200, 900, 836, 838, 840, 842, 844, 776, 778, 780, 782, 784, 760).map { DpSize(it.dp, 600.dp) } +
			listOf(DpSize(979.dp, 728.dp), DpSize(790.dp, 387.dp), DpSize(1100.dp, 470.dp))
		var beside = 0
		for (size in sizes) {
			resize(size)
			val chart = bounds("harborMap").inDp()
			val panel = bounds("mapPanel").inDp()
			val expected = MapLayout.sidePanelWidth(size.width.value, size.height.value, density)
			if (expected != null) {
				beside++
				assertTrue("$size: lists beside the chart", panel.left >= chart.right)
				assertEquals("$size: panel width", expected, panel.width, 0.5f)
				assertTrue("$size: the chart keeps ${chart.width} dp", chart.width >= MapLayout.MIN_CHART_BESIDE_DP)
			} else {
				assertTrue("$size: lists below the chart", panel.top >= chart.bottom)
				assertEquals("$size: chart width", size.width.value, chart.width, 1f)
			}
		}
		assertTrue("Both placements were exercised", beside in 1 until sizes.size)
	}

	@Test fun movingTheListsKeepsTheChosenViewAndGestures() {
		show(DpSize(979.dp, 728.dp))
		val fitted = position()
		compose.onNodeWithTag("mapZoomIn").performClick()
		settle()
		assertEquals("Zoom in doubles the fitted zoom", fitted.zoom * 2f, position().zoom, fitted.zoom * 0.001f)
		compose.runOnIdle { camera.stop(); camera.transform(Offset.Zero, Offset(-140f, 90f), 1f) }
		val chosen = position()

		resize(DpSize(728.dp, 979.dp))
		assertTrue("Portrait puts the lists below", bounds("mapPanel").top >= bounds("harborMap").bottom)
		assertEquals("The chosen view survives the move", chosen, position())
		compose.onNodeWithTag("harborMap").performTouchInput { swipeLeft() }
		settle()
		assertNotEquals("The chart still pans", chosen, position())

		compose.onNodeWithTag("mapFitHarbor").performClick()
		settle()
		assertEquals("Fit returns to the whole harbor", compose.runOnIdle { camera.fit }, position())
		resize(DpSize(979.dp, 728.dp))
		assertTrue("Landscape puts the lists beside", bounds("mapPanel").left >= bounds("harborMap").right)
		assertEquals("A fitted view refits beside the lists", compose.runOnIdle { camera.fit }, position())
	}

	@Test fun labelsKeepClearOfTheMeasuredControlsAndFooterAtEveryTextSize() {
		show(DpSize(411.dp, 690.dp))
		var scaleBarHeight = 0f
		for (scale in listOf(1f, 1.8f)) {
			compose.runOnIdle { fontScale.value = scale }
			compose.waitForIdle()
			val node = compose.onNodeWithTag("harborMap").fetchSemanticsNode()
			val chart = node.boundsInRoot
			val areas = compose.runOnIdle { node.config[MapOverlaysKey].areas }
			val controls = listOf("mapZoomIn", "mapZoomOut", "mapFitHarbor", "mapAttribution").map { tag ->
				val control = bounds(tag).translate(-chart.topLeft)
				checkNotNull(areas.firstOrNull { it.holds(control) }) { "$tag at $control and text $scale is not kept clear: $areas" }
			}
			// The remaining area is the scale bar, which grows with its label.
			val scaleBar = areas.single { it !in controls }
			assertTrue("Scale bar sits at the left, below the zoom controls: $scaleBar", scaleBar.left < chart.width / 3f && scaleBar.top >= controls.first().bottom)
			if (scale > 1f) assertTrue("The scale bar holds its larger label: ${scaleBar.height} px", scaleBar.height > scaleBarHeight)
			scaleBarHeight = scaleBar.height
			shot("map-keep-clear-text-$scale").recycle()
		}
	}

	@Test fun everyThemeMarksTheAreaBeyondTheChartApartFromWater() {
		show(DpSize(411.dp, 690.dp))
		for (each in FerryThemes.all) {
			compose.runOnIdle { theme.value = each.id }
			compose.waitForIdle()
			val palette = FerryColors.of(each)
			val colors = MapColors.of(palette)
			val veiled = colors.uncharted.compositeOver(colors.water)
			// West of the chart's edge, in the band beside the fitted harbor.
			val point = compose.runOnIdle {
				checkNotNull(camera.position).toScreen(HarborProjection.x(-74.30), HarborProjection.y(40.70), camera.viewport)
			}
			val chart = compose.onNodeWithTag("harborMap").fetchSemanticsNode().boundsInWindow
			assertTrue("${each.id}: the sample lies on the chart", point.x > 4f && point.y > 4f && point.x < chart.width - 4f && point.y < chart.height - 4f)
			val heading = compose.onNodeWithText("Harbor map").fetchSemanticsNode().boundsInWindow
			// Compose can be idle before the GPU presents its new frame. Confirm the independently themed
			// header first; do not wait for the chart veil whose behavior this test is meant to verify.
			val bitmap = shot("map-theme-${each.id}") { hasColor(it, heading, palette.heading) }
			val sample = median(bitmap, (chart.left + point.x).roundToInt(), (chart.top + point.y).roundToInt())
			bitmap.recycle()
			assertTrue("${each.id}: beyond the chart is $sample, expected the veiled $veiled", close(sample, veiled, 4))
			assertFalse("${each.id}: beyond the chart reads as water ${colors.water}", close(sample, colors.water, 6))
		}
	}

	private fun hasColor(bitmap: Bitmap, bounds: Rect, expected: Color): Boolean {
		var matches = 0
		for (y in bounds.top.roundToInt().coerceAtLeast(0) until bounds.bottom.roundToInt().coerceAtMost(bitmap.height)) {
			for (x in bounds.left.roundToInt().coerceAtLeast(0) until bounds.right.roundToInt().coerceAtMost(bitmap.width)) {
				if (close(Color(bitmap.getPixel(x, y)), expected, 2) && ++matches >= 8) return true
			}
		}
		return false
	}

	/** The median color of a 7 × 7 patch, so a hatch line through it cannot decide the sample. */
	private fun median(bitmap: Bitmap, x: Int, y: Int): Color {
		val pixels = (-3..3).flatMap { dx -> (-3..3).map { dy -> bitmap.getPixel(x + dx, y + dy) } }
		fun channel(shift: Int) = pixels.map { (it shr shift) and 0xFF }.sorted()[pixels.size / 2]
		return Color(channel(16), channel(8), channel(0))
	}

	private fun close(first: Color, second: Color, tolerance: Int): Boolean =
		abs((first.red - second.red) * 255).roundToInt() <= tolerance && abs((first.green - second.green) * 255).roundToInt() <= tolerance &&
			abs((first.blue - second.blue) * 255).roundToInt() <= tolerance
}
