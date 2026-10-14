package nyc.juliet.ferryboard.ui.map

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import nyc.juliet.ferryboard.core.Bridge
import nyc.juliet.ferryboard.core.Seamark
import kotlin.math.atan2

enum class SeamarkKind { LIGHT, BUOY_GREEN, BUOY_RED, BUOY_SAFE_WATER, OTHER }

data class SeamarkStyle(val kind: SeamarkKind, val subtype: String? = null)

/** How a seamark is drawn: lights with a halo, green cans (squares), red nuns (triangles) and safe-water spheres. */
enum class SeamarkShape { LIGHT, CAN, NUN, SPHERE, MARK }

/** The chart's subtype decides a buoy's shape; without one, IALA-B convention gives green cans and red nuns. */
val SeamarkStyle.shape: SeamarkShape
	get() = when (kind) {
		SeamarkKind.LIGHT -> SeamarkShape.LIGHT
		SeamarkKind.BUOY_GREEN -> if (subtype?.contains("nun") == true) SeamarkShape.NUN else SeamarkShape.CAN
		SeamarkKind.BUOY_RED -> if (subtype?.contains("can") == true) SeamarkShape.CAN else SeamarkShape.NUN
		SeamarkKind.BUOY_SAFE_WATER -> SeamarkShape.SPHERE
		SeamarkKind.OTHER -> SeamarkShape.MARK
	}

class ChartPolygon(val id: String, val rings: List<FloatArray>, val bounds: UnitRect)

class ChartLine(val id: String, val name: String, val points: FloatArray, val bounds: UnitRect)

class ChartStreet(
	val id: String,
	val name: String,
	val label: String,
	val highway: Boolean,
	val priority: Boolean,
	val points: FloatArray,
	val bounds: UnitRect,
	val labelX: Float,
	val labelY: Float,
	/** Degrees, kept upright between -90 and 90; priority labels stay level, as on the web map. */
	val angle: Float,
)

enum class PlaceKind { BOROUGH, WATER, PARK, ISLAND }

class PlaceLabel(val name: String, val kind: PlaceKind, val x: Float, val y: Float)

/** The bundled harbor chart in drawing units: land, parks, channels and streets, plus marine references. */
class ChartGeometry(
	val land: List<ChartPolygon>,
	val parks: List<ChartLine>,
	val channels: List<ChartLine>,
	val streets: List<ChartStreet>,
	val bridges: List<Bridge>,
	val seamarks: List<Seamark>,
	val seamarkStyles: Map<String, SeamarkStyle>,
	val bounds: UnitRect,
) {
	val isEmpty: Boolean get() = land.isEmpty() && parks.isEmpty() && channels.isEmpty() && streets.isEmpty() && bridges.isEmpty() && seamarks.isEmpty()
	val attribution: String get() = ATTRIBUTION

	companion object {
		const val ATTRIBUTION = "© OpenStreetMap contributors · CARTO · OpenSeaMap (ODbL)"
		const val ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright"

		/** The chart's own extent, used before any data arrives. */
		val DEFAULT_BOUNDS: UnitRect = UnitRect.ofCoordinates(40.5, 40.92, -74.23, -73.7)

		val EMPTY = ChartGeometry(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyMap(), DEFAULT_BOUNDS)

		/** Place names drawn by the web map; they are cartography, not data. */
		val PLACES: List<PlaceLabel> = listOf(
			place("MANHATTAN", 40.770, -73.977, PlaceKind.BOROUGH),
			place("BROOKLYN", 40.674, -73.970, PlaceKind.BOROUGH),
			place("QUEENS", 40.756, -73.906, PlaceKind.BOROUGH),
			place("THE BRONX", 40.825, -73.873, PlaceKind.BOROUGH),
			place("STATEN ISLAND", 40.607, -74.109, PlaceKind.BOROUGH),
			place("NEW JERSEY", 40.739, -74.060, PlaceKind.BOROUGH),
			place("ROCKAWAY", 40.581, -73.814, PlaceKind.BOROUGH),
			place("Upper Bay", 40.655, -74.032, PlaceKind.WATER),
			place("Lower Bay", 40.555, -74.038, PlaceKind.WATER),
			place("Hudson River", 40.761, -74.015, PlaceKind.WATER),
			place("East River", 40.779, -73.932, PlaceKind.WATER),
			place("Central Park", 40.782, -73.965, PlaceKind.PARK),
			place("Governors Island", 40.689, -74.017, PlaceKind.ISLAND),
		)

		private fun place(name: String, latitude: Double, longitude: Double, kind: PlaceKind) =
			PlaceLabel(name, kind, HarborProjection.x(longitude), HarborProjection.y(latitude))

		/** Styles for marine references served by the API, which omits the chart's colors. */
		fun styleFor(seamark: Seamark, styles: Map<String, SeamarkStyle>): SeamarkStyle = styles[seamark.id] ?: when {
			seamark.type == "light" -> SeamarkStyle(SeamarkKind.LIGHT)
			seamark.name.contains("green", ignoreCase = true) -> SeamarkStyle(SeamarkKind.BUOY_GREEN)
			seamark.name.contains("red", ignoreCase = true) -> SeamarkStyle(SeamarkKind.BUOY_RED)
			else -> SeamarkStyle(SeamarkKind.OTHER)
		}
	}
}

/** Reads content/harbor-chart.json leniently: a malformed feature is skipped rather than losing the whole chart. */
object ChartParser {
	private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

	fun parse(text: String): ChartGeometry {
		val root = try { json.parseToJsonElement(text) as? JsonObject } catch (_: Exception) { null } ?: return ChartGeometry.EMPTY
		val land = root.objects("landmass").mapNotNull { feature ->
			val outer = points(feature["points"]) ?: return@mapNotNull null
			if (outer.size < 6) return@mapNotNull null
			val holes = (feature["holes"] as? JsonArray).orEmpty().mapNotNull { points(it)?.takeIf { ring -> ring.size >= 6 } }
			ChartPolygon(feature.string("id") ?: "land", listOf(outer) + holes, UnitRect.of(outer) ?: return@mapNotNull null)
		}
		val parks = lines(root.objects("parks"), minimumPoints = 3)
		val channels = lines(root.objects("channels"), minimumPoints = 2)
		val streets = root.objects("streets").mapNotNull(::street)
		val bridges = root.objects("bridges").mapNotNull { runCatching { json.decodeFromJsonElement(Bridge.serializer(), it) }.getOrNull() }
			.filter { it.points.size >= 2 && it.points.all { point -> point.size == 2 } }
		val seamarkObjects = root.objects("seamarks")
		val seamarks = seamarkObjects.mapNotNull { runCatching { json.decodeFromJsonElement(Seamark.serializer(), it) }.getOrNull() }
		val styles = seamarkObjects.mapNotNull { feature ->
			val id = feature.string("id") ?: return@mapNotNull null
			id to style(feature.string("type"), feature.string("color"), feature.string("subtype"))
		}.toMap()
		// The shoreline defines the chart's extent; a few streets run on past its edge.
		val bounds = land.map { it.bounds }.reduceOrNull(UnitRect::union)
			?: streets.map { it.bounds }.reduceOrNull(UnitRect::union) ?: ChartGeometry.DEFAULT_BOUNDS
		return ChartGeometry(land, parks, channels, streets, bridges, seamarks, styles, bounds)
	}

	private fun style(type: String?, color: String?, subtype: String?): SeamarkStyle {
		val kind = when {
			type == "light" -> SeamarkKind.LIGHT
			color == "green" -> SeamarkKind.BUOY_GREEN
			color == "red" -> SeamarkKind.BUOY_RED
			color == "red-white" -> SeamarkKind.BUOY_SAFE_WATER
			else -> SeamarkKind.OTHER
		}
		return SeamarkStyle(kind, subtype)
	}

	private fun lines(features: List<JsonObject>, minimumPoints: Int): List<ChartLine> = features.mapNotNull { feature ->
		val points = points(feature["points"])?.takeIf { it.size >= minimumPoints * 2 } ?: return@mapNotNull null
		ChartLine(feature.string("id") ?: "", feature.string("name") ?: "", points, UnitRect.of(points) ?: return@mapNotNull null)
	}

	private fun street(feature: JsonObject): ChartStreet? {
		val points = points(feature["points"])?.takeIf { it.size >= 4 } ?: return null
		val name = feature.string("name") ?: return null
		val priority = (feature["priority"] as? JsonPrimitive)?.booleanOrNull == true
		val middle = (points.size / 2 - 1) / 2
		val x1 = points[middle * 2]
		val y1 = points[middle * 2 + 1]
		val x2 = points[middle * 2 + 2]
		val y2 = points[middle * 2 + 3]
		var angle = Math.toDegrees(atan2((y2 - y1).toDouble(), (x2 - x1).toDouble())).toFloat()
		if (angle > 90f) angle -= 180f
		if (angle < -90f) angle += 180f
		return ChartStreet(
			id = feature.string("id") ?: name,
			name = name,
			label = feature.string("labelName")?.takeIf { it.isNotBlank() } ?: name,
			highway = feature.string("type") == "highway",
			priority = priority,
			points = points,
			bounds = UnitRect.of(points) ?: return null,
			labelX = x1,
			labelY = y1,
			angle = if (priority) 0f else angle,
		)
	}

	/** [[latitude, longitude], …] to projected x, y pairs, skipping any point that is not two finite coordinates. */
	private fun points(element: JsonElement?): FloatArray? {
		val array = element as? JsonArray ?: return null
		val values = FloatArray(array.size * 2)
		var count = 0
		for (point in array) {
			val pair = point as? JsonArray ?: continue
			if (pair.size != 2) continue
			val latitude = (pair[0] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull ?: continue
			val longitude = (pair[1] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull ?: continue
			if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -85.0..85.0 || longitude !in -180.0..180.0) continue
			values[count++] = HarborProjection.x(longitude)
			values[count++] = HarborProjection.y(latitude)
		}
		return values.copyOf(count)
	}

	private fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()

	private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
