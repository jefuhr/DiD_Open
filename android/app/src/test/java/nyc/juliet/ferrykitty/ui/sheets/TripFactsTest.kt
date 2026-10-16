package nyc.juliet.ferrykitty.ui.sheets

import kotlinx.serialization.json.Json
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.contract.TripDetail
import nyc.juliet.ferrykitty.core.Connections
import nyc.juliet.ferrykitty.core.DisplayData
import nyc.juliet.ferrykitty.core.Realtime
import nyc.juliet.ferrykitty.core.ScheduleEngine
import nyc.juliet.ferrykitty.core.ScheduledDeparture
import nyc.juliet.ferrykitty.core.TripCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** The iOS TripView rules, run against the iOS preview fixtures at the shared fixed clock. */
class TripFactsTest {
	private val json = Json { ignoreUnknownKeys = true }
	private val now = Instant.parse("2026-09-04T12:50:00Z")

	private fun fixture(name: String): String {
		var directory: File? = File("").absoluteFile
		while (directory != null) {
			val candidate = File(directory, "ios/FerryKitty/PreviewData/$name")
			if (candidate.isFile) return candidate.readText()
			directory = directory.parentFile
		}
		error("ios/FerryKitty/PreviewData/$name not found")
	}

	private val schedule = json.decodeFromString<DisplayData>(fixture("schedule-16.json"))
	private val realtime = json.decodeFromString<Realtime>(fixture("realtime.json"))
	private val connections = json.decodeFromString<Connections>(fixture("connections.json"))

	private fun row(tripId: String, realtime: Realtime = this.realtime, viewDate: String? = null): ScheduledDeparture =
		ScheduleEngine.timeline(schedule, realtime, viewDate, now).first { it.departure.tripId == tripId }

	private fun facts(row: ScheduledDeparture, realtime: Realtime = this.realtime, connections: Connections? = null, at: Instant = now) =
		TripFacts(FerryUiState(schedule = schedule, realtime = realtime, now = at, trip = TripDetail(row, schedule, connections)), row, schedule)

	@Test fun theSelectedCallMatchesTheRowsOwnTime() {
		val facts = facts(row("nine"))
		assertEquals(listOf(1, 2), facts.calls.map { it.sequence })
		assertEquals(1, facts.selectedSequence)
	}

	@Test fun aConfirmedVehicleNamesTheVesselAndAllowsARide() {
		val facts = facts(row("nine"))
		assertTrue(facts.live)
		assertEquals(DisplayedVessel("Opportunity", predicted = false, saved = false), facts.vessel)
		assertTrue(facts.canRide)
	}

	@Test fun duringAnOutageTheSavedAssignmentIsLabelledSaved() {
		val saved = realtime.copy(stale = true, vehicles = emptyList())
		val row = row("nine", realtime).copy(boatName = "Opportunity")
		assertEquals(DisplayedVessel("Opportunity", predicted = false, saved = true), facts(row, saved).vessel)
		val fresh = realtime.copy(vehicles = emptyList())
		assertNull("A fresh feed that cleared the assignment clears the name", facts(row, fresh).vessel)
	}

	@Test fun partnerAndBusTripsCannotStartARide() {
		val nine = row("nine")
		assertFalse(facts(nine.copy(departure = nine.departure.copy(routeId = "sea:1"))).canRide)
		assertFalse(facts(nine.copy(departure = nine.departure.copy(mode = "bus"))).canRide)
	}

	@Test fun browsedDatesAreNotLive() {
		val browsed = row("nine", viewDate = "2026-09-05")
		val facts = facts(browsed)
		assertFalse(facts.live)
		assertNull(facts.vessel)
		assertFalse(facts.canRide)
		assertEquals("Connections are shown for today only.", facts.note(loading = false, rootNote = null))
	}

	@Test fun connectionNotesAreHonestAboutTheirSource() {
		val nine = row("nine")
		assertEquals("Checking connections…", facts(nine).note(loading = true, rootNote = null))
		assertEquals("Connections unavailable. Showing the trip’s published stops.", facts(nine).note(loading = false, rootNote = null))
		assertEquals("Root notes win while connections are missing", "Connections need a refresh.",
			facts(nine).note(loading = false, rootNote = "Connections need a refresh."))
		val usable = facts(nine, connections = connections)
		assertTrue(usable.freshConnections)
		assertNull(usable.note(loading = false, rootNote = null))
		assertEquals(33120.0, usable.matching(usable.calls[1])?.estimatedArrivalSeconds ?: 0.0, 0.0)
		val saved = facts(nine, connections = connections.copy(stale = true))
		assertFalse(saved.freshConnections)
		assertEquals("Saved connections · times shown as scheduled", saved.note(loading = false, rootNote = null))
		val late = facts(nine, connections = connections, at = now.plusSeconds(301))
		assertNull("Connections older than five minutes are not used", late.connections)
	}

	@Test fun timetableOnlyTripsSaySo() {
		val nine = row("nine")
		val timetable = nine.copy(departure = nine.departure.copy(timetableOnly = true))
		assertEquals("Published stop times. Live arrival estimates and through-trip connections are unavailable.",
			facts(timetable).note(loading = false, rootNote = null))
	}

	@Test fun boardingRestrictionsMatchIos() {
		val facts = facts(row("nine"))
		fun call(pickup: Int?, dropOff: Int?) = TripCall(stopId = "1", sequence = 1, pickupType = pickup, dropOffType = dropOff)
		assertEquals("DROP OFF ONLY", facts.restriction(call(1, 0)))
		assertEquals("PICKUP ONLY", facts.restriction(call(0, 1)))
		assertEquals("NO PICKUP · NO DROP-OFF", facts.restriction(call(1, 1)))
		assertEquals("NO PICKUP", facts.restriction(call(1, null)))
		assertNull(facts.restriction(call(0, 0)))
	}

	@Test fun dwellNeedsTheSettingAndBothClocks() {
		val shown = schedule.copy(meta = schedule.meta.copy(showDwellTimes = true))
		val row = row("nine")
		val facts = TripFacts(FerryUiState(schedule = shown, realtime = realtime, now = now), row, shown)
		assertEquals(1, facts.dwellMinutes(TripCall("1", 1, arrivalSeconds = 32400.0, departureSeconds = 32460.0)))
		assertNull(facts.dwellMinutes(TripCall("1", 1, arrivalSeconds = 32400.0)))
		assertNull("A departure before its arrival is not a dwell", facts.dwellMinutes(TripCall("1", 1, arrivalSeconds = 32460.0, departureSeconds = 32400.0)))
		val hidden = shown.copy(meta = shown.meta.copy(showDwellTimes = false))
		assertNull(TripFacts(FerryUiState(schedule = hidden, now = now), row, hidden).dwellMinutes(TripCall("1", 1, arrivalSeconds = 32400.0, departureSeconds = 32460.0)))
	}
}
