package nyc.juliet.ferryboard.core

import org.junit.Assert.*
import org.junit.Test

class WidgetParityTest {
	private fun feed() = Realtime(available = true, stale = false, fetchedAt = fixtureNow.toString(), vehiclesStale = false,
		updates = listOf(TripUpdate("nine", "1", delaySeconds = 120.0)), vehicles = listOf(VehicleAssignment("nine", boatName = "Opportunity")))
	private fun rows(data: DisplayData = scheduleFixture(), options: WidgetOptions = WidgetOptions(), realtime: Realtime = Realtime.empty) =
		NearbyWidgetBoard.departures(data, realtime, fixtureNow, fixtureNow, options)

	@Test fun nearestMovesAndRejectsInvalidCoordinates() {
		val landings = listOf(Landing(16, "Pier 11", "Wall St", 40.703161, -74.006144), Landing(26, "Pier 79", "Midtown", 40.760323, -74.004075),
			Landing(1, "Missing", "Missing"), Landing(2, "Invalid", "Invalid", 100.0, -74.0))
		assertEquals(16, NearbyWidgetBoard.nearest(landings, 40.704, -74.005)?.id)
		assertEquals(26, NearbyWidgetBoard.nearest(landings, 40.760, -74.003)?.id)
		assertNull(NearbyWidgetBoard.nearest(landings, Double.NaN, -74.0))
		assertNull(NearbyWidgetBoard.nearest(landings, 40.0, 181.0))
		assertNull(NearbyWidgetBoard.nearest(emptyList(), 40.0, -74.0))
	}

	@Test fun locationLifetimeRejectsOldAndFutureTimesAtExactBoundary() {
		assertTrue(NearbyWidgetBoard.usableLocation(fixtureNow.minusSeconds(21600), fixtureNow))
		assertFalse(NearbyWidgetBoard.usableLocation(fixtureNow.minusSeconds(21601), fixtureNow))
		assertFalse(NearbyWidgetBoard.usableLocation(fixtureNow.plusNanos(1), fixtureNow))
	}

	@Test fun feedAndReceiptLifetimesAreBothRequiredAndVehiclesExpireIndependently() {
		val feed = feed()
		assertFalse(NearbyWidgetBoard.freshRealtime(feed, fixtureNow.minusSeconds(300), fixtureNow).stale)
		for (receipt in listOf(null, fixtureNow.minusSeconds(301), fixtureNow.plusNanos(1)))
			assertTrue(NearbyWidgetBoard.freshRealtime(feed, receipt, fixtureNow).stale)
		for (fetched in listOf(null, "broken", fixtureNow.minusSeconds(301).toString(), fixtureNow.plusNanos(1).toString()))
			assertTrue(NearbyWidgetBoard.freshRealtime(feed.copy(fetchedAt = fetched), fixtureNow, fixtureNow).stale)
		assertTrue(NearbyWidgetBoard.freshRealtime(feed.copy(stale = true), fixtureNow, fixtureNow).stale)
		assertTrue(NearbyWidgetBoard.freshRealtime(feed.copy(available = false), fixtureNow, fixtureNow).stale)
		val vehicleStale = NearbyWidgetBoard.freshRealtime(feed.copy(vehiclesStale = true), fixtureNow, fixtureNow)
		assertTrue(vehicleStale.vehicles.orEmpty().isEmpty())
		assertEquals(feed.updates, vehicleStale.updates)
		assertFalse(vehicleStale.stale)
	}

	@Test fun timingAndBoatNamesExpireWithoutNetworkReload() {
		val fresh = rows(realtime = feed()).first()
		assertEquals("09:02", fresh.time)
		assertTrue(fresh.estimated)
		assertTrue(fresh.detail.contains("Opportunity"))
		val old = NearbyWidgetBoard.departures(scheduleFixture(), feed(), fixtureNow, fixtureNow.plusSeconds(301))
		assertEquals("09:00", old.first().time)
		assertFalse(old.first().estimated)
		assertFalse(old.any { it.detail.contains("Opportunity") })
	}

	@Test fun filteringPrecedesCapacityAndPerRouteLimit() {
		val data = scheduleFixture()
		val template = data.departures.first()
		val capacity = data.copy(departures = (0..15).map { index -> template.copy(tripId = "capacity-$index", seconds = 32400.0 + index * 60,
			`operator` = if (index == 15) "NY Waterway" else "NYC Ferry") })
		val visible = rows(capacity, WidgetOptions(hiddenOperators = setOf("NYC Ferry")))
		assertEquals(1, visible.size)
		assertTrue(visible.single().id.contains("capacity-15"))
		val crewFirst = data.copy(departures = data.departures.take(2).mapIndexed { i, departure -> departure.copy(crewShuttle = i == 0) })
		val options = WidgetOptions(sortByRoute = true, departuresPerRoute = 1, hiddenNYCMovements = setOf(NYCFerryMovement.CREW_SHUTTLE))
		assertTrue(rows(crewFirst, options).single().id.contains("|ten|"))
		assertTrue(rows(crewFirst, options.copy(departureWindowMinutes = 30)).isEmpty())
		assertTrue(rows(crewFirst, options.copy(hiddenRoutes = setOf("ER"))).isEmpty())
	}

	@Test fun workingAssignmentsAndVesselNamesHaveIndependentVisibility() {
		val noNames = rows(options = WidgetOptions(showBoatNames = false), realtime = feed())
		assertTrue(noNames.first().detail.contains("ER1"))
		assertFalse(noNames.any { it.detail.contains("Opportunity") || it.detail.contains("Pred.") })
		val noAssignments = rows(options = WidgetOptions(showAssignments = false), realtime = feed())
		assertTrue(noAssignments.first().detail.contains("Opportunity"))
		assertFalse(noAssignments.first().detail.contains("ER1"))
	}

	@Test fun pausesClockAndOperationalDetailsSurviveProjection() {
		val data = scheduleFixture().let { it.copy(tripSchedules = it.tripSchedules + ("nine" to TripSchedule(
			listOf(TripCall("1", 1, arrivalSeconds = 32220.0, departureSeconds = 32400.0)), turnaround = Turnaround(scheduledLayoverSeconds = 600.0)))) }
		val rows = rows(data)
		assertTrue(rows.first().detail.contains("Dwell 3m"))
		assertTrue(rows.first().detail.contains("Turn 10m"))
		assertTrue(rows.any { it.detail.contains("TO PIER C") })
		assertTrue(rows.any { it.detail.contains("CREW") })
		val hidden = rows(data, WidgetOptions(showDwells = false, showLayovers = false, twelveHour = true))
		assertFalse(hidden.first().detail.contains("Dwell") || hidden.first().detail.contains("Turn"))
		assertEquals("9:00 AM", hidden.first().time)
		assertFalse(NearbyWidgetBoard.departures(data, Realtime.empty, null, fixtureNow.plusSeconds(720)).any { it.id.contains("|nine|") })
	}

	@Test fun olderSettingsKeepKnownIndividualChoicesAndIgnoreFutureValues() {
		val options: WidgetOptions = decode("""{"showBoatNames":false,"hiddenOperators":["Seastreak"],"hiddenNYCMovements":["crewShuttle","future"],"departureWindowMinutes":-2,"departuresPerRoute":100}""")
		assertFalse(options.showBoatNames)
		assertTrue(options.automaticLanding && options.showAssignments)
		assertEquals(setOf("Seastreak"), options.hiddenOperators)
		assertEquals(setOf(NYCFerryMovement.CREW_SHUTTLE), options.hiddenNYCMovements)
		assertEquals(0, options.departureWindowMinutes)
		assertEquals(0, options.departuresPerRoute)
		assertEquals(options, testJson.decodeFromString<WidgetOptions>(testJson.encodeToString(WidgetOptions.serializer(), options)))
	}

	@Test fun malformedIndividualSettingsFallBackWithoutDiscardingValidChoices() {
		val options: WidgetOptions = decode("""{"automaticLanding":"no","showAssignments":false,"showBoatNames":7,"landingId":16,"theme":"nyc-ferry"}""")
		assertTrue(options.automaticLanding && options.showBoatNames)
		assertFalse(options.showAssignments)
		assertEquals(16, options.landingId)
		assertEquals("nyc-ferry", options.theme)
	}

	@Test fun capacityAndFitCandidatesMatchWidgetContract() {
		val data = scheduleFixture()
		assertEquals(NearbyWidgetBoard.maximumRows, rows(data.copy(departures = (0..19).map { data.departures.first().copy(tripId = "fill-$it", seconds = 32400.0 + it * 120) })).size)
		assertEquals(listOf(3, 2, 1), NearbyWidgetBoard.fitCandidates(12, 3))
		assertEquals(listOf(2, 1), NearbyWidgetBoard.fitCandidates(2, 4))
		assertEquals(listOf(1), NearbyWidgetBoard.fitCandidates(0, 4))
		assertEquals(listOf(1), NearbyWidgetBoard.fitCandidates(5, 0))
	}

	@Test fun widgetLinksAcceptOnlyKnownLandingAndNearbyActions() {
		assertEquals(FerryWidgetLink.Landing(16), FerryWidgetLink.parse("ferryboard://landing/16"))
		assertEquals(FerryWidgetLink.Nearby, FerryWidgetLink.parse("ferryboard://nearby"))
		for (text in listOf("https://landing/16", "ferryboard://landing/-1", "ferryboard://landing/nope", "ferryboard://landing/16/other", "ferryboard://unknown"))
			assertNull(FerryWidgetLink.parse(text))
	}
}
