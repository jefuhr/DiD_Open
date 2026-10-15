package nyc.juliet.ferryboard.ui.map

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.toArgb
import nyc.juliet.ferryboard.core.MapBounds
import nyc.juliet.ferryboard.ui.theme.ColorMath
import nyc.juliet.ferryboard.ui.theme.FerryColors
import nyc.juliet.ferryboard.ui.theme.FerryThemes
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bundled chart ends at its own extent: beyond it the map must not pass for open water, in any theme. */
class ChartExtentTest {
	private val extent = ChartGeometry.DEFAULT_BOUNDS
	private val harbor = MapCamera.harbor(MapBounds(minLatitude = 40.5, maxLatitude = 40.85, minLongitude = -74.2, maxLongitude = -73.7), extent)

	private fun contrast(first: Color, second: Color): Double =
		ColorMath.contrast(first.toArgb().toLong() and 0xFFFFFFFF, second.toArgb().toLong() and 0xFFFFFFFF)

	@Test fun everyThemeTellsUnchartedAreasFromWaterAndLand() {
		for (theme in FerryThemes.all) {
			val colors = MapColors.of(FerryColors.of(theme))
			val veiled = colors.uncharted.compositeOver(colors.water)
			val hatch = colors.unchartedHatch.compositeOver(veiled)
			val edge = colors.chartEdge.compositeOver(colors.water)
			assertTrue("${theme.id}: uncharted tone against water", contrast(veiled, colors.water) >= 1.1)
			assertTrue("${theme.id}: uncharted tone stays quiet", contrast(veiled, colors.water) <= 1.35)
			assertTrue("${theme.id}: hatching against the uncharted tone", contrast(hatch, veiled) >= 1.35)
			assertTrue("${theme.id}: hatching against land", contrast(hatch, colors.land) >= 1.35)
			assertTrue("${theme.id}: chart edge against water", contrast(edge, colors.water) >= 1.5)
		}
	}

	@Test fun theTreatmentAppearsOnlyWhereTheViewGoesBeyondTheChart() {
		val phone = ViewportSize(1080f, 690f)
		val fit = CameraPosition.fit(harbor, phone, paddingPx = 63f)
		assertTrue("A phone fit shows bands beside the chart", fit.seesBeyond(extent, phone))
		val midtown = CameraPosition(HarborProjection.x(-73.98), HarborProjection.y(40.75), fit.zoom * 5f)
		assertFalse("Up close inside the chart", midtown.seesBeyond(extent, phone))
	}

	@Test fun theFittedViewStillHoldsTheWholeServedHarbor() {
		val views = listOf(
			ViewportSize(1080f, 690f) to 63f,
			ViewportSize(1147f, 1725f) to 36f,
			ViewportSize(927f, 1035f) to 36f,
			ViewportSize(1563f, 1290f) to 36f,
		)
		for ((viewport, padding) in views) {
			val visible = CameraPosition.fit(harbor, viewport, padding).visible(viewport)
			assertTrue("$viewport shows $visible", visible.contains(harbor))
		}
	}
}
