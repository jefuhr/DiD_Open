package nyc.juliet.ferrykitty.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScaleBarTest {
	@Test fun metricPicksTheLongestRoundDistanceThatFits() {
		val bar = ScaleBar.of(metresPerPixel = 10.0, maxLengthPx = 250f, imperial = false)!!
		assertEquals("2 km", bar.label)
		assertEquals(200f, bar.lengthPx, 0.001f)
		val close = ScaleBar.of(metresPerPixel = 0.5, maxLengthPx = 250f, imperial = false)!!
		assertEquals("100 m", close.label)
		assertEquals(200f, close.lengthPx, 0.001f)
	}

	@Test fun imperialUsesFeetThenMiles() {
		val near = ScaleBar.of(metresPerPixel = 1.0, maxLengthPx = 250f, imperial = true)!!
		assertEquals("500 ft", near.label)
		assertEquals(152.4f, near.lengthPx, 0.01f)
		val far = ScaleBar.of(metresPerPixel = 20.0, maxLengthPx = 250f, imperial = true)!!
		assertEquals("2 mi", far.label)
		assertEquals(160.93f, far.lengthPx, 0.01f)
		val half = ScaleBar.of(metresPerPixel = 4.0, maxLengthPx = 250f, imperial = true)!!
		assertEquals("0.5 mi", half.label)
	}

	@Test fun everyBarFitsItsSpaceUnlessEvenTheShortestCannot() {
		for (metres in listOf(0.2, 1.0, 3.7, 12.0, 55.0, 140.0)) for (imperial in listOf(false, true)) {
			val bar = ScaleBar.of(metres, 180f, imperial)!!
			assertTrue("$metres $imperial", bar.lengthPx <= 180f || bar.label == "5 m" || bar.label == "10 ft")
			assertTrue(bar.lengthPx > 0f)
		}
	}

	@Test fun invalidScalesGiveNoBar() {
		assertNull(ScaleBar.of(0.0, 200f, imperial = false))
		assertNull(ScaleBar.of(Double.NaN, 200f, imperial = false))
		assertNull(ScaleBar.of(Double.POSITIVE_INFINITY, 200f, imperial = true))
		assertNull(ScaleBar.of(10.0, 0f, imperial = true))
	}

	@Test fun metresPerPixelComesFromTheCameraLatitude() {
		val camera = CameraPosition(HarborProjection.x(-74.0), HarborProjection.y(40.7), zoom = 2f)
		assertEquals(HarborProjection.metresPerUnit(40.7) / 2, ScaleBar.metresPerPixel(camera), 0.01)
	}
}
