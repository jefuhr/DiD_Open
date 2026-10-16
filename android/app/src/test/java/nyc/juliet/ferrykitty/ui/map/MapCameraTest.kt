package nyc.juliet.ferrykitty.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import nyc.juliet.ferrykitty.core.MapBounds

class MapCameraTest {
	private val chart = ChartGeometry.DEFAULT_BOUNDS
	private val bounds = MapBounds(minLatitude = 40.5, maxLatitude = 40.85, minLongitude = -74.2, maxLongitude = -73.7)
	private val harbor = MapCamera.harbor(bounds, chart)
	private val phone = ViewportSize(1080f, 900f)
	private val fit = CameraPosition.fit(harbor, phone, paddingPx = 63f)

	@Test fun servedBoundsWinOverTheChartExtent() {
		assertEquals(HarborProjection.x(-74.2), harbor.left, 0.01f)
		assertEquals(HarborProjection.y(40.85), harbor.top, 0.01f)
		assertEquals(HarborProjection.x(-73.7), harbor.right, 0.01f)
		assertEquals(HarborProjection.y(40.5), harbor.bottom, 0.01f)
	}

	@Test fun missingOrDegenerateBoundsFallBackToTheChart() {
		assertSame(chart, MapCamera.harbor(null, chart))
		assertSame(chart, MapCamera.harbor(bounds.copy(maxLatitude = 40.5), chart))
		assertSame(chart, MapCamera.harbor(bounds.copy(minLongitude = Double.NaN), chart))
		assertSame(chart, MapCamera.harbor(bounds.copy(maxLatitude = 95.0), chart))
	}

	@Test fun zoomStaysBetweenThreeQuartersAndTwentyTimesFit() {
		val limits = MapCamera.zoomLimits(fit)
		assertEquals(fit.zoom * 0.75f, limits.start, 0.0001f)
		assertEquals(fit.zoom * 20f, limits.endInclusive, 0.0001f)
		val tooFar = MapCamera.constrain(fit.copy(zoom = fit.zoom * 0.1f), fit, chart)
		assertEquals(fit.zoom * 0.75f, tooFar.zoom, 0.0001f)
		val tooClose = MapCamera.constrain(fit.copy(zoom = fit.zoom * 80f), fit, chart)
		assertEquals(fit.zoom * 20f, tooClose.zoom, 0.0001f)
	}

	@Test fun centerIsClampedToTheChart() {
		val lost = MapCamera.constrain(CameraPosition(-9_000f, 9_000f, fit.zoom), fit, chart)
		assertEquals(chart.left, lost.centerX, 0.001f)
		assertEquals(chart.bottom, lost.centerY, 0.001f)
	}

	@Test fun closeDetailStartsAtTwoPointTwoTimesFit() {
		assertFalse(MapCamera.isClose(fit.zoom * 2.19f, fit))
		assertTrue(MapCamera.isClose(fit.zoom * 2.2f, fit))
	}

	@Test fun focusingAVesselZoomsToAtLeastFiveTimesFit() {
		val x = HarborProjection.x(-74.0)
		val y = HarborProjection.y(40.71)
		val far = MapCamera.focus(fit, x, y, fit, chart)
		assertEquals(x, far.centerX, 0.001f)
		assertEquals(y, far.centerY, 0.001f)
		assertEquals(fit.zoom * 5f, far.zoom, 0.0001f)
		val closer = MapCamera.focus(fit.copy(zoom = fit.zoom * 12f), x, y, fit, chart)
		assertEquals("A closer zoom is kept", fit.zoom * 12f, closer.zoom, 0.0001f)
		assertEquals("Before any camera exists", fit.zoom * 5f, MapCamera.focus(null, x, y, fit, chart).zoom, 0.0001f)
	}

	@Test fun aFollowingCameraRefitsAndAUserCameraIsKeptWithinLimits() {
		val rotated = ViewportSize(1800f, 500f)
		val newFit = CameraPosition.fit(harbor, rotated, paddingPx = 63f)
		assertEquals(newFit, MapCamera.adapt(fit, followsFit = true, fit = newFit, pan = chart))
		assertEquals(newFit, MapCamera.adapt(null, followsFit = false, fit = newFit, pan = chart))
		val chosen = CameraPosition(HarborProjection.x(-74.0), HarborProjection.y(40.7), fit.zoom * 6f)
		val kept = MapCamera.adapt(chosen, followsFit = false, fit = newFit, pan = chart)
		assertEquals(chosen.centerX, kept.centerX, 0.001f)
		assertEquals(chosen.centerY, kept.centerY, 0.001f)
		assertEquals(chosen.zoom, kept.zoom, 0.0001f)
	}

	@Test fun miniMapShowsAboutTwoHundredthsOfADegreeAroundTheBoat() {
		val viewport = ViewportSize(900f, 480f)
		val camera = MapCamera.miniMap(40.71, -74.0, viewport)
		assertEquals(HarborProjection.x(-74.0), camera.centerX, 0.001f)
		assertEquals(HarborProjection.y(40.71), camera.centerY, 0.001f)
		val visible = camera.visible(viewport)
		val span = HarborProjection.latitude(visible.top) - HarborProjection.latitude(visible.bottom)
		assertEquals(0.02, span, 0.0005)
	}
}
