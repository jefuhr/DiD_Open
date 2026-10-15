package nyc.juliet.ferryboard.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MapLabelsTest {
	@Test fun labelsNeverOverlapAndEarlierLabelsWin() {
		val placer = LabelPlacer()
		placer.reset(400f, 300f)
		assertTrue(placer.place(10f, 10f, 110f, 30f))
		assertFalse("Overlaps the first", placer.place(100f, 20f, 200f, 40f))
		assertTrue("Touching edges is not an overlap", placer.place(110f, 10f, 200f, 30f))
		assertEquals(2, placer.placed)
	}

	@Test fun labelsMustFitInsideTheViewport() {
		val placer = LabelPlacer()
		placer.reset(400f, 300f)
		assertFalse(placer.place(-5f, 10f, 50f, 30f))
		assertFalse(placer.place(380f, 10f, 420f, 30f))
		assertFalse(placer.place(10f, 290f, 50f, 310f))
		assertTrue(placer.place(0f, 0f, 400f, 20f))
	}

	@Test fun eachStreetNameIsDrawnOnce() {
		val placer = LabelPlacer()
		placer.reset(400f, 300f)
		assertTrue(placer.place(10f, 10f, 60f, 20f, name = "Broadway"))
		assertFalse(placer.place(200f, 200f, 260f, 210f, name = "Broadway"))
		assertTrue(placer.place(200f, 200f, 260f, 210f, name = "Canal St"))
	}

	@Test fun reservedSpaceBlocksLaterLabelsAndResetClearsEverything() {
		val placer = LabelPlacer()
		placer.reset(400f, 300f)
		placer.reserve(-20f, 0f, 100f, 50f)
		assertFalse(placer.place(50f, 10f, 150f, 30f))
		placer.reset(400f, 300f)
		assertTrue(placer.place(50f, 10f, 150f, 30f))
		assertTrue(placer.place(200f, 10f, 250f, 30f, name = "Broadway"))
		placer.reset(400f, 300f)
		assertTrue("Names are forgotten on reset", placer.place(200f, 10f, 250f, 30f, name = "Broadway"))
	}

	@Test fun areasKeptClearForControlsRefuseLabelsUntilReset() {
		val placer = LabelPlacer()
		placer.reset(400f, 300f)
		placer.keepClear(300f, 0f, 400f, 60f)
		assertFalse("Under the zoom controls", placer.place(250f, 10f, 350f, 30f))
		assertTrue("Beside the zoom controls", placer.place(150f, 10f, 299f, 30f))
		assertTrue(placer.obstructed(290f, 50f, 310f, 70f))
		assertFalse("Other labels are not controls", placer.obstructed(150f, 10f, 299f, 30f))
		placer.reset(400f, 300f)
		assertFalse(placer.obstructed(290f, 50f, 310f, 70f))
		assertTrue("Reset forgets the controls", placer.place(250f, 10f, 350f, 30f))
	}

	@Test fun alwaysShownLabelsTakeTheSideClearOfControls() {
		val placer = LabelPlacer()
		placer.reset(400f, 300f)
		placer.keepClear(300f, 0f, 400f, 60f)
		assertTrue("The right side would run under the controls", placer.flipsLeft(x = 250f, y = 30f, gap = 9f, labelWidth = 80f, labelHeight = 16f))
		assertFalse("Below the controls the label stays right", placer.flipsLeft(x = 250f, y = 150f, gap = 9f, labelWidth = 80f, labelHeight = 16f))
		assertTrue("Near the right edge it flips left as before", placer.flipsLeft(x = 380f, y = 150f, gap = 9f, labelWidth = 80f, labelHeight = 16f))
		assertFalse("The left side would leave the viewport", placer.flipsLeft(x = 60f, y = 30f, gap = 9f, labelWidth = 280f, labelHeight = 16f))
		assertTrue("The right side would leave the viewport", placer.flipsLeft(x = 330f, y = 30f, gap = 9f, labelWidth = 200f, labelHeight = 16f))
		placer.keepClear(0f, 0f, 120f, 60f)
		assertFalse("Both sides covered: the usual side, which the caller then leaves out", placer.flipsLeft(x = 200f, y = 30f, gap = 9f, labelWidth = 150f, labelHeight = 16f))
		assertTrue(placer.obstructed(209f, 22f, 359f, 38f))
	}

	@Test fun manyLabelsStillPlaceCorrectly() {
		val placer = LabelPlacer()
		placer.reset(10_000f, 100f)
		for (index in 0 until 500) assertTrue(placer.place(index * 20f, 0f, index * 20f + 19f, 10f))
		assertFalse(placer.place(5f, 5f, 15f, 8f))
		assertEquals(500, placer.placed)
	}

	@Test fun sideStreetsOnlyAtCloseZoom() {
		assertFalse(MapLabels.showsStreet(priority = false, highway = false, close = false))
		assertTrue(MapLabels.showsStreet(priority = false, highway = false, close = true))
		assertTrue(MapLabels.showsStreet(priority = true, highway = false, close = false))
		assertTrue(MapLabels.showsStreet(priority = false, highway = true, close = false))
	}

	@Test fun majorLandingsMatchTheWebMap() {
		for (name in listOf("Pier 11 / Wall St", "East 34th Street", "Rockaway", "St. George", "Bay Ridge", "Astoria", "East 90th St")) {
			assertTrue(name, MapLabels.isMajorLanding(name))
		}
		assertFalse(MapLabels.isMajorLanding("Midtown West / Pier 79"))
		assertFalse(MapLabels.isMajorLanding("DUMBO"))
	}

	@Test fun landingLabelsFlipLeftNearTheRightEdge() {
		assertFalse(MapLabels.flipsLeft(x = 100f, gap = 18f, labelWidth = 200f, viewportWidth = 400f))
		assertTrue(MapLabels.flipsLeft(x = 300f, gap = 18f, labelWidth = 200f, viewportWidth = 400f))
	}

	@Test fun seamarkLabelsAreShortAsOnTheWebMap() {
		assertEquals("Robbins", MapLabels.seamarkLabel("Robbins Reef Light", SeamarkKind.LIGHT))
		assertEquals("1", MapLabels.seamarkLabel("Ambrose Buoy 1", SeamarkKind.BUOY_GREEN))
		assertEquals("AC", MapLabels.seamarkLabel("Ambrose Lighted Buoy AC", SeamarkKind.BUOY_SAFE_WATER))
		assertEquals("HG-1", MapLabels.seamarkLabel("Hell Gate Buoy HG-1", SeamarkKind.BUOY_GREEN))
		assertEquals("Compton Creek 1", MapLabels.seamarkLabel("Compton Creek 1", SeamarkKind.OTHER))
	}

	@Test fun buoyShapesFollowTheirSide() {
		assertEquals(SeamarkShape.LIGHT, SeamarkStyle(SeamarkKind.LIGHT, "lighthouse").shape)
		assertEquals(SeamarkShape.CAN, SeamarkStyle(SeamarkKind.BUOY_GREEN, "port-can").shape)
		assertEquals(SeamarkShape.NUN, SeamarkStyle(SeamarkKind.BUOY_RED, "starboard-nun").shape)
		assertEquals("Red without a subtype is a nun", SeamarkShape.NUN, SeamarkStyle(SeamarkKind.BUOY_RED).shape)
		assertEquals("Green without a subtype is a can", SeamarkShape.CAN, SeamarkStyle(SeamarkKind.BUOY_GREEN).shape)
		assertEquals(SeamarkShape.SPHERE, SeamarkStyle(SeamarkKind.BUOY_SAFE_WATER, "safe-water").shape)
		assertEquals(SeamarkShape.MARK, SeamarkStyle(SeamarkKind.OTHER).shape)
	}

	@Test fun estimatedWidthsGrowWithTextAndSize() {
		val short = MapLabels.estimateWidth("Pier 11", 30f)
		assertTrue(short > 0f)
		assertTrue(MapLabels.estimateWidth("Pier 11 / Wall St", 30f) > short)
		assertTrue(MapLabels.estimateWidth("Pier 11", 40f) > short)
	}
}
