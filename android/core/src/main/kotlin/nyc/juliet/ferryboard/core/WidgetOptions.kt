package nyc.juliet.ferryboard.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.*

@Serializable(with = WidgetOptionsSerializer::class)
data class WidgetOptions(
	val automaticLanding: Boolean = true,
	val landingId: Int? = null,
	val landingName: String? = null,
	val hiddenOperators: Set<String> = emptySet(),
	val hiddenRoutes: Set<String> = emptySet(),
	val hiddenNYCMovements: Set<NYCFerryMovement> = emptySet(),
	val twelveHour: Boolean = false,
	val sortByRoute: Boolean = false,
	val showBoatNames: Boolean = true,
	val showAssignments: Boolean = true,
	val showDwells: Boolean = true,
	val showLayovers: Boolean = true,
	val showCountdown: Boolean = true,
	val departureWindowMinutes: Int = 0,
	val departuresPerRoute: Int = 0,
	val theme: String = "system",
	val textSize: String = "system",
) {
	val filters: DepartureFilters get() = DepartureFilters(hiddenOperators, hiddenRoutes, hiddenNYCMovements)
}

/** Each older or invalid preference migrates independently, matching the iOS decoder. */
object WidgetOptionsSerializer : KSerializer<WidgetOptions> {
	override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor
	override fun deserialize(decoder: Decoder): WidgetOptions {
		val values = (decoder as JsonDecoder).decodeJsonElement().jsonObject
		fun primitive(key: String) = values[key] as? JsonPrimitive
		fun bool(key: String, fallback: Boolean) = primitive(key)?.takeIf { !it.isString }?.booleanOrNull ?: fallback
		fun int(key: String) = primitive(key)?.takeIf { !it.isString }?.intOrNull
		fun string(key: String) = primitive(key)?.takeIf { it.isString }?.content
		fun strings(key: String): Set<String> {
			val array = values[key] as? JsonArray ?: return emptySet()
			if (array.any { it !is JsonPrimitive || !it.isString }) return emptySet()
			return array.mapTo(linkedSetOf()) { it.jsonPrimitive.content }
		}
		val movements = mapOf("pierC" to NYCFerryMovement.PIER_C, "crewShuttle" to NYCFerryMovement.CREW_SHUTTLE, "outOfService" to NYCFerryMovement.OUT_OF_SERVICE)
		return WidgetOptions(
			automaticLanding = bool("automaticLanding", true), landingId = int("landingID") ?: int("landingId"), landingName = string("landingName"),
			hiddenOperators = strings("hiddenOperators"), hiddenRoutes = strings("hiddenRoutes"), hiddenNYCMovements = strings("hiddenNYCMovements").mapNotNullTo(linkedSetOf()) { movements[it] },
			twelveHour = bool("twelveHour", false), sortByRoute = bool("sortByRoute", false), showBoatNames = bool("showBoatNames", true),
			showAssignments = bool("showAssignments", true), showDwells = bool("showDwells", true), showLayovers = bool("showLayovers", true), showCountdown = bool("showCountdown", true),
			departureWindowMinutes = (int("departureWindowMinutes") ?: 0).takeIf { it in listOf(0, 30, 60, 120, 240) } ?: 0,
			departuresPerRoute = (int("departuresPerRoute") ?: 0).takeIf { it in 0..5 } ?: 0,
			theme = string("theme") ?: "system", textSize = string("textSize") ?: "system",
		)
	}
	override fun serialize(encoder: Encoder, value: WidgetOptions) {
		(encoder as JsonEncoder).encodeJsonElement(buildJsonObject {
			put("automaticLanding", value.automaticLanding)
			value.landingId?.let { put("landingID", it) }
			value.landingName?.let { put("landingName", it) }
			putJsonArray("hiddenOperators") { value.hiddenOperators.sorted().forEach { add(it) } }
			putJsonArray("hiddenRoutes") { value.hiddenRoutes.sorted().forEach { add(it) } }
			putJsonArray("hiddenNYCMovements") { value.hiddenNYCMovements.sortedBy { it.ordinal }.forEach {
				add(when (it) { NYCFerryMovement.PIER_C -> "pierC"; NYCFerryMovement.CREW_SHUTTLE -> "crewShuttle"; NYCFerryMovement.OUT_OF_SERVICE -> "outOfService" })
			} }
			put("twelveHour", value.twelveHour); put("sortByRoute", value.sortByRoute); put("showBoatNames", value.showBoatNames)
			put("showAssignments", value.showAssignments); put("showDwells", value.showDwells); put("showLayovers", value.showLayovers)
			put("showCountdown", value.showCountdown); put("departureWindowMinutes", value.departureWindowMinutes)
			put("departuresPerRoute", value.departuresPerRoute); put("theme", value.theme); put("textSize", value.textSize)
		})
	}
}

@Serializable
data class WidgetSettingsRecord(val options: WidgetOptions, val roster: LandingRoster? = null, val favorites: Set<Int> = emptySet())
