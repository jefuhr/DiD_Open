package nyc.juliet.ferryboard.platform

import kotlinx.coroutines.test.*
import nyc.juliet.ferryboard.core.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant

/** Failure modes: revoked permission retaining coordinates, stale estimates, and independent fixed landings. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class WidgetDataSourceTest {
	@get:Rule val temporary = TemporaryFolder()
	private val now = Instant.parse("2026-09-04T12:50:00Z")
	private fun fixture(name: String): ByteArray {
		val root = generateSequence(File(System.getProperty("ferry.repo.root", System.getProperty("user.dir")))) { it.parentFile }.first { File(it, "ios/FerryBoard/PreviewData").isDirectory }
		return File(root, "ios/FerryBoard/PreviewData/$name.json").readBytes()
	}
	private val transport = object : FerryTransport {
		override suspend fun data(endpoint: FerryEndpoint): ByteArray = fixture(if (endpoint.path == "api/display-data") "schedule-${endpoint.parameters["landingId"]}" else endpoint.path.removePrefix("api/"))
	}

	@Test fun revokedGrantDeletesSavedAutomaticLandingEvenOffline() = runTest {
		val storage = WidgetSettingsStore(MemoryFerrySettings())
		storage.saveLastLanding(LastWidgetLanding(16, "Pier 11", now.toEpochMilli()))
		val repository = FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { now })
		val result = WidgetDataSource(repository, storage, { now }).presentation(WidgetOptions(), false, null, network = false)
		assertNull(storage.lastLanding()); assertNull(result.landingId); assertTrue(result.rows.isEmpty())
		assertTrue(result.message!!.contains("not allowed"))
	}

	@Test fun fixedLandingIgnoresDeniedLocationAndUsesSharedCoreRows() = runTest {
		val storage = WidgetSettingsStore(MemoryFerrySettings())
		val repo = FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { now })
		val source = WidgetDataSource(repo, storage, { now })
		val fixed = WidgetOptions(automaticLanding = false, landingId = 16)
		val result = source.presentation(fixed, false, LocationResult.NotAuthorized, network = true)
		assertEquals(16, result.landingId); assertEquals("Fixed landing", result.locationLabel)
		val schedule = FerryJson.decode<DisplayData>(fixture("schedule-16"))
		val realtime = FerryJson.decode<Realtime>(fixture("realtime"))
		assertEquals(NearbyWidgetBoard.departures(schedule, realtime, now, now, fixed), result.rows)
		assertFalse(result.saved); assertEquals(now, result.updatedAt)
		assertEquals(now.plusSeconds(300), result.expiresAt)
		assertEquals(now, result.estimatesAt)
		val other = source.presentation(fixed.copy(landingId = 26), false, null, network = true)
		assertEquals(26, other.landingId); assertEquals(16, result.landingId)
	}

	@Test fun cachedRowsLoseEstimatesAndLastLocationExpiresAfterSixHours() = runTest {
		var time = now
		val storage = WidgetSettingsStore(MemoryFerrySettings())
		storage.saveLastLanding(LastWidgetLanding(16, "Pier 11", now.toEpochMilli()))
		val repo = FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { time })
		val source = WidgetDataSource(repo, storage, { time })
		source.presentation(WidgetOptions(automaticLanding = false, landingId = 16), false, null, network = true)
		time = now.plusSeconds(301)
		val cached = source.presentation(WidgetOptions(), true, LocationResult.Unavailable, network = false)
		assertEquals(16, cached.landingId); assertTrue(cached.saved)
		assertEquals("Last location · waiting for GPS", cached.locationLabel)
		assertFalse(cached.rows.any { it.estimated })
		assertEquals(now, cached.updatedAt)
		time = now.plusSeconds(21_601)
		val expired = source.presentation(WidgetOptions(), true, LocationResult.Unavailable, network = false)
		assertNull(expired.landingId); assertTrue(expired.rows.isEmpty())
	}

	@Test fun offlineConfigurationReprojectsCachedLandingAndFilters() = runTest {
		val storage = WidgetSettingsStore(MemoryFerrySettings())
		val repo = FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { now })
		val source = WidgetDataSource(repo, storage, { now })
		source.presentation(WidgetOptions(automaticLanding = false, landingId = 16), false, null, network = true)
		source.presentation(WidgetOptions(automaticLanding = false, landingId = 26), false, null, network = true)
		storage.save(1, WidgetSettings(false, WidgetOptions(automaticLanding = false, landingId = 26, hiddenOperators = setOf("NYC Ferry"))))
		val changed = source.presentation(storage.options(1), false, null, network = false)
		assertEquals(26, changed.landingId)
		assertTrue(changed.rows.isEmpty()); assertTrue(changed.message!!.contains("filters"))
		storage.save(1, WidgetSettings(false, storage.options(1).copy(hiddenOperators = emptySet())))
		val visible = source.presentation(storage.options(1), false, null, network = false)
		assertEquals(26, visible.landingId); assertTrue(visible.rows.isNotEmpty())
		assertTrue(visible.saved); assertFalse(visible.rows.any { it.estimated })
	}
}
