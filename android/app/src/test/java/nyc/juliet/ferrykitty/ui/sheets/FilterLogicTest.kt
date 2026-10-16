package nyc.juliet.ferrykitty.ui.sheets

import kotlinx.serialization.json.Json
import nyc.juliet.ferrykitty.core.Connection
import nyc.juliet.ferrykitty.core.DepartureFilters
import nyc.juliet.ferrykitty.core.DisplayData
import nyc.juliet.ferrykitty.core.LandingRoster
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterLogicTest {
	private val json = Json { ignoreUnknownKeys = true }
	private val schedule = json.decodeFromString<DisplayData>("""
		{"meta":{"schemaVersion":11,"landingNumber":16,"landing":{"displayName":"Pier 11"},"timezone":"America/New_York","departureWindowMinutes":180,"departuresShown":3},
		 "calendars":[],"exceptions":[],"routes":{"ER":{"name":"East River"},"CREW":{"name":"Crew shuttle"}},"departures":[],"tripSchedules":{}}
	""".trimIndent())

	@Test fun operatorRoutesIncludeOtherDocksWithoutDuplicatingCrewShuttles() {
		val roster = json.decodeFromString<LandingRoster>("""{"configured":16,"landings":[],"operators":["NYC Ferry","Seastreak"],
			"routes":{"sea:1":{"name":"Highlands","operator":"Seastreak"},"CREW":{"name":"Crew shuttle","operator":"NYC Ferry"}}}""")
		assertEquals(listOf("sea:1"), FilterLogic.routes("Seastreak", roster, schedule).map { it.first })
		assertEquals(listOf("ER"), FilterLogic.routes("NYC Ferry", roster, schedule).map { it.first })
		val older = json.decodeFromString<LandingRoster>("""{"configured":16,"landings":[],"operators":["NYC Ferry"]}""")
		assertEquals("Existing servers omit the catalog; the landing still supplies routes", listOf("ER"), FilterLogic.routes("NYC Ferry", older, schedule).map { it.first })
	}

	@Test fun routeNamesSortNaturally() {
		val roster = json.decodeFromString<LandingRoster>("""{"configured":1,"landings":[],"operators":["Waterway"],
			"routes":{"a":{"name":"Route 10","operator":"Waterway"},"b":{"name":"route 2","operator":"Waterway"},"c":{"name":"Belford","operator":"Waterway"}}}""")
		assertEquals(listOf("Belford", "route 2", "Route 10"), FilterLogic.routes("Waterway", roster, null).map { it.second.name })
	}

	@Test fun connectionsFollowTheBoardFilters() {
		val connection = json.decodeFromString<Connection>("""{"tripId":"c","routeId":"ER","departureTime":"10:00:00","seconds":36000,"destination":"Pier 11","operator":"NYC Ferry"}""")
		assertTrue(FilterLogic.visible(connection, DepartureFilters(), schedule))
		assertFalse(FilterLogic.visible(connection, DepartureFilters(hiddenRoutes = setOf("ER")), schedule))
		assertFalse(FilterLogic.visible(connection, DepartureFilters(hiddenOperators = setOf("NYC Ferry")), schedule))
		val partner = connection.copy(routeId = "sea:1", `operator` = null)
		assertFalse("Without an operator the schedule's agency applies", FilterLogic.visible(partner, DepartureFilters(hiddenOperators = setOf("NYC Ferry")), schedule))
	}

	@Test fun landingSearchMatchesNameOrNumberAndPutsFavoritesFirst() {
		val roster = json.decodeFromString<LandingRoster>("""{"configured":16,"operators":[],"landings":[
			{"id":16,"name":"Pier 11","displayName":"Pier 11 / Wall St"},{"id":26,"name":"Pier 79","displayName":"Midtown West / W 39th St – Pier 79"},
			{"id":4,"name":"Astoria","displayName":"Astoria"}]}""")
		assertEquals(listOf(26, 4, 16), FilterLogic.landings(roster.landings, "", favorites = setOf(26)).map { it.id })
		assertEquals(listOf(26), FilterLogic.landings(roster.landings, "79", favorites = emptySet()).map { it.id })
		assertEquals(listOf(16), FilterLogic.landings(roster.landings, "wall", favorites = emptySet()).map { it.id })
		assertEquals(listOf(4), FilterLogic.landings(roster.landings, " 4 ", favorites = emptySet()).map { it.id })
	}
}
