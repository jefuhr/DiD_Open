package nyc.juliet.ferrykitty.platform

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import nyc.juliet.ferrykitty.contract.*
import nyc.juliet.ferrykitty.core.*
import java.net.URI
import java.time.Instant

/** Storage is injected so state and preference recovery are ordinary JVM code. */
interface FerrySettings {
	fun read(key: String): String?
	fun write(key: String, value: String?)
}

class MemoryFerrySettings : FerrySettings {
	private val values = mutableMapOf<String, String>()
	@Synchronized override fun read(key: String) = values[key]
	@Synchronized override fun write(key: String, value: String?) { if (value == null) values.remove(key) else values[key] = value }
}

internal val ferryJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

/** Decode each field independently; one future enum or damaged value cannot reset favorites. */
object PreferenceCodec {
	private fun objectValue(raw: String?): JsonObject = runCatching { ferryJson.parseToJsonElement(raw ?: "{}").jsonObject }.getOrDefault(JsonObject(emptyMap()))
	private fun JsonObject.string(key: String, default: String) = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content ?: default
	private fun JsonObject.int(key: String): Int? = (get(key) as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull
	private fun JsonObject.bool(key: String, default: Boolean) = (get(key) as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: default
	private fun JsonObject.strings(key: String) = (get(key) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { value -> value.isString }?.content }?.toSet().orEmpty()
	private fun JsonObject.ints(key: String) = (get(key) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeUnless { value -> value.isString }?.intOrNull }?.filter { it > 0 }?.toSet().orEmpty()
	private fun JsonObject.movements(): Set<NYCFerryMovement> = strings("hiddenNYCMovements").mapNotNull {
		when (it) {
			"pierC", "PIER_C" -> NYCFerryMovement.PIER_C
			"crewShuttle", "CREW_SHUTTLE" -> NYCFerryMovement.CREW_SHUTTLE
			"outOfService", "OUT_OF_SERVICE" -> NYCFerryMovement.OUT_OF_SERVICE
			else -> null
		}
	}.toSet()
	private fun JsonObject.count() = (int("departuresPerRoute") ?: 0).takeIf { it in 0..5 } ?: 0
	private fun JsonObject.window() = (int("departureWindowMinutes") ?: 0).takeIf { it in setOf(0, 30, 60, 120, 240) } ?: 0
	private fun String.known(values: Set<String>, fallback: String) = takeIf { it in values } ?: fallback

	fun decode(raw: String?): AppPreferences {
		val v = objectValue(raw)
		return AppPreferences(
			landingId = v.int("landingId")?.takeIf { it > 0 }, favorites = v.ints("favorites"),
			hiddenOperators = v.strings("hiddenOperators"), hiddenRoutes = v.strings("hiddenRoutes"), hiddenNYCMovements = v.movements(),
			sortByRoute = v.bool("sortByRoute", false), twelveHour = v.bool("twelveHour", false), theme = v.string("theme", "nyc-ferry"),
			textSize = v.string("textSize", "system").known(setOf("system", "compact", "larger"), "system"),
			launchLanding = v.string("launchLanding", "lastUsed").known(setOf("lastUsed", "home"), "lastUsed"),
			homeLandingId = v.int("homeLandingId")?.takeIf { it > 0 },
			launchTab = v.string("launchTab", "departures").known(setOf("lastUsed", "departures", "map"), "departures"),
			lastTab = when (v.string("lastTab", "DEPARTURES")) { "MAP", "map" -> FerryTab.MAP; else -> FerryTab.DEPARTURES },
			showDwellTimes = v.bool("showDwellTimes", true), showLayoverTimes = v.bool("showLayoverTimes", true),
			showMarineReferences = v.bool("showMarineReferences", true), departuresPerRoute = v.count(), departureWindowMinutes = v.window(),
			keepScreenAwake = v.bool("keepScreenAwake", false),
		)
	}

	fun widget(raw: String?): WidgetOptions {
		val v = objectValue(raw)
		return WidgetOptions(
			automaticLanding = v.bool("automaticLanding", true), landingId = (v.int("landingID") ?: v.int("landingId"))?.takeIf { it > 0 },
			landingName = (v["landingName"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
			hiddenOperators = v.strings("hiddenOperators"), hiddenRoutes = v.strings("hiddenRoutes"), hiddenNYCMovements = v.movements(),
			twelveHour = v.bool("twelveHour", false), sortByRoute = v.bool("sortByRoute", false),
			showBoatNames = v.bool("showBoatNames", true), showAssignments = v.bool("showAssignments", true), showDwells = v.bool("showDwells", true),
			showLayovers = v.bool("showLayovers", true), showCountdown = v.bool("showCountdown", true),
			departureWindowMinutes = v.window(), departuresPerRoute = v.count(), theme = v.string("theme", "system"),
			textSize = v.string("textSize", "system").known(setOf("system", "compact", "larger"), "system"),
		)
	}

	fun encode(preferences: AppPreferences) = ferryJson.encodeToString(preferences)
	fun encode(options: WidgetOptions) = ferryJson.encodeToString(options)
	fun normalize(preferences: AppPreferences) = decode(encode(preferences))
	fun normalize(options: WidgetOptions) = widget(encode(options))
}

@Serializable
data class WidgetSettings(val useAppDefaults: Boolean = true, val options: WidgetOptions = WidgetOptions())

class WidgetSettingsStore(private val storage: FerrySettings) {
	fun defaults() = PreferenceCodec.widget(storage.read("widget-defaults"))
	fun saveDefaults(options: WidgetOptions) = storage.write("widget-defaults", PreferenceCodec.encode(PreferenceCodec.normalize(options)))
	fun read(id: Int): WidgetSettings {
		val raw = runCatching { ferryJson.parseToJsonElement(storage.read("widget-$id") ?: "{}").jsonObject }.getOrDefault(JsonObject(emptyMap()))
		return WidgetSettings((raw["useAppDefaults"] as? JsonPrimitive)?.booleanOrNull ?: true, PreferenceCodec.widget(raw["options"]?.toString()))
	}
	fun options(id: Int): WidgetOptions = read(id).let { if (it.useAppDefaults) defaults() else it.options }
	fun save(id: Int, value: WidgetSettings) { require(id > 0); storage.write("widget-$id", ferryJson.encodeToString(value.copy(options = PreferenceCodec.normalize(value.options)))) }
	fun remove(id: Int) { storage.write("widget-$id", null); WidgetExpiryStore(storage).record(id, null) }
	fun lastLanding(): LastWidgetLanding? = storage.read("widget-last-landing")?.let { runCatching { ferryJson.decodeFromString<LastWidgetLanding>(it) }.getOrNull() }
	fun saveLastLanding(value: LastWidgetLanding?) = storage.write("widget-last-landing", value?.let { ferryJson.encodeToString(it) })
}

/** Per-instance deadlines survive unrelated resize/refresh operations and process recreation. */
class WidgetExpiryStore(private val storage: FerrySettings) {
	fun record(id: Int, at: Instant?) = storage.write("widget-expiry-$id", at?.toEpochMilli()?.toString())
	fun read(id: Int): Instant? = storage.read("widget-expiry-$id")?.toLongOrNull()?.takeIf { it >= 0 }?.let(Instant::ofEpochMilli)
	fun next(installed: IntArray): Instant? = installed.asSequence().mapNotNull(::read).minOrNull()
}

/** Copy is a point-in-time snapshot, retaining widget-only boat/countdown choices. */
fun copyMainSettings(options: WidgetOptions, preferences: AppPreferences, roster: LandingRoster?): WidgetOptions = options.copy(
	automaticLanding = if (preferences.landingId != null) false else options.automaticLanding,
	landingId = preferences.landingId ?: options.landingId,
	landingName = roster?.landings?.firstOrNull { it.id == preferences.landingId }?.displayName ?: options.landingName,
	hiddenOperators = preferences.hiddenOperators, hiddenRoutes = preferences.hiddenRoutes, hiddenNYCMovements = preferences.hiddenNYCMovements,
	twelveHour = preferences.twelveHour, sortByRoute = preferences.sortByRoute,
	showDwells = preferences.showDwellTimes, showLayovers = preferences.showLayoverTimes,
	departureWindowMinutes = preferences.departureWindowMinutes, departuresPerRoute = preferences.departuresPerRoute,
	theme = preferences.theme, textSize = preferences.textSize,
)

@Serializable
data class LastWidgetLanding(val id: Int, val name: String, val atEpochMillis: Long)

sealed interface WidgetLocationDecision {
	data class Fixed(val id: Int) : WidgetLocationDecision
	data class LastLocation(val landing: LastWidgetLanding) : WidgetLocationDecision
	data object PermissionRequired : WidgetLocationDecision
	data object Unavailable : WidgetLocationDecision
}

fun widgetLocationDecision(options: WidgetOptions, authorized: Boolean, last: LastWidgetLanding?, now: Instant): WidgetLocationDecision {
	if (!options.automaticLanding) return options.landingId?.let { WidgetLocationDecision.Fixed(it) } ?: WidgetLocationDecision.Unavailable
	if (!authorized) return WidgetLocationDecision.PermissionRequired
	if (last != null && (now.toEpochMilli() - last.atEpochMillis) in 0..21_600_000L) return WidgetLocationDecision.LastLocation(last)
	return WidgetLocationDecision.Unavailable
}

object FerryLinks {
		fun parse(raw: String?): FerryWidgetLink? = runCatching {
			val uri = URI(raw ?: return null)
			if (!uri.scheme.equals("ferryboard", true) || uri.rawQuery != null || uri.rawFragment != null || uri.userInfo != null || uri.port != -1) return null
			when {
				uri.host == "nearby" && uri.rawPath in listOf("", "/") -> FerryWidgetLink.Nearby
				uri.host == "landing" && uri.rawPath.matches(Regex("/[1-9][0-9]*")) -> FerryWidgetLink.parse(raw)
				else -> null
			}
		}.getOrNull()
}

data class TestLaunchPolicy(val fixtures: Boolean, val reset: Boolean, val offline: Boolean) {
	companion object {
		fun resolve(debug: Boolean, tests: Boolean, reset: Boolean, offline: Boolean, recreated: Boolean) =
			TestLaunchPolicy(debug && tests, debug && tests && reset && !recreated, debug && tests && offline)
	}
}
