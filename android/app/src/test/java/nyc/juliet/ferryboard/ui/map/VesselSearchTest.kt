package nyc.juliet.ferryboard.ui.map

import nyc.juliet.ferryboard.core.Boat
import nyc.juliet.ferryboard.core.BoatStop
import nyc.juliet.ferryboard.ui.theme.ColorMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VesselSearchTest {
	private val opportunity = Boat(id = "opportunity", name = "Opportunity", number = "H-204", routeId = "ER", latitude = 40.71, longitude = -74.0,
		destination = "DUMBO", stop = BoatStop(name = "Wall St / Pier 11"))
	private val bayHopper = Boat(id = "bay-hopper", name = "Bay Hopper", number = "H-120", routeId = "SB", latitude = 40.72, longitude = -74.0,
		destination = "Bay Ridge")
	private val unknown = Boat(id = "x", name = "Unknown", number = null, latitude = 40.7, longitude = -74.0)

	@Test fun hullLabelsAreCompactAndHonestWhenMissing() {
		assertEquals("H204", VesselSearch.hullLabel("H-204"))
		assertEquals("H204", VesselSearch.hullLabel(" h-204 "))
		assertEquals("H1050", VesselSearch.hullLabel("H-1050"))
		assertEquals("?", VesselSearch.hullLabel(null))
		assertEquals("?", VesselSearch.hullLabel("  "))
	}

	@Test fun hullSearchAcceptsEitherSpelling() {
		for (query in listOf("H204", "H-204", "h204", "204")) {
			assertEquals(query, listOf(opportunity), VesselSearch.filter(listOf(opportunity, bayHopper), query, routeFilter = null))
		}
	}

	@Test fun hullSearchAcceptsEitherSpellingWhateverTheFeedSends() {
		// The feed falls back to its own label ("H204") when the fleet list does not know a vessel.
		val feedLabel = opportunity.copy(number = "H204")
		for (query in listOf("H204", "H-204", "h-204", " H-20 ", "204")) {
			assertEquals(query, listOf(feedLabel), VesselSearch.filter(listOf(feedLabel, bayHopper), query, routeFilter = null))
		}
		assertTrue("A lone dash is not a hull search", VesselSearch.filter(listOf(feedLabel), "-", routeFilter = null).isEmpty())
	}

	@Test fun searchCoversNameDestinationAndStop() {
		assertTrue(VesselSearch.matches(opportunity, "oppor"))
		assertTrue(VesselSearch.matches(opportunity, "dumbo"))
		assertTrue(VesselSearch.matches(opportunity, "pier 11"))
		assertTrue(VesselSearch.matches(bayHopper, "  bay ridge "))
		assertFalse(VesselSearch.matches(bayHopper, "dumbo"))
		assertTrue("An empty search keeps every vessel", VesselSearch.matches(unknown, ""))
	}

	@Test fun routeFilterNarrowsTheFleet() {
		assertEquals(listOf(bayHopper), VesselSearch.filter(listOf(opportunity, bayHopper, unknown), "", routeFilter = "SB"))
		assertEquals(listOf(opportunity, bayHopper, unknown), VesselSearch.filter(listOf(opportunity, bayHopper, unknown), "", routeFilter = null))
	}

	@Test fun staleFixesAreFlagged() {
		assertFalse(VesselSearch.isStale(opportunity.copy(ageSeconds = 30.0), feedStale = false))
		assertTrue(VesselSearch.isStale(opportunity.copy(ageSeconds = 181.0), feedStale = false))
		assertTrue(VesselSearch.isStale(opportunity.copy(ageSeconds = 5.0), feedStale = true))
		assertFalse("A missing age is not invented as stale", VesselSearch.isStale(opportunity.copy(ageSeconds = null), feedStale = false))
	}

	@Test fun readableTextOnRouteColors() {
		assertEquals(VesselSearch.LIGHT_TEXT, VesselSearch.textOn("#0070AB"))
		assertEquals(VesselSearch.DARK_TEXT, VesselSearch.textOn("#FFD100"))
		assertEquals("Unknown colors fall back to the neutral marker", VesselSearch.LIGHT_TEXT, VesselSearch.textOn(null))
	}

	@Test fun staleMarkersFadeTowardTheWaterAndKeepReadableText() {
		val water = 0xFFE3F0F7
		assertEquals(0xFF0070AB, VesselSearch.markerFill(opportunity.copy(color = "#0070AB"), stale = false, background = water))
		val faded = VesselSearch.markerFill(opportunity.copy(color = "#0070AB"), stale = true, background = water)
		assertTrue("Faded toward the light water", ColorMath.luminance(faded) > ColorMath.luminance(0xFF0070AB))
		assertTrue(ColorMath.contrast(VesselSearch.markerText(faded), faded) >= 3.0)
		val night = 0xFF0B1522
		val dim = VesselSearch.markerFill(opportunity.copy(color = "#FFD100"), stale = true, background = night)
		assertTrue(ColorMath.contrast(VesselSearch.markerText(dim), dim) >= 3.0)
	}

	@Test fun listLinesSayWhatTheBoatIsDoingWithoutRepeatingThePlace() {
		assertEquals("Next stop Wall St / Pier 11 · to DUMBO", VesselSearch.doing(opportunity))
		assertEquals("Arriving at Dumbo", VesselSearch.doing(opportunity.copy(stop = BoatStop(name = "Dumbo"), status = "incoming")))
		assertEquals("Under way · to Bay Ridge", VesselSearch.doing(bayHopper))
	}

	@Test fun statusLineNamesWhereTheBoatIs() {
		assertEquals("Next stop Wall St / Pier 11", VesselSearch.statusLine(opportunity))
		assertEquals("Alongside at Wall St / Pier 11", VesselSearch.statusLine(opportunity.copy(status = "stopped")))
		assertEquals("Arriving at Wall St / Pier 11", VesselSearch.statusLine(opportunity.copy(status = "incoming")))
		assertEquals("Under way", VesselSearch.statusLine(bayHopper))
		assertEquals("Alongside", VesselSearch.statusLine(bayHopper.copy(status = "stopped")))
	}
}
