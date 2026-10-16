package nyc.juliet.ferrykitty.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HarborProjectionTest {
	@Test fun eastIsRightAndNorthIsUp() {
		assertTrue(HarborProjection.x(-73.9) > HarborProjection.x(-74.0))
		assertTrue(HarborProjection.y(40.8) < HarborProjection.y(40.7))
	}

	@Test fun projectionRoundTripsAcrossTheHarbor() {
		for ((latitude, longitude) in listOf(40.5 to -74.23, 40.703161 to -74.006144, 40.92 to -73.7)) {
			assertEquals(longitude, HarborProjection.longitude(HarborProjection.x(longitude)), 1e-6)
			assertEquals(latitude, HarborProjection.latitude(HarborProjection.y(latitude)), 1e-6)
		}
	}

	@Test fun drawingUnitsStayPreciseAsFloats() {
		// A metre apart at Pier 11 must stay distinguishable after Float storage.
		val metre = 1.0 / 111_320
		val a = HarborProjection.y(40.703161)
		val b = HarborProjection.y(40.703161 + metre)
		assertTrue(a - b > 0.005f)
		assertTrue("Coordinates stay small", HarborProjection.x(-73.7) in 0f..4000f && HarborProjection.y(40.5) in 0f..4000f)
	}

	@Test fun unitScaleMatchesWebMercator() {
		// One unit is 2^-19 of the world, about 58 metres at the harbor's latitude.
		assertEquals(57.9, HarborProjection.metresPerUnit(40.7), 0.5)
		val unitsPerDegree = HarborProjection.x(-73.0) - HarborProjection.x(-74.0)
		assertEquals(524_288.0 / 360, unitsPerDegree.toDouble(), 0.01)
	}
}
