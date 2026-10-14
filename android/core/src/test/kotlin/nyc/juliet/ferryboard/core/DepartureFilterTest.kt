package nyc.juliet.ferryboard.core

import java.io.File
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class DepartureFilterTest {
	@Test fun homePortCrewAndOtherOutOfServiceMovementsAreIndependent() {
		val data = scheduleFixture()
		val home = data.departures.first { it.tripId == "home" }
		val crew = data.departures.first { it.crewShuttle == true }.copy(destination = "Pier C", outOfService = true)
		val tiedUp = data.departures.first().copy(outOfService = true)
		val noOOS = DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.OUT_OF_SERVICE))
		assertTrue(noOOS.isActive)
		assertTrue(noOOS.allows(home, "NYC Ferry"))
		assertTrue(noOOS.allows(crew, "NYC Ferry"))
		assertFalse(noOOS.allows(tiedUp, "NYC Ferry"))
		val noReturns = DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.PIER_C))
		assertFalse(noReturns.allows(home, "NYC Ferry"))
		assertTrue(noReturns.allows(crew, "NYC Ferry") && noReturns.allows(tiedUp, "NYC Ferry"))
		val noCrew = DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.CREW_SHUTTLE))
		assertTrue(noCrew.allows(home, "NYC Ferry"))
		assertFalse(noCrew.allows(crew, "NYC Ferry"))
		assertEquals(NYCFerryMovement.PIER_C, NYCFerryMovement.classify(home.copy(destination = "  pIeR c\n")))
		assertEquals(NYCFerryMovement.OUT_OF_SERVICE, NYCFerryMovement.classify(home.copy(fromHomePort = true)))
	}

	@Test fun operationalFiltersKeepPassengersAndPartnerArrivals() {
		val passenger = scheduleFixture().departures.first()
		val filters = DepartureFilters(hiddenNYCMovements = NYCFerryMovement.entries.toSet())
		assertTrue(filters.allows(passenger, "NYC Ferry"))
		assertTrue(filters.allows(passenger.copy(routeId = "wtr:ER", outOfService = true, arrival = true), "NY Waterway"))
		assertFalse(DepartureFilters().isActive)
	}

	@Test fun exactRouteNamespacesAndParentOperatorControlRemainSeparate() {
		val filters = DepartureFilters(hiddenRoutes = setOf("ER"))
		assertFalse(filters.allows("ER", "NYC Ferry"))
		assertTrue(filters.allows("wtr:ER", "NY Waterway"))
		val hidden = DepartureFilters(hiddenOperators = setOf("NYC Ferry"))
		for (row in scheduleFixture().departures) assertFalse(hidden.allows(row, "NYC Ferry"))
		assertTrue(hidden.allows("wtr:ER", "NY Waterway"))
	}

	@Test fun confirmedBundledSukkotReturnsAndCrewUseTheSameFilters() {
		val data: DisplayData = decode(File(repoRoot, "public/data/display-data.json").readText())
		val rows = ScheduleEngine.timeline(data, viewDate = "2026-09-30", now = Instant.parse("2026-09-29T04:00:00Z"))
		val returns = rows.filter { it.departure.serviceId == "nyc:sukkot:2026" && it.departure.outOfService == true && it.departure.destination == "Pier C" }
		val crew = rows.filter { it.departure.serviceId == "nyc:sukkot:2026" && it.departure.crewShuttle == true }
		assertFalse(returns.isEmpty())
		assertFalse(crew.isEmpty())
		for (row in returns) {
			assertFalse(DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.PIER_C)).allows(row.departure, "NYC Ferry"))
			assertTrue(DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.CREW_SHUTTLE, NYCFerryMovement.OUT_OF_SERVICE)).allows(row.departure, "NYC Ferry"))
		}
		for (row in crew) {
			assertFalse(DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.CREW_SHUTTLE)).allows(row.departure, "NYC Ferry"))
			assertTrue(DepartureFilters(hiddenNYCMovements = setOf(NYCFerryMovement.PIER_C, NYCFerryMovement.OUT_OF_SERVICE)).allows(row.departure, "NYC Ferry"))
		}
	}
}
