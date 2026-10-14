package nyc.juliet.ferryboard.platform

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.test.*
import kotlinx.coroutines.withContext
import nyc.juliet.ferryboard.contract.*
import nyc.juliet.ferryboard.core.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant

/** Failure modes: transports ignoring cancellation, stale lifecycle work, and persisted ride resurrection. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class FerryStateStoreTest {
	@get:Rule val temporary = TemporaryFolder()
	private val now = Instant.parse("2026-09-04T12:50:00Z")
	private fun fixture(name: String): ByteArray {
		val root = generateSequence(File(System.getProperty("ferry.repo.root", System.getProperty("user.dir")))) { it.parentFile }
			.first { File(it, "ios/FerryBoard/PreviewData").isDirectory }
		return File(root, "ios/FerryBoard/PreviewData/$name.json").readBytes()
	}
	private class DelayedTransport : FerryTransport {
		val pending = mutableMapOf<String, CompletableDeferred<ByteArray>>()
		override suspend fun data(endpoint: FerryEndpoint): ByteArray {
			if (endpoint.path !in setOf("api/display-data", "api/ride", "api/boats", "api/connections")) error("Offline")
			return withContext(NonCancellable) {
				pending.getOrPut(endpoint.cacheKey) { CompletableDeferred() }.await()
			}
		}
		fun reply(endpoint: FerryEndpoint, bytes: ByteArray) { pending.getValue(endpoint.cacheKey).complete(bytes) }
		fun finish() { pending.values.forEach { if (!it.isCompleted) it.completeExceptionally(IllegalStateException("Offline")) } }
	}
	private fun TestScope.store(transport: FerryTransport, settings: FerrySettings = MemoryFerrySettings()): FerryStateStore =
		FerryStateStore(FerryRepository(transport, SnapshotCache(temporary.newFolder(), ioDispatcher = StandardTestDispatcher(testScheduler)), clock = { now }), settings, backgroundScope, { now })
	private val landing16 = FerryEndpoint("api/display-data", mapOf("landingId" to "16"))
	private val landing26 = FerryEndpoint("api/display-data", mapOf("landingId" to "26"))
	private fun ride(id: String) = FerryEndpoint("api/ride", mapOf("vesselId" to id))

	@Test fun everyExplicitFindBoatRequestHasItsOwnIdentity() = runTest {
		val model = store(object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray = error("Offline")
		})
		model.dispatch(FerryAction.FindBoat("Opportunity"))
		val first = model.state.value.boatFocusRequest
		assertNotNull(first)
		model.dispatch(FerryAction.SelectTab(FerryTab.DEPARTURES))
		model.dispatch(FerryAction.SelectTab(FerryTab.MAP))
		assertEquals(first, model.state.value.boatFocusRequest)
		model.dispatch(FerryAction.FindBoat("Opportunity"))
		assertNotEquals(first, model.state.value.boatFocusRequest)
		model.dispatch(FerryAction.OpenBoat("opportunity"))
		assertNull(model.state.value.boatFocusRequest)
	}

	@Test fun lateLandingCannotReplaceNewSelection() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true); model.dispatch(FerryAction.SelectLanding(16)); runCurrent()
		model.dispatch(FerryAction.SelectLanding(26)); runCurrent()
		transport.reply(landing26, fixture("schedule-26")); runCurrent()
		transport.reply(landing16, fixture("schedule-16")); runCurrent()
		assertEquals(26, model.state.value.preferences.landingId)
		assertEquals(26, model.state.value.schedule?.meta?.landingNumber)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun lateBoatCannotReplaceNewRide() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true)
		model.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity"))); runCurrent()
		model.dispatch(FerryAction.StartRide(Vessel("bay-hopper", "Bay Hopper"))); runCurrent()
		transport.reply(ride("bay-hopper"), fixture("ride-bay-hopper")); runCurrent()
		transport.reply(ride("opportunity"), fixture("ride-opportunity")); runCurrent()
		assertEquals("bay-hopper", model.state.value.ride?.vessel?.id)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun exitInvalidatesRideAndPersistsThroughRelaunch() = runTest {
		val transport = DelayedTransport(); val settings = MemoryFerrySettings(); val model = store(transport, settings)
		model.setActive(true); model.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity"))); runCurrent()
		model.dispatch(FerryAction.ExitRide)
		transport.reply(ride("opportunity"), fixture("ride-opportunity")); runCurrent()
		assertNull(model.state.value.ride); assertNull(model.state.value.rideSession)
		assertFalse(model.state.value.showingRide)
		val relaunched = store(transport, settings)
		assertNull(relaunched.state.value.rideSession)
		model.close(); relaunched.close(); transport.finish(); runCurrent()
	}

	@Test fun backgroundResponseCannotBecomeLive() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true); model.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity"))); runCurrent()
		model.setActive(false)
		transport.reply(ride("opportunity"), fixture("ride-opportunity")); runCurrent()
		assertNull(model.state.value.ride)
		assertTrue(model.state.value.realtime.stale)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun minimizeAndRestoreKeepsFullRideHistory() = runTest {
		val transport = DelayedTransport(); val settings = MemoryFerrySettings(); val model = store(transport, settings)
		model.setActive(true); model.dispatch(FerryAction.SelectTab(FerryTab.MAP))
		model.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity"))); runCurrent()
		transport.reply(ride("opportunity"), fixture("ride-opportunity")); runCurrent()
		val source = FerryJson.decode<Ride>(fixture("ride-opportunity"))
		assertEquals(source.trips.size, model.state.value.ride?.trips?.size)
		model.dispatch(FerryAction.MinimizeRide)
		assertFalse(model.state.value.showingRide); assertEquals(FerryTab.MAP, model.state.value.tab)
		val restored = store(transport, settings)
		assertEquals("opportunity", restored.state.value.rideSession?.vessel?.id)
		model.close(); restored.close(); transport.finish(); runCurrent()
	}

	@Test fun cachedRideRestoresBeforeUnrelatedStartupNetwork() = runTest {
		val transport = DelayedTransport(); val settings = MemoryFerrySettings()
		settings.write("preferences", PreferenceCodec.encode(AppPreferences(landingId = 16)))
		settings.write("ride-session", ferryJson.encodeToString(RideSession(Vessel("opportunity", "Opportunity"), now.toEpochMilli(), FerryTab.MAP)))
		val cache = SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler))
		val repository = FerryRepository(transport, cache, clock = { now })
		cache.write(fixture("ride-opportunity"), repository.cacheKey(ride("opportunity")), now)
		val model = FerryStateStore(repository, settings, backgroundScope, { now })
		model.setActive(true); runCurrent()
		assertTrue(model.state.value.showingRide)
		assertEquals("opportunity", model.state.value.ride?.vessel?.id)
		assertTrue(model.state.value.ride!!.stale); assertTrue(model.state.value.ride!!.positionStale)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun coldLandingLinkWaitsForRosterAndMinimizesRestoredRide() = runTest {
		val rosterReply = CompletableDeferred<ByteArray>()
		val requests = mutableListOf<FerryEndpoint>()
		val transport = object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray {
				requests.add(endpoint)
				if (endpoint.path == "api/landings") return rosterReply.await()
				if (endpoint.path == "api/display-data") return fixture("schedule-${endpoint.parameters["landingId"]}")
				error("Offline")
			}
		}
		val settings = MemoryFerrySettings()
		settings.write("ride-session", ferryJson.encodeToString(RideSession(Vessel("opportunity", "Opportunity"), now.toEpochMilli(), FerryTab.MAP)))
		val model = store(transport, settings)
		model.handleLink(FerryWidgetLink.Landing(26)); model.setActive(true); runCurrent()
		assertFalse(requests.any { it.path == "api/display-data" })
		rosterReply.complete(fixture("landings")); runCurrent()
		assertEquals(26, model.state.value.preferences.landingId)
		assertEquals(26, model.state.value.schedule?.meta?.landingNumber)
		assertFalse(model.state.value.showingRide); assertNotNull(model.state.value.rideSession)
		model.handleLink(FerryWidgetLink.Landing(9999)); runCurrent()
		assertEquals(FerrySheet.LANDINGS, model.state.value.sheet)
		assertFalse(requests.any { it.parameters["landingId"] == "9999" })
		model.close(); runCurrent()
	}

	@Test fun visibleFeedsPollAtFifteenSecondsAndAlertsAtSixtyThenStop() = runTest {
		var time = now
		val calls = mutableListOf<String>()
		val transport = object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray {
				calls.add(endpoint.path)
				val name = if (endpoint.path == "api/display-data") "schedule-${endpoint.parameters["landingId"]}" else endpoint.path.removePrefix("api/")
				return fixture(name)
			}
		}
		val repo = FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { time })
		val model = FerryStateStore(repo, MemoryFerrySettings(), backgroundScope, { time })
		model.setActive(true); runCurrent()
		val realtime = calls.count { it == "api/realtime" }; val alerts = calls.count { it == "api/alerts" }
		assertTrue(realtime > 0); assertEquals(1, alerts)
		time = now.plusSeconds(15); advanceTimeBy(15_000); runCurrent()
		assertEquals(realtime + 1, calls.count { it == "api/realtime" }); assertEquals(alerts, calls.count { it == "api/alerts" })
		time = now.plusSeconds(60); advanceTimeBy(45_000); runCurrent()
		assertEquals(alerts + 1, calls.count { it == "api/alerts" })
		model.dispatch(FerryAction.SelectTab(FerryTab.MAP)); runCurrent()
		val hidden = calls.count { it == "api/realtime" }; val boatCalls = calls.count { it == "api/boats" }
		time = now.plusSeconds(75); advanceTimeBy(15_000); runCurrent()
		assertEquals(hidden, calls.count { it == "api/realtime" }); assertEquals(boatCalls + 1, calls.count { it == "api/boats" })
		model.setActive(false); val stopped = calls.size
		advanceTimeBy(120_000); runCurrent(); assertEquals(stopped, calls.size)
		assertTrue(model.state.value.realtime.stale); assertTrue(model.state.value.boats!!.stale)
		model.close()
	}

	@Test fun widgetDraftLoadsRosterWithoutPollingOrChangingAppLanding() = runTest {
		val calls = mutableListOf<String>()
		val settings = MemoryFerrySettings()
		settings.write("preferences", PreferenceCodec.encode(AppPreferences()))
		val transport = object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray { calls.add(endpoint.path); if (endpoint.path == "api/landings") return fixture("landings"); error("Offline") }
		}
		val repo = FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { now })
		val model = FerryStateStore(repo, settings, backgroundScope, { now }, widgetDraft = true)
		val custom = WidgetOptions(automaticLanding = false, landingId = 26, twelveHour = true)
		model.configureWidget(WidgetSettings(false, custom)); model.setActive(true); runCurrent()
		assertNotNull(model.state.value.roster)
		assertEquals(listOf("api/landings"), calls)
		assertNull(PreferenceCodec.decode(settings.read("preferences")).landingId)
		model.dispatch(FerryAction.SetWidgetUseDefaults(true)); model.dispatch(FerryAction.SetWidgetUseDefaults(false))
		assertEquals(custom, model.state.value.widgetOptions)
		model.dispatch(FerryAction.SetWidgetOptions(custom.copy(landingId = 16)))
		assertNull(WidgetSettingsStore(settings).defaults().landingId)
		model.close(); runCurrent()
	}

	@Test fun landingSelectionInvalidatesLateLocationAndPreferenceFiltersKeepSourceUnchanged() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true); model.dispatch(FerryAction.FindNearest)
		val locationToken = model.locationRequestToken()
		model.dispatch(FerryAction.SelectLanding(26)); runCurrent()
		model.locationResult(locationToken, 16, "Late location")
		assertEquals(26, model.state.value.preferences.landingId)
		assertFalse("Manual selection must stop the superseded location indicator", model.state.value.locating)
		transport.reply(landing26, fixture("schedule-26")); runCurrent()
		val source = model.state.value.schedule!!
		model.dispatch(FerryAction.SetPreferences(model.state.value.preferences.copy(showDwellTimes = false, showLayoverTimes = false, hiddenOperators = setOf("NYC Ferry"))))
		assertEquals(source, model.state.value.schedule)
		assertTrue(model.state.value.boardRows.isEmpty())
		model.dispatch(FerryAction.ResetFilters); assertTrue(model.state.value.preferences.hiddenOperators.isEmpty())
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun selectingTheCurrentLandingAlsoSupersedesAnOutstandingNearestRequest() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true); model.dispatch(FerryAction.SelectLanding(16)); runCurrent()
		transport.reply(landing16, fixture("schedule-16")); runCurrent()
		model.dispatch(FerryAction.FindNearest)
		val token = model.locationRequestToken()
		model.dispatch(FerryAction.SelectLanding(16))
		model.locationResult(token, 26, "Superseded nearest result")
		assertEquals(16, model.state.value.preferences.landingId)
		assertFalse(model.state.value.locating)
		assertNull(model.state.value.locationStatus)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun changingLandingUpdatesTheRetainedRideReturnTabAndPersistsIt() = runTest {
		val transport = DelayedTransport(); val settings = MemoryFerrySettings(); val model = store(transport, settings)
		model.setActive(true); model.dispatch(FerryAction.SelectTab(FerryTab.MAP))
		model.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity"))); runCurrent()
		model.dispatch(FerryAction.MinimizeRide)
		model.dispatch(FerryAction.SelectLanding(26)); runCurrent()
		assertEquals(FerryTab.DEPARTURES, model.state.value.rideSession?.returnTab)
		val restored = store(transport, settings)
		assertEquals(FerryTab.DEPARTURES, restored.state.value.rideSession?.returnTab)
		model.dispatch(FerryAction.ShowRide); model.dispatch(FerryAction.MinimizeRide)
		assertEquals(FerryTab.DEPARTURES, model.state.value.tab)
		model.dispatch(FerryAction.ShowRide); model.dispatch(FerryAction.ExitRide)
		assertEquals(FerryTab.DEPARTURES, model.state.value.tab)
		model.close(); restored.close(); transport.finish(); runCurrent()
	}

	@Test fun settingsAlertsFromMapRefreshOnlyWhileThePageIsVisibleAndActive() = runTest {
		var time = now
		val calls = mutableListOf<String>()
		val transport = object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray {
				calls.add(endpoint.path)
				return fixture(if (endpoint.path == "api/display-data") "schedule-${endpoint.parameters["landingId"]}" else endpoint.path.removePrefix("api/"))
			}
		}
		val settings = MemoryFerrySettings().apply { write("preferences", PreferenceCodec.encode(AppPreferences(launchTab = "map"))) }
		val model = FerryStateStore(FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { time }), settings, backgroundScope, { time })
		model.setActive(true); runCurrent()
		assertEquals(0, calls.count { it == "api/alerts" })
		model.dispatch(FerryAction.OpenSheet(FerrySheet.SETTINGS))
		model.dispatch(FerryAction.OpenSheet(FerrySheet.ALERTS)); runCurrent()
		assertEquals(1, calls.count { it == "api/alerts" })
		assertNotNull(model.state.value.alerts)
		time = now.plusSeconds(60); advanceTimeBy(60_000); runCurrent()
		assertEquals(2, calls.count { it == "api/alerts" })
		model.dispatch(FerryAction.OpenSheet(FerrySheet.SETTINGS))
		time = now.plusSeconds(120); advanceTimeBy(60_000); runCurrent()
		assertEquals(2, calls.count { it == "api/alerts" })
		model.dispatch(FerryAction.OpenSheet(FerrySheet.ALERTS)); runCurrent()
		assertEquals(3, calls.count { it == "api/alerts" })
		model.setActive(false)
		time = now.plusSeconds(180); advanceTimeBy(60_000); runCurrent()
		assertEquals(3, calls.count { it == "api/alerts" })
		model.close()
	}

	@Test fun browsingTomorrowResumesLivePollingWhenThatDateBecomesToday() = runTest {
		for (backgroundDuringMidnight in listOf(false, true)) {
			var time = Instant.parse("2026-09-05T03:59:50Z") // September 4, 23:59:50 in New York.
			val calls = mutableListOf<String>()
			val transport = object : FerryTransport {
				override suspend fun data(endpoint: FerryEndpoint): ByteArray {
					calls.add(endpoint.path)
					return fixture(if (endpoint.path == "api/display-data") "schedule-${endpoint.parameters["landingId"]}" else endpoint.path.removePrefix("api/"))
				}
			}
			val model = FerryStateStore(FerryRepository(transport, SnapshotCache(temporary.newFolder(), StandardTestDispatcher(testScheduler)), clock = { time }), MemoryFerrySettings(), backgroundScope, { time })
			model.setActive(true); runCurrent()
			model.dispatch(FerryAction.SelectDate("2026-09-05")); runCurrent()
			assertEquals("2026-09-05", model.state.value.viewDate)
			val before = calls.count { it == "api/realtime" }
			if (backgroundDuringMidnight) model.setActive(false)
			time = Instant.parse("2026-09-05T04:00:20Z")
			if (backgroundDuringMidnight) model.setActive(true)
			advanceTimeBy(30_000); runCurrent()
			assertNull("The now-current date should use live mode, background=$backgroundDuringMidnight", model.state.value.viewDate)
			assertTrue(calls.count { it == "api/realtime" } > before)
			model.close(); runCurrent()
		}
	}

	@Test fun minimizedRideDoesNotReopenAfterAnEarlyBackgroundTransition() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true)
		model.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity")))
		model.dispatch(FerryAction.MinimizeRide)
		model.setActive(false); model.setActive(true)
		assertFalse(model.state.value.showingRide)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun lateMapResponseCannotBecomeVisibleAfterTabSwitch() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true); model.dispatch(FerryAction.SelectTab(FerryTab.MAP)); runCurrent()
		model.dispatch(FerryAction.SelectTab(FerryTab.DEPARTURES))
		transport.reply(FerryEndpoint("api/boats"), fixture("boats")); runCurrent()
		assertNull(model.state.value.boats); assertEquals(FerryTab.DEPARTURES, model.state.value.tab)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun closedTripCannotBeReplacedByItsLateConnections() = runTest {
		val transport = DelayedTransport(); val model = store(transport)
		model.setActive(true); model.dispatch(FerryAction.SelectLanding(16)); runCurrent()
		transport.reply(landing16, fixture("schedule-16")); runCurrent()
		val row = model.state.value.boardRows.first { it.departure.tripId == "nine" }
		model.dispatch(FerryAction.OpenTrip(row)); runCurrent()
		model.dispatch(FerryAction.OpenSheet(null))
		transport.reply(FerryEndpoint("api/connections", mapOf("tripId" to "nine")), fixture("connections")); runCurrent()
		assertNull(model.state.value.trip); assertNull(model.state.value.sheet)
		model.close(); transport.finish(); runCurrent()
	}

	@Test fun foregroundResumeRevalidatesAnAlreadyLoadedSchedule() = runTest {
		var revision = 0
		var offline = false
		var fetchedSchedules = 0
		val transport = object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray {
				if (offline) error("Offline")
				if (endpoint.path == "api/display-data") {
					fetchedSchedules++
					val schedule = FerryJson.decode<DisplayData>(fixture("schedule-16"))
					return FerryJson.encode(schedule.copy(meta = schedule.meta.copy(generatedAt = "revision-$revision")))
				}
				return fixture(endpoint.path.removePrefix("api/"))
			}
		}
		val model = store(transport)
		model.setActive(true); runCurrent()
		assertEquals("revision-0", model.state.value.schedule?.meta?.generatedAt)
		model.setActive(false); offline = true; model.setActive(true); runCurrent()
		assertEquals("revision-0", model.state.value.schedule?.meta?.generatedAt)
		model.setActive(false); offline = false; revision = 1; model.setActive(true); runCurrent()
		assertEquals("revision-1", model.state.value.schedule?.meta?.generatedAt)
		assertTrue(fetchedSchedules >= 2)
		model.close(); runCurrent()
	}
}
