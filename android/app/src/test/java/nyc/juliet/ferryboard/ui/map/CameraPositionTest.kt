package nyc.juliet.ferryboard.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraPositionTest {
	private val viewport = ViewportSize(400f, 600f)
	private val harbor = UnitRect(100f, 200f, 900f, 1000f)

	@Test fun fitShowsTheWholeHarborCentered() {
		val camera = CameraPosition.fit(harbor, viewport, paddingPx = 20f)
		assertEquals(500f, camera.centerX, 0.001f)
		assertEquals(600f, camera.centerY, 0.001f)
		val topLeft = camera.toScreen(harbor.left, harbor.top, viewport)
		val bottomRight = camera.toScreen(harbor.right, harbor.bottom, viewport)
		assertTrue(topLeft.x >= 19.9f && bottomRight.x <= 380.1f)
		assertTrue(topLeft.y >= 0f && bottomRight.y <= 600f)
		assertEquals("Width limits this harbor on a tall screen", 360f / 800f, camera.zoom, 0.0001f)
	}

	@Test fun screenAndUnitsRoundTrip() {
		val camera = CameraPosition(321f, 654f, 2.5f)
		val screen = camera.toScreen(400f, 700f, viewport)
		val back = camera.toUnits(screen.x, screen.y, viewport)
		assertEquals(400f, back.x, 0.001f)
		assertEquals(700f, back.y, 0.001f)
	}

	@Test fun zoomKeepsThePinchPointStill() {
		val camera = CameraPosition(500f, 600f, 1f)
		val focusX = 80f
		val focusY = 500f
		val before = camera.toUnits(focusX, focusY, viewport)
		val zoomed = camera.zoomedAbout(focusX, focusY, 3f, viewport, 0.1f..10f)
		val after = zoomed.toUnits(focusX, focusY, viewport)
		assertEquals(3f, zoomed.zoom, 0.0001f)
		assertEquals(before.x, after.x, 0.001f)
		assertEquals(before.y, after.y, 0.001f)
	}

	@Test fun zoomRespectsLimitsWithoutDrifting() {
		val camera = CameraPosition(500f, 600f, 9f)
		val zoomed = camera.zoomedAbout(200f, 300f, 4f, viewport, 0.1f..10f)
		assertEquals(10f, zoomed.zoom, 0.0001f)
		val unchanged = CameraPosition(500f, 600f, 10f).zoomedAbout(10f, 10f, 2f, viewport, 0.1f..10f)
		assertEquals(500f, unchanged.centerX, 0.001f)
		assertEquals(600f, unchanged.centerY, 0.001f)
	}

	@Test fun panMovesContentWithTheFinger() {
		val camera = CameraPosition(500f, 600f, 2f)
		val point = camera.toScreen(500f, 600f, viewport)
		val panned = camera.panned(40f, -20f)
		val moved = panned.toScreen(500f, 600f, viewport)
		assertEquals(point.x + 40f, moved.x, 0.001f)
		assertEquals(point.y - 20f, moved.y, 0.001f)
	}

	@Test fun clampKeepsTheHarborReachable() {
		val camera = CameraPosition(-5000f, 9000f, 1f).clamped(harbor)
		assertEquals(harbor.left, camera.centerX, 0.001f)
		assertEquals(harbor.bottom, camera.centerY, 0.001f)
	}

	@Test fun interpolationEndsExactlyAtTheTarget() {
		val start = CameraPosition(0f, 0f, 1f)
		val end = CameraPosition(100f, 200f, 8f)
		val last = start.interpolate(end, 1f)
		assertEquals(end.centerX, last.centerX, 0.001f)
		assertEquals(end.zoom, last.zoom, 0.001f)
		val middle = start.interpolate(end, 0.5f)
		assertEquals("Zoom eases geometrically", 2.828f, middle.zoom, 0.01f)
	}
}
