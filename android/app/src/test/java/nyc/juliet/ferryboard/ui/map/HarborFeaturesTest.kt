package nyc.juliet.ferryboard.ui.map

import nyc.juliet.ferryboard.core.Boat
import nyc.juliet.ferryboard.core.BoatStop
import nyc.juliet.ferryboard.core.Bridge
import nyc.juliet.ferryboard.core.Landing
import nyc.juliet.ferryboard.core.MapRoute
import nyc.juliet.ferryboard.core.Seamark
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class HarborFeaturesTest {
	private val pier11 = Landing(16, "Pier 11", "Pier 11 / Wall St", 40.703161, -74.006144)
	private val pier79 = Landing(26, "Pier 79", "Midtown West / Pier 79", 40.760323, -74.004075)
	private val unplaced = Landing(99, "Somewhere", "Somewhere", null, -74.0)

	@Test fun routePathsAreProjectedSkippingBrokenPoints() {
		val route = MapRoute("ER", "East River", "ER", "#0070AB", listOf(
			listOf(listOf(40.70, -74.0), listOf(40.71), listOf(40.72, -73.99), listOf(Double.NaN, -73.9)),
			listOf(listOf(40.70, -74.0)),
		))
		val lines = HarborFeatures.routeLines(listOf(route, MapRoute("X", "No paths")))
		assertEquals("A one-point path is not a line", 1, lines.size)
		val line = lines.first()
		assertEquals("ER", line.routeId)
		assertEquals(0xFF0070AB, line.color)
		assertEquals(4, line.points.size)
		assertEquals(HarborProjection.x(-73.99), line.points[2], 0.001f)
		assertEquals(HarborProjection.y(40.72), line.bounds.top, 0.001f)
	}

	@Test fun unknownRouteColorsUseTheNeutralMarker() {
		val line = HarborFeatures.routeLines(listOf(MapRoute("Z", "Z", color = "teal", paths = listOf(listOf(listOf(40.7, -74.0), listOf(40.71, -74.0)))))).single()
		assertEquals(VesselSearch.NEUTRAL_MARKER, line.color)
	}

	@Test fun landingsWithoutCoordinatesAreNotPlaced() {
		val point = HarborFeatures.landingPoint(pier11)!!
		assertEquals(HarborProjection.x(-74.006144), point.x, 0.001f)
		assertNull(HarborFeatures.landingPoint(unplaced))
		assertNull(HarborFeatures.landingPoint(pier11.copy(latitude = Double.NaN)))
	}

	@Test fun theSelectedVesselsNextStopIsTheNearestLandingWithin300Metres() {
		val boat = Boat(id = "b", name = "B", latitude = 40.71, longitude = -74.0, stop = BoatStop("Wall St", 40.7035, -74.0065))
		assertEquals(16, HarborFeatures.nextStopLanding(boat, listOf(pier79, pier11, unplaced)))
		val far = boat.copy(stop = BoatStop("Far", 40.72, -74.0))
		assertNull(HarborFeatures.nextStopLanding(far, listOf(pier11, pier79)))
		assertNull(HarborFeatures.nextStopLanding(boat.copy(stop = BoatStop("No position")), listOf(pier11)))
		assertNull(HarborFeatures.nextStopLanding(null, listOf(pier11)))
	}

	@Test fun bridgesUseTheirFirstTwoPoints() {
		val bridge = Bridge("b", "Bridge", points = listOf(listOf(40.7107, -74.0001), listOf(40.7005, -73.9897), listOf(40.69, -73.98)))
		val segment = HarborFeatures.bridgeSegment(bridge)!!
		assertEquals(4, segment.size)
		assertEquals(HarborProjection.y(40.7005), segment[3], 0.001f)
		assertNull(HarborFeatures.bridgeSegment(bridge.copy(points = listOf(listOf(40.7, -74.0)))))
		assertNull(HarborFeatures.bridgeSegment(bridge.copy(points = listOf(listOf(40.7), listOf(40.7, -74.0)))))
	}

	@Test fun marineReferencesComeFromTheServerElseTheBundledChart() {
		val served = listOf(Bridge("served", "Served", points = listOf(listOf(40.7, -74.0), listOf(40.71, -74.0))))
		val bundled = listOf(Bridge("bundled", "Bundled", points = listOf(listOf(40.7, -74.0), listOf(40.71, -74.0))))
		assertSame(served, HarborFeatures.marine(served, bundled))
		assertSame(bundled, HarborFeatures.marine(null, bundled))
		assertSame("An empty served list keeps the bundled references", bundled, HarborFeatures.marine(emptyList(), bundled))
		val mark = Seamark("m", "Mark", 40.7, -74.0, "light")
		assertEquals(listOf(mark), HarborFeatures.marine(null, listOf(mark)))
		assertTrue(HarborFeatures.marine(null, emptyList<Seamark>()).isEmpty())
	}
}
