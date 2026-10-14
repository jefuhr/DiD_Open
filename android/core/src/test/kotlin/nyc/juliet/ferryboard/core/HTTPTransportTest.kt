package nyc.juliet.ferryboard.core

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.SocketTimeoutException
import java.net.URL
import java.security.cert.Certificate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class HTTPTransportTest {
	private class FakeConnection(url: URL, private val status: Int, val body: InputStream, private val length: Long = -1) : HttpsURLConnection(url) {
		val disconnected = AtomicBoolean(false)
		override fun connect() { connected = true }
		override fun disconnect() { disconnected.set(true); body.close() }
		override fun usingProxy(): Boolean = false
		override fun getResponseCode(): Int = status
		override fun getInputStream(): InputStream = body
		override fun getErrorStream(): InputStream? = if (status == 503) body else null
		override fun getContentLengthLong(): Long = length
		override fun getCipherSuite(): String = "TEST"
		override fun getLocalCertificates(): Array<Certificate>? = null
		override fun getServerCertificates(): Array<Certificate> = emptyArray()
	}
	private class BlockingBody : InputStream() {
		val entered = CountDownLatch(1)
		private val closed = CountDownLatch(1)
		override fun read(): Int { entered.countDown(); if (!closed.await(3, TimeUnit.SECONDS)) throw IllegalStateException("Cancellation failed to close the body"); return -1 }
		override fun close() { closed.countDown() }
	}

	@Test fun HTTPSURLPreservesDeploymentAndEncodesQueryExactly() {
		val transport = HTTPTransport("https://api.example/ferry/")
		assertEquals("https://api.example/ferry/api/ride?a=x%20%26%3D%3F&vesselId=nyc%3A1", transport.url(FerryEndpoint("api/ride", mapOf("vesselId" to "nyc:1", "a" to "x &=?"))).toString())
		assertEquals(HTTPTransport("https://API.example:443/ferry/").deploymentIdentity, transport.deploymentIdentity)
		for (base in listOf("http://api.example", "https://user:secret@api.example", "https://api.example?token=abc", "https://api.example#x"))
			assertThrows(IllegalArgumentException::class.java) { HTTPTransport(base) }
		for (path in listOf("../private", "/api/landings", "https://evil.example/x", "api/realtime?x=1", "api/realtime#x"))
			assertThrows(IllegalArgumentException::class.java) { transport.url(FerryEndpoint(path)) }
	}

	@Test fun typedUnavailable503IsAllowedOnlyForThreeFeedEndpoints() = runBlocking {
		for (path in listOf("api/realtime", "api/boats", "api/alerts", "api/landings", "api/map", "api/ride", "api/display-data", "api/connections")) {
			val unavailable = """{"available":false,"stale":true,"updates":[],"vehicles":[]}""".toByteArray()
			val fake = FakeConnection(URL("https://example.test/$path"), 503, ByteArrayInputStream(unavailable))
			val transport = HTTPTransport("https://example.test", connectionFactory = { fake })
			if (path in listOf("api/realtime", "api/boats", "api/alerts")) assertArrayEquals(unavailable, transport.data(FerryEndpoint(path)))
			else try { transport.data(FerryEndpoint(path)); fail(path) } catch (error: FerryError.HTTP) { assertEquals(503, error.code) }
			assertTrue(fake.disconnected.get())
		}
	}

	@Test fun unsuccessfulAndRedirectResponsesNeverBecomeSuccessfulSnapshots() = runBlocking {
		for (status in listOf(301, 302, 400, 401, 404, 500, 504)) {
			val fake = FakeConnection(URL("https://example.test/api/realtime"), status, ByteArrayInputStream("{}".toByteArray()))
			try { HTTPTransport("https://example.test", connectionFactory = { fake }).data(FerryEndpoint("api/realtime")); fail("HTTP $status") }
			catch (error: FerryError.HTTP) { assertEquals(status, error.code) }
			assertFalse(fake.instanceFollowRedirects)
		}
	}

	@Test fun knownAndUnknownLengthBodiesAreBothBounded() = runBlocking {
		for (length in listOf(-1L, 5L)) {
			val fake = FakeConnection(URL("https://example.test/api/map"), 200, ByteArrayInputStream(ByteArray(5)), length)
			try { HTTPTransport("https://example.test", maximumResponseBytes = 4, connectionFactory = { fake }).data(FerryEndpoint("api/map")); fail("Oversized body") }
			catch (_: FerryError.InvalidResponse) { }
			assertTrue(fake.disconnected.get())
		}
	}

	@Test fun cancellationClosesInFlightBodyAndPropagates() = runBlocking {
		val body = BlockingBody()
		val fake = FakeConnection(URL("https://example.test/api/map"), 200, body)
		val request = async(Dispatchers.Default) { HTTPTransport("https://example.test", connectionFactory = { fake }).data(FerryEndpoint("api/map")) }
		assertTrue(body.entered.await(2, TimeUnit.SECONDS))
		withTimeout(2000) { request.cancelAndJoin() }
		assertTrue(request.isCancelled)
		assertTrue(fake.disconnected.get())
	}

	@Test fun totalRequestDeadlineDisconnectsAndBecomesRecoverableNetworkFailure() = runBlocking {
		val body = BlockingBody()
		val fake = FakeConnection(URL("https://example.test/api/map"), 200, body)
		try { HTTPTransport("https://example.test", requestTimeoutMillis = 100, connectionFactory = { fake }).data(FerryEndpoint("api/map")); fail("Request exceeded its deadline") }
		catch (_: SocketTimeoutException) { }
		assertTrue(fake.disconnected.get())
	}

	@Test fun requestSetsBoundedSocketTimeoutsAndJSONAccept() = runBlocking {
		val fake = FakeConnection(URL("https://example.test/api/landings"), 200, ByteArrayInputStream("{}".toByteArray()))
		assertArrayEquals("{}".toByteArray(), HTTPTransport("https://example.test", connectionFactory = { fake }).data(FerryEndpoint("api/landings")))
		assertEquals(15000, fake.connectTimeout)
		assertEquals(15000, fake.readTimeout)
		assertEquals("application/json", fake.getRequestProperty("Accept"))
		assertFalse(fake.useCaches)
	}
}
