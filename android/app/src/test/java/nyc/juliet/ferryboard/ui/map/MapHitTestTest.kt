package nyc.juliet.ferryboard.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MapHitTestTest {
	private val radius = 63f
	private val none = FloatArray(0)

	@Test fun vesselsWinOverANearerLanding() {
		val vessels = floatArrayOf(140f, 100f)
		val landings = floatArrayOf(101f, 100f)
		assertEquals(MapHit(MapLayer.VESSEL, 0), MapHitTest.pick(100f, 100f, radius, vessels, landings, none, none))
	}

	@Test fun theNearestVesselWithinTheRadiusIsChosen() {
		val vessels = floatArrayOf(160f, 100f, 120f, 100f, 101f, 400f)
		assertEquals(MapHit(MapLayer.VESSEL, 1), MapHitTest.pick(100f, 100f, radius, vessels, none, none, none))
	}

	@Test fun layersFallThroughInOrder() {
		val far = floatArrayOf(900f, 900f)
		assertEquals(MapHit(MapLayer.LANDING, 0), MapHitTest.pick(0f, 0f, radius, far, floatArrayOf(10f, 10f), floatArrayOf(5f, 5f), none))
		assertEquals(MapHit(MapLayer.SEAMARK, 0), MapHitTest.pick(0f, 0f, radius, far, far, floatArrayOf(5f, 5f), floatArrayOf(-50f, 1f, 50f, 1f)))
		assertEquals(MapHit(MapLayer.BRIDGE, 0), MapHitTest.pick(0f, 0f, radius, far, far, far, floatArrayOf(-50f, 1f, 50f, 1f)))
	}

	@Test fun theTouchRadiusIsInclusiveAndNothingBeyondItIsPicked() {
		assertEquals(MapHit(MapLayer.VESSEL, 0), MapHitTest.pick(0f, 0f, radius, floatArrayOf(radius, 0f), none, none, none))
		assertNull(MapHitTest.pick(0f, 0f, radius, floatArrayOf(radius + 0.5f, 0f), none, none, none))
	}

	@Test fun hiddenPointsAreNeverPicked() {
		val hidden = floatArrayOf(Float.NaN, Float.NaN, 30f, 0f)
		assertEquals(MapHit(MapLayer.SEAMARK, 1), MapHitTest.pick(0f, 0f, radius, none, none, hidden, none))
	}

	@Test fun bridgesAreHitAlongTheirDeckNotOnlyAtTheEnds() {
		val bridge = floatArrayOf(0f, 0f, 1000f, 0f)
		assertEquals(MapHit(MapLayer.BRIDGE, 0), MapHitTest.pick(500f, 40f, radius, none, none, none, bridge))
		assertNull(MapHitTest.pick(1100f, 0f, radius, none, none, none, bridge))
		assertEquals(40f, MapHitTest.distanceToSegment(500f, 40f, 0f, 0f, 1000f, 0f), 0.001f)
		assertEquals(5f, MapHitTest.distanceToSegment(3f, 4f, 0f, 0f, 0f, 0f), 0.001f)
	}
}
