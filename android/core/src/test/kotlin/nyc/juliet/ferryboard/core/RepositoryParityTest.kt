package nyc.juliet.ferryboard.core

import java.io.File
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.Serializable
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RepositoryParityTest {
	@JvmField @Rule val folder = TemporaryFolder()
	@Serializable data class Payload(val landingID: Int, val text: String)
	private val endpoint = FerryEndpoint("api/display-data", mapOf("landingId" to "16"))
	private val original = """{"landingID":16,"text":"Pier 11","futureField":true}""".toByteArray()
	private fun validate(payload: Payload) { if (payload.landingID != 16) throw FerryError.WrongIdentity() }
	private class Stub(first: Result<ByteArray>? = null, second: Result<ByteArray>? = null, third: Result<ByteArray>? = null) : FerryTransport {
		private val responses = ArrayDeque(listOfNotNull(first, second, third))
		override suspend fun data(endpoint: FerryEndpoint): ByteArray = if (responses.isEmpty()) throw IOException("Offline") else responses.removeFirst().getOrThrow()
	}

	@Test fun relaunchWrongIdentityAndMalformedReplacementsRetainOriginalBytes() = runTest {
		val directory = folder.newFolder()
		val cache = SnapshotCache(directory)
		val repository = FerryRepository(Stub(Result.success(original), Result.success("""{"landingID":26,"text":"Pier 79"}""".toByteArray()), Result.success("broken".toByteArray())), cache, clock = { fixtureNow })
		assertFalse(repository.fetch<Payload>(endpoint, ::validate).saved)
		for (i in 0..1) {
			val fallback = repository.fetch<Payload>(endpoint, ::validate)
			assertTrue(fallback.saved)
			assertEquals("Pier 11", fallback.value.text)
			assertEquals(fixtureNow, fallback.receivedAt)
			assertNotNull(fallback.warning)
		}
		val relaunched = FerryRepository(Stub(), SnapshotCache(directory), clock = { fixtureNow.plusSeconds(600) })
		assertTrue(relaunched.fetch<Payload>(endpoint, ::validate).saved)
		assertArrayEquals(original, cache.read(repository.cacheKey(endpoint))?.first)
		assertNull(relaunched.saved<Payload>(FerryEndpoint("api/display-data", mapOf("landingId" to "26"))))
	}

	@Test fun wrongSchemaNeverReplacesValidScheduleEvenWithDefaultValidation() = runTest {
		val schedule = scheduleFixture()
		val valid = testJson.encodeToString(DisplayData.serializer(), schedule).toByteArray()
		val invalid = testJson.encodeToString(DisplayData.serializer(), schedule.copy(meta = schedule.meta.copy(schemaVersion = 12))).toByteArray()
		val repository = FerryRepository(Stub(Result.success(valid), Result.success(invalid)), SnapshotCache(folder.newFolder()), clock = { fixtureNow })
		repository.fetch<DisplayData>(endpoint)
		assertEquals(11, repository.fetch<DisplayData>(endpoint).value.meta.schemaVersion)
		assertArrayEquals(valid, repository.cache.read(repository.cacheKey(endpoint))?.first)
	}

	@Test fun malformedUTF8ReplacementIsRejectedBeforeSaving() = runTest {
		val malformed = "{\"landingID\":16,\"text\":\"".toByteArray() + byteArrayOf(0xC3.toByte(), 0x28) + "\"}".toByteArray()
		val cache = SnapshotCache(folder.newFolder())
		val repository = FerryRepository(Stub(Result.success(original), Result.success(malformed)), cache, clock = { fixtureNow })
		repository.fetch<Payload>(endpoint)
		val fallback = repository.fetch<Payload>(endpoint)
		assertTrue("Malformed wire bytes cannot become a fresh snapshot", fallback.saved)
		assertEquals("Pier 11", fallback.value.text)
		assertArrayEquals(original, cache.read(repository.cacheKey(endpoint))?.first)
	}

	@Test fun corruptSnapshotsCannotManufactureFirstLaunchData() = runTest {
		val cache = SnapshotCache(folder.newFolder())
		val repository = FerryRepository(Stub(), cache)
		cache.write("corrupt".toByteArray(), repository.cacheKey(endpoint), fixtureNow)
		assertNull(repository.saved<Payload>(endpoint))
		try { repository.fetch<Payload>(endpoint); fail("An unreadable cache cannot produce a board") } catch (error: IOException) { assertEquals("Offline", error.message) }
	}

	@Test fun deterministicKeysCannotCollideOnDelimitersOrNamespaceBoundaries() = runTest {
		assertEquals(FerryEndpoint("p", linkedMapOf("b" to "2", "a" to "1")).cacheKey, FerryEndpoint("p", linkedMapOf("a" to "1", "b" to "2")).cacheKey)
		assertNotEquals(FerryEndpoint("p", mapOf("a" to "x&b=y")).cacheKey, FerryEndpoint("p", mapOf("a" to "x", "b" to "y")).cacheKey)
		val directory = folder.newFolder()
		val production = FerryRepository(Stub(Result.success(original)), SnapshotCache(directory), namespace = "production", clock = { fixtureNow })
		production.fetch<Payload>(endpoint)
		assertNull(FerryRepository(Stub(), SnapshotCache(directory), namespace = "fixtures").saved<Payload>(endpoint))
		assertNotEquals(FerryRepository(Stub(), SnapshotCache(directory), namespace = "ab").cacheKey(FerryEndpoint("c")), FerryRepository(Stub(), SnapshotCache(directory), namespace = "a").cacheKey(FerryEndpoint("bc")))
		val first = FerryRepository(HTTPTransport("https://first.example/ferry"), SnapshotCache(directory))
		val second = FerryRepository(HTTPTransport("https://second.example/ferry"), SnapshotCache(directory))
		assertNotEquals(first.cacheKey(endpoint), second.cacheKey(endpoint))
	}

	@Test fun cancellationPropagatesWithoutFallbackOrCacheReplacement() = runTest {
		val cache = SnapshotCache(folder.newFolder())
		val repository = FerryRepository(Stub(Result.success(original), Result.failure(CancellationException("Canceled"))), cache, clock = { fixtureNow })
		repository.fetch<Payload>(endpoint)
		try { repository.fetch<Payload>(endpoint); fail("Cancellation must not become offline success") } catch (_: CancellationException) { }
		assertArrayEquals(original, cache.read(repository.cacheKey(endpoint))?.first)
	}

	@Test fun cancellationDuringTransportCannotPoisonSavedData() = runTest {
		val entered = CompletableDeferred<Unit>()
		val transport = object : FerryTransport {
			override suspend fun data(endpoint: FerryEndpoint): ByteArray { entered.complete(Unit); awaitCancellation() }
		}
		val cache = SnapshotCache(folder.newFolder())
		val repository = FerryRepository(transport, cache)
		cache.write(original, repository.cacheKey(endpoint), fixtureNow)
		val request = async { repository.fetch<Payload>(endpoint) }
		entered.await()
		request.cancelAndJoin()
		assertTrue(request.isCancelled)
		assertArrayEquals(original, cache.read(repository.cacheKey(endpoint))?.first)
	}

	@Test fun storageFailureReturnsFreshValueWithHonestWarning() = runTest {
		val file = folder.newFile()
		val response = FerryRepository(Stub(Result.success(original)), SnapshotCache(file), clock = { fixtureNow }).fetch<Payload>(endpoint)
		assertFalse(response.saved)
		assertEquals("Pier 11", response.value.text)
		assertNotNull(response.warning)
	}

	@Test fun atomicConcurrentReplacementsKeepBytesAndReceiptTogether() = runTest {
		val directory = folder.newFolder()
		val cache = SnapshotCache(directory)
		coroutineScope { (0..30).map { i -> launch(Dispatchers.IO) { cache.write(i.toString().toByteArray(), "shared", Instant.ofEpochSecond(i.toLong())) } }.joinAll() }
		val result = requireNotNull(SnapshotCache(directory).read("shared"))
		assertEquals(String(result.first).toLong(), result.second.epochSecond)
		assertTrue(directory.listFiles().orEmpty().all { !it.name.endsWith(".tmp") })
	}

	@OptIn(ExperimentalCoroutinesApi::class)
	@Test fun injectedCacheDispatcherLetsLifecycleRaceTestsAdvanceDeterministically() = runTest {
		val cache = SnapshotCache(folder.newFolder(), StandardTestDispatcher(testScheduler))
		val write = async { cache.write(original, "injected", fixtureNow) }
		runCurrent()
		assertTrue(write.isCompleted)
		val read = async { cache.read("injected") }
		runCurrent()
		assertTrue(read.isCompleted)
		assertArrayEquals(original, read.await()?.first)
	}

	@Test fun savedValidationRunsAgainAndNoCrossSelectionRideOrConnectionsPass() = runTest {
		val cache = SnapshotCache(folder.newFolder())
		val repository = FerryRepository(Stub(Result.success(original)), cache)
		repository.fetch<Payload>(endpoint)
		assertNull(repository.saved<Payload>(endpoint) { throw FerryError.WrongIdentity() })
		val connections: Connections = decode("""{"tripId":"nyu:1","generatedAt":"2026-09-28T12:00:00Z","serviceDate":"2026-09-28","stale":false,"stops":[]}""")
		val now = Instant.parse("2026-09-28T12:04:00Z")
		assertTrue(connections.usable("nyu:1", "2026-09-28", now))
		assertFalse(connections.usable("nyu:1", "2026-09-28", now.plusSeconds(120)))
		assertFalse(connections.usable("nyu:1", "2026-09-29", now))
		assertFalse(connections.usable("other", "2026-09-28", now))
	}
}
