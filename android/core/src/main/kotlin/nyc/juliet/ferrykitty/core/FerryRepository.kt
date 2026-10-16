package nyc.juliet.ferrykitty.core

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import javax.net.ssl.HttpsURLConnection
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer

sealed class FerryError(message: String) : IOException(message) {
	class UnsupportedSchedule(val version: Int) : FerryError("This schedule needs a newer version of Ferry Kitty.")
	class WrongIdentity : FerryError("The server returned data for a different selection.")
	class InvalidResponse : FerryError("The ferry server returned an unreadable response.")
	class HTTP(val code: Int) : FerryError("The ferry server could not answer ($code).")
	class NoSavedData : FerryError("Connect to download this schedule for offline use.")
}

/** Length-prefixed components keep delimiter-bearing values and deployment boundaries distinct. */
private fun keyPart(value: String): String = "${value.length}:$value"

data class FerryEndpoint(val path: String, val parameters: Map<String, String> = emptyMap()) {
	val cacheKey: String get() = keyPart(path) + parameters.toSortedMap().entries.joinToString("") { keyPart(it.key) + keyPart(it.value) }
}

interface FerryTransport {
	/** HTTP implementations expose their canonical deployment; injected transports use the repository namespace. */
	val deploymentIdentity: String get() = "injected"
	suspend fun data(endpoint: FerryEndpoint): ByteArray
}

class HTTPTransport(
	val baseUrl: String = "https://juliet.nyc",
	private val connectTimeoutMillis: Int = 15000,
	private val readTimeoutMillis: Int = 15000,
	private val requestTimeoutMillis: Long = 15000,
	private val maximumResponseBytes: Int = 32 * 1024 * 1024,
	private val connectionFactory: (URL) -> HttpsURLConnection = { it.openConnection() as HttpsURLConnection },
) : FerryTransport {
	private val base = URI(baseUrl).also {
		require(it.scheme.equals("https", true) && it.host != null && it.rawUserInfo == null && it.rawQuery == null && it.rawFragment == null) { "Ferry endpoints require an HTTPS deployment URL" }
		require(connectTimeoutMillis > 0 && readTimeoutMillis > 0 && requestTimeoutMillis > 0 && maximumResponseBytes > 0)
	}
	override val deploymentIdentity: String = URI("https", null, base.host.lowercase(), if (base.port == 443) -1 else base.port, base.path.trimEnd('/'), null, null).toASCIIString()

	fun url(endpoint: FerryEndpoint): URL {
		require(!endpoint.path.startsWith('/') && !endpoint.path.contains('?') && !endpoint.path.contains('#') &&
			!endpoint.path.contains('\\') && !URI(endpoint.path).isAbsolute && endpoint.path.split('/').none { it == "." || it == ".." }) { "Ferry endpoint paths must be relative" }
		val path = base.path.trimEnd('/') + "/" + endpoint.path
		val query = endpoint.parameters.toSortedMap().entries.joinToString("&") {
			fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
			encode(it.key) + "=" + encode(it.value)
		}
		val raw = URI("https", null, base.host, base.port, path, null, null).toASCIIString()
		return URL(raw + if (query.isEmpty()) "" else "?$query")
	}

	override suspend fun data(endpoint: FerryEndpoint): ByteArray = try {
		withTimeout(requestTimeoutMillis) {
			currentCoroutineContext().ensureActive()
			suspendCancellableCoroutine { continuation ->
				val connection = connectionFactory(url(endpoint))
				continuation.invokeOnCancellation { connection.disconnect() }
				Dispatchers.IO.dispatch(continuation.context, Runnable {
					try {
						if (!continuation.isActive) return@Runnable
						connection.connectTimeout = connectTimeoutMillis
						connection.readTimeout = readTimeoutMillis
						connection.instanceFollowRedirects = false
						connection.useCaches = false
						connection.requestMethod = "GET"
						connection.setRequestProperty("Accept", "application/json")
						val status = connection.responseCode
						val snapshot = endpoint.path in setOf("api/realtime", "api/boats", "api/alerts")
						if (status !in 200..299 && !(snapshot && status == 503)) throw FerryError.HTTP(status)
						if (connection.contentLengthLong > maximumResponseBytes) throw FerryError.InvalidResponse()
						val stream = if (status == 503) connection.errorStream ?: connection.inputStream else connection.inputStream
						val bytes = stream.use { input ->
							val output = ByteArrayOutputStream()
							val buffer = ByteArray(8192)
							while (true) {
								if (!continuation.isActive) throw CancellationException("Ferry request canceled")
								val count = input.read(buffer)
								if (count < 0) break
								if (count > maximumResponseBytes - output.size()) throw FerryError.InvalidResponse()
								output.write(buffer, 0, count)
							}
							output.toByteArray()
						}
						if (continuation.isActive) continuation.resume(bytes)
					} catch (error: Exception) {
						if (continuation.isActive) continuation.resumeWithException(error)
					} finally { connection.disconnect() }
				})
			}
		}
	} catch (timeout: TimeoutCancellationException) {
		// An expired network deadline is recoverable offline; caller cancellation still propagates.
		currentCoroutineContext().ensureActive()
		throw SocketTimeoutException("The ferry server did not answer before the request deadline.")
	}
}

object FerryJson {
	val json: Json = Json { ignoreUnknownKeys = true }
	fun text(bytes: ByteArray): String = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
		.onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
	inline fun <reified T> decode(bytes: ByteArray): T = json.decodeFromString(text(bytes))
	inline fun <reified T> encode(value: T): ByteArray = json.encodeToString(serializer<T>(), value).toByteArray(Charsets.UTF_8)
}

data class SavedResponse<T>(val value: T, val saved: Boolean, val receivedAt: Instant, val warning: String? = null)

@Serializable
private data class DiskEntry(val key: String, val data: String, val receivedAt: String, val checksum: String)

private fun sha256(data: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it.toInt() and 255) }

/** Original response bytes and receipt time become visible together through one atomic replacement. */
class SnapshotCache(private val directory: File, private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO) {
	private val mutex = Mutex()
	private fun file(key: String) = File(directory, sha256(key.toByteArray(Charsets.UTF_8)) + ".json")
	suspend fun read(key: String): Pair<ByteArray, Instant>? = withContext(ioDispatcher) {
		mutex.withLock {
			currentCoroutineContext().ensureActive()
			try {
				val file = file(key)
				if (!file.isFile || file.length() > 48L * 1024 * 1024) return@withLock null
				val entry = FerryJson.json.decodeFromString<DiskEntry>(file.readText(Charsets.UTF_8))
				val bytes = Base64.getDecoder().decode(entry.data)
				val at = ServiceClock.instant(entry.receivedAt) ?: return@withLock null
				if (entry.key != key || sha256(bytes) != entry.checksum) null else bytes to at
			} catch (canceled: CancellationException) { throw canceled } catch (_: Exception) { null }
		}
	}
	suspend fun write(data: ByteArray, key: String, at: Instant) = withContext(ioDispatcher) {
		mutex.withLock {
			currentCoroutineContext().ensureActive()
			if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Offline cache directory is unavailable")
			val temporary = File.createTempFile("snapshot-", ".tmp", directory)
			try {
				val entry = DiskEntry(key, Base64.getEncoder().encodeToString(data), at.toString(), sha256(data))
				FileOutputStream(temporary).use { stream ->
					stream.write(FerryJson.json.encodeToString(DiskEntry.serializer(), entry).toByteArray(Charsets.UTF_8))
					stream.fd.sync()
				}
				currentCoroutineContext().ensureActive()
				Files.move(temporary.toPath(), file(key).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
			} finally { temporary.delete() }
		}
		Unit
	}
}

class FerryRepository(
	private val transport: FerryTransport,
	val cache: SnapshotCache,
	private val namespace: String = "production",
	private val clock: () -> Instant = { Instant.now() },
) {
	fun cacheKey(endpoint: FerryEndpoint): String = "ferry-snapshot-v1|" + keyPart(namespace) + keyPart(transport.deploymentIdentity) + keyPart(endpoint.cacheKey)

	suspend inline fun <reified T> fetch(endpoint: FerryEndpoint, noinline validate: (T) -> Unit = {}): SavedResponse<T> = fetchDecoded(serializer<T>(), endpoint, validate)
	suspend inline fun <reified T> saved(endpoint: FerryEndpoint, noinline validate: (T) -> Unit = {}): SavedResponse<T>? = savedDecoded(serializer<T>(), endpoint, validate)

	private fun validateIdentity(value: Any?, endpoint: FerryEndpoint) {
		when (value) {
			is DisplayData -> value.validate(endpoint.parameters["landingId"]?.toIntOrNull())
			is Ride -> endpoint.parameters["vesselId"]?.let { if (value.vessel.id != it) throw FerryError.WrongIdentity() }
			is Connections -> {
				endpoint.parameters["tripId"]?.let { if (value.tripId != it) throw FerryError.WrongIdentity() }
				endpoint.parameters["date"]?.let { if (value.serviceDate != it) throw FerryError.WrongIdentity() }
			}
		}
	}

	@PublishedApi internal suspend fun <T> savedDecoded(serializer: KSerializer<T>, endpoint: FerryEndpoint, validate: (T) -> Unit): SavedResponse<T>? {
		currentCoroutineContext().ensureActive()
		val raw = cache.read(cacheKey(endpoint)) ?: return null
		return try {
			val value = FerryJson.json.decodeFromString(serializer, FerryJson.text(raw.first))
			validateIdentity(value, endpoint)
			validate(value)
			currentCoroutineContext().ensureActive()
			SavedResponse(value, true, raw.second)
		} catch (canceled: CancellationException) { throw canceled } catch (_: Exception) { null }
	}

	@PublishedApi internal suspend fun <T> fetchDecoded(serializer: KSerializer<T>, endpoint: FerryEndpoint, validate: (T) -> Unit): SavedResponse<T> {
		currentCoroutineContext().ensureActive()
		try {
			val raw = transport.data(endpoint)
			currentCoroutineContext().ensureActive()
			val value = FerryJson.json.decodeFromString(serializer, FerryJson.text(raw))
			validateIdentity(value, endpoint)
			validate(value)
			currentCoroutineContext().ensureActive()
			val at = clock()
			var warning: String? = null
			try { cache.write(raw, cacheKey(endpoint), at) }
			catch (canceled: CancellationException) { throw canceled }
			catch (_: Exception) { warning = "Offline storage is unavailable. Keep the app open until you can reconnect." }
			currentCoroutineContext().ensureActive()
			return SavedResponse(value, false, at, warning)
		} catch (canceled: CancellationException) { throw canceled }
		catch (error: Exception) {
			currentCoroutineContext().ensureActive()
			val fallback = savedDecoded(serializer, endpoint, validate) ?: throw error
			return fallback.copy(warning = error.localizedMessage ?: "The ferry server is unavailable.")
		}
	}
}
