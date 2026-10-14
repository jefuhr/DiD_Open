package nyc.juliet.ferryboard.core

import java.io.File
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

internal val testJson = Json { ignoreUnknownKeys = true }
internal val repoRoot = File(requireNotNull(System.getProperty("ferry.repo.root")))
internal inline fun <reified T> decode(text: String): T = testJson.decodeFromString(text)
internal fun scheduleFixture(): DisplayData = fixture().schedule
private fun fixture(): ScheduleContract = decode(File(repoRoot, "test/fixtures/schedule-contract.json").readText())
internal val fixtureNow: Instant = Instant.parse("2026-09-04T12:50:00Z")

@Serializable
private data class ScheduleContract(
	val schedule: DisplayData,
	val cases: List<Scenario>,
	val timezones: List<ClockCase>,
) {
	@Serializable data class Scenario(val id: String, val now: String, val viewDate: String? = null, val realtime: Realtime, val expected: List<Expected>)
	@Serializable data class ClockCase(val now: String, val dateKey: String, val seconds: Double)
	@Serializable data class Expected(
		val tripId: String, val serviceDate: String, val delay: Double, val hasLiveTiming: Boolean,
		val boatName: String? = null, val predictedBoatName: String? = null, val isLastOfDay: Boolean,
	) {
		constructor(row: ScheduledDeparture) : this(row.departure.tripId, row.serviceDate, row.delay, row.hasLiveTiming,
			row.boatName, row.predictedBoatName, row.isLastOfDay)
	}
}

class ScheduleContractTest {
	@Test fun allCanonicalScheduleCasesMatchInOrder() {
		val contract = fixture()
		contract.schedule.validate(16)
		for (case in contract.cases) {
			val actual = ScheduleEngine.timeline(contract.schedule, case.realtime, case.viewDate, Instant.parse(case.now))
			assertEquals(case.id, case.expected, actual.map { ScheduleContract.Expected(it) })
		}
		println("Canonical schedule contract: ${contract.cases.size} cases")
	}

	@Test fun bothDaylightSavingTransitionsUseLocalServiceClock() {
		for (case in fixture().timezones) {
			val actual = ServiceClock.parts(Instant.parse(case.now))
			assertEquals(case.now, case.dateKey, actual.dateKey)
			assertEquals(case.seconds, actual.seconds, 0.0)
		}
	}
}
