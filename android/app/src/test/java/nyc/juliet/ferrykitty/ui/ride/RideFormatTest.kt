package nyc.juliet.ferrykitty.ui.ride

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import nyc.juliet.ferrykitty.core.RideStop

class RideFormatTest {
	private fun stop(pickupType: Int? = null, dropOffType: Int? = null) =
		RideStop(stopId = "s", sequence = 1, name = "Pier 11", pickupType = pickupType, dropOffType = dropOffType, skipped = false, current = false, past = false)

	@Test fun clocksUseTheRideTimezone() {
		val instant = Instant.parse("2026-09-04T13:03:00Z")
		assertEquals("09:03", RideFormat.time(instant, "America/New_York", twelveHour = false))
		assertEquals("9:03 AM", RideFormat.time(instant, "America/New_York", twelveHour = true))
		assertEquals("A missing time is a dash, never a guess", "—", RideFormat.time(null, "America/New_York", twelveHour = false))
	}

	@Test fun durationsKeepSecondsWhenShort() {
		assertEquals("45 sec", RideFormat.duration(45.0))
		assertEquals("5 min", RideFormat.duration(300.0))
		assertEquals("5m 30s", RideFormat.duration(330.0))
		assertEquals("0 sec", RideFormat.duration(-12.0))
	}

	@Test fun serviceRestrictionsMatchIos() {
		assertEquals("No pickup or drop-off", RideFormat.service(stop(1, 1)))
		assertEquals("Pickup only", RideFormat.service(stop(0, 1)))
		assertEquals("Final drop-off", RideFormat.service(stop(0, 0), final = true))
		assertEquals("Drop-off only", RideFormat.service(stop(1, 0)))
		assertNull(RideFormat.service(stop(0, 0)))
	}

	@Test fun tripStatesReadPlainly() {
		assertEquals("Assignment changed", RideFormat.tripState("reassigned"))
		assertEquals("Current", RideFormat.tripState("current"))
		assertEquals("Completed", RideFormat.tripState("completed"))
	}

	@Test fun countdownRoundsUpAndNeverGoesNegative() {
		val now = Instant.parse("2026-09-04T12:50:00Z")
		assertEquals("Arrival in 3 min", RideFormat.countdown(arrival = true, at = Instant.parse("2026-09-04T12:52:01Z"), now = now))
		assertEquals("Departure due now", RideFormat.countdown(arrival = false, at = Instant.parse("2026-09-04T12:49:00Z"), now = now))
	}
}
