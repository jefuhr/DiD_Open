package nyc.juliet.ferryboard.platform

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nyc.juliet.ferryboard.BuildConfig
import nyc.juliet.ferryboard.core.*
import java.io.File
import java.io.IOException
import java.time.Instant

class AndroidFerrySettings internal constructor(private val preferences: SharedPreferences) : FerrySettings {
	@Synchronized override fun read(key: String): String? = preferences.getString(key, null)
	@Synchronized override fun write(key: String, value: String?) {
		val edit = preferences.edit()
		if (value == null) edit.remove(key) else edit.putString(key, value)
		check(edit.commit()) { "Settings write failed" }
	}
	@Synchronized internal fun reset() { check(preferences.edit().clear().commit()) { "Test settings reset failed" } }
}

data class FerryRuntimeSession(val repository: FerryRepository, val settings: AndroidFerrySettings, val clock: () -> Instant, val fixtures: Boolean, val fixtureOffline: Boolean = false)

/** App and widget adapters share one cache and preference lock per namespace in this process. */
object AndroidRuntime {
	private val settings = mutableMapOf<String, AndroidFerrySettings>()
	private val sessions = mutableMapOf<String, FerryRuntimeSession>()
	private val fixtureNow = Instant.parse("2026-09-04T12:50:00Z")
	@Synchronized fun settings(context: Context, fixtures: Boolean = false): AndroidFerrySettings {
		val name = if (BuildConfig.DEBUG && fixtures) "ferry-ui-tests" else "ferry-production"
		return settings.getOrPut(name) { AndroidFerrySettings(context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)) }
	}
	@Synchronized fun session(context: Context, policy: TestLaunchPolicy = TestLaunchPolicy(false, false, false)): FerryRuntimeSession {
		val app = context.applicationContext
		val fixtures = BuildConfig.DEBUG && policy.fixtures
		val key = if (fixtures) "fixtures-${policy.offline}" else "production"
		val directory = File(app.filesDir, if (fixtures) "ferry-ui-tests-cache" else "ferry-cache")
		val storage = settings(app, fixtures)
		if (fixtures && policy.reset) {
			// This method is only called by a newly-created ViewModel, never during rotation.
			storage.reset()
			check(!directory.exists() || directory.deleteRecursively()) { "Test cache reset failed" }
			sessions.keys.filter { it.startsWith("fixtures-") }.forEach { sessions.remove(it) }
		}
		return sessions.getOrPut(key) {
			val clock = if (fixtures) ({ fixtureNow }) else ({ Instant.now() })
			val transport: FerryTransport = if (fixtures) PreviewDataTransport(app, policy.offline) else HTTPTransport(BuildConfig.API_BASE_URL)
			FerryRuntimeSession(FerryRepository(transport, SnapshotCache(directory), namespace = if (fixtures) "fixtures" else BuildConfig.API_BASE_URL, clock = clock), storage, clock, fixtures, fixtures && policy.offline)
		}
	}
}

/** The assets source set is debug-only; production never honors fixture intent extras. */
private class PreviewDataTransport(private val context: Context, private val offline: Boolean) : FerryTransport {
	override suspend fun data(endpoint: FerryEndpoint): ByteArray = withContext(Dispatchers.IO) {
		check(BuildConfig.DEBUG) { "Fixture transport is unavailable" }
		if (offline) throw IOException("Fixture transport is offline")
		val asset = when (endpoint.path) {
			"api/display-data" -> when (endpoint.parameters["landingId"]) { "16" -> "schedule-16"; "26" -> "schedule-26"; else -> throw IOException("Unknown fixture landing") }
			"api/ride" -> when (endpoint.parameters["vesselId"]) { "opportunity" -> "ride-opportunity"; "bay-hopper" -> "ride-bay-hopper"; else -> throw IOException("Unknown fixture vessel") }
			"api/landings" -> "landings"
			"api/realtime" -> "realtime"
			"api/alerts" -> "alerts"
			"api/map" -> "map"
			"api/boats" -> "boats"
			"api/vessels" -> "vessels"
			"api/changelog" -> "changelog"
			"api/connections" -> "connections"
			else -> throw IOException("Unknown fixture endpoint")
		}
		context.assets.open("$asset.json").use { it.readBytes() }
	}
}
