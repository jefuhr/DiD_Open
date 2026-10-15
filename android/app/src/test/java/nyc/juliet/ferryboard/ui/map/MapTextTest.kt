package nyc.juliet.ferryboard.ui.map

import nyc.juliet.ferryboard.core.Boat
import nyc.juliet.ferryboard.core.Boats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MapTextTest {
	private val opportunity = Boat(id = "opportunity", name = "Opportunity", number = "H-204", vesselId = "opportunity-vessel", latitude = 40.71, longitude = -74.0)

	@Test fun reportingLineNamesTheRouteAndCount() {
		assertEquals("2 reporting vessels", MapText.reporting(null, 2))
		assertEquals("ER · 1 reporting vessel", MapText.reporting("ER", 1))
		assertEquals("SB · 0 reporting vessels", MapText.reporting("SB", 0))
	}

	@Test fun feedIsLiveOnlyWhenPositionsAreFresh() {
		assertEquals("Live", MapText.feed(Boats(available = true, stale = false, boats = emptyList())))
		assertEquals("Saved / unavailable", MapText.feed(Boats(available = true, stale = true, boats = emptyList())))
		assertEquals("Saved / unavailable", MapText.feed(null))
	}

	@Test fun aWantedVesselThatIsNotReportingIsNamed() {
		assertEquals("McShane is not reporting a position right now.", MapText.notReporting("McShane", listOf(opportunity)))
		for (name in listOf("Opportunity", "H-204", "opportunity-vessel", "opportunity")) assertNull(name, MapText.notReporting(name, listOf(opportunity)))
		assertNull(MapText.notReporting(null, emptyList()))
		assertNull(MapText.notReporting("  ", emptyList()))
	}

	@Test fun emptyListsExplainWhy() {
		assertTrue(MapText.noVessels(total = 0, searching = false, routeFiltered = false).startsWith("No vessels are reporting"))
		assertEquals("No vessels match your search.", MapText.noVessels(total = 4, searching = true, routeFiltered = false))
		assertEquals("No vessels are reporting on this route right now.", MapText.noVessels(total = 4, searching = false, routeFiltered = true))
	}

	@Test fun canvasSummaryDescribesWhatIsDrawn() {
		val summary = MapText.summary(shown = 1, total = 2, live = true, landings = 2, route = "East River", marine = true, chart = ChartStatus.READY)
		assertEquals("Harbor map. 1 of 2 vessels shown, live positions. 2 landings. East River route. Marine references shown.", summary)
		val saved = MapText.summary(shown = 2, total = 2, live = false, landings = 0, route = null, marine = false, chart = ChartStatus.UNAVAILABLE)
		assertEquals("Harbor map. 2 vessels shown, last reported positions. 0 landings. All routes. Marine references hidden. Chart unavailable.", saved)
	}

	@Test fun landingNumbersAreSpelledOut() {
		assertEquals("Landing 16", MapText.landingNumber(16))
	}
}
