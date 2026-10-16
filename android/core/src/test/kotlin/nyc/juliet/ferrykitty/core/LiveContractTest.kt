package nyc.juliet.ferrykitty.core

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicitly opt-in deployment smoke; ordinary JVM regressions never use a live upstream. */
class LiveContractTest {
	@Test fun productionResponsesDecode() = runBlocking {
		assumeTrue("Set FERRY_LIVE_SMOKE=1 to check the deployed API", System.getenv("FERRY_LIVE_SMOKE") == "1")
		val transport = HTTPTransport()
		val roster = fetch<LandingRoster>(transport, "api/landings")
		assertFalse(roster.landings.isEmpty())
		val schedule = fetch<DisplayData>(transport, "api/display-data", mapOf("landingId" to roster.configured.toString()))
		schedule.validate(roster.configured)
		fetch<Realtime>(transport, "api/realtime", mapOf("landingId" to roster.configured.toString()))
		fetch<Alerts>(transport, "api/alerts")
		assertFalse(fetch<Harbor>(transport, "api/map").landings.isEmpty())
		fetch<Boats>(transport, "api/boats")
		fetch<Changelog>(transport, "api/changelog")
		val vessel = fetch<Vessels>(transport, "api/vessels").vessels.first()
		assertEquals(vessel.id, fetch<Ride>(transport, "api/ride", mapOf("vesselId" to vessel.id)).vessel.id)
		val trip = schedule.departures.first { !it.routeId.contains(':') && it.scheduleOnly != true }
		val id = trip.liveTripId ?: trip.tripId
		assertEquals(id, fetch<Connections>(transport, "api/connections", mapOf("tripId" to id)).tripId)
	}
	private suspend inline fun <reified T> fetch(transport: FerryTransport, path: String, query: Map<String, String> = emptyMap()): T =
		FerryJson.decode(transport.data(FerryEndpoint(path, query)))
}
