package nyc.juliet.ferryboard.ui.map

import nyc.juliet.ferryboard.core.Boat
import nyc.juliet.ferryboard.core.Bridge
import nyc.juliet.ferryboard.core.Landing
import nyc.juliet.ferryboard.core.MapRoute
import nyc.juliet.ferryboard.ui.theme.ColorMath

/** One drawable route path in drawing units. */
class RouteLine(val routeId: String, val color: Long, val points: FloatArray, val bounds: UnitRect)

/** Projects the served harbor (`/api/map` routes and landings) and marine references into drawing units. */
object HarborFeatures {
	/** A vessel's reported stop marks the landing within this distance, as on the web map. */
	const val NEXT_STOP_METRES = 300.0

	fun routeLines(routes: List<MapRoute>): List<RouteLine> = routes.flatMap { route ->
		val color = ColorMath.parseHex(route.color) ?: VesselSearch.NEUTRAL_MARKER
		route.paths.orEmpty().mapNotNull { path ->
			val points = project(path)
			if (points.size < 4) return@mapNotNull null
			RouteLine(route.id, color, points, UnitRect.of(points) ?: return@mapNotNull null)
		}
	}

	fun landingPoint(landing: Landing): MapPoint? {
		val latitude = landing.latitude ?: return null
		val longitude = landing.longitude ?: return null
		if (!valid(latitude, longitude)) return null
		return MapPoint(HarborProjection.x(longitude), HarborProjection.y(latitude))
	}

	/** The landing a vessel is heading for or alongside: the nearest within 300 m of its reported stop. */
	fun nextStopLanding(boat: Boat?, landings: List<Landing>): Int? {
		val stop = boat?.stop ?: return null
		val stopLatitude = stop.latitude ?: return null
		val stopLongitude = stop.longitude ?: return null
		return landings.mapNotNull { landing ->
			val latitude = landing.latitude ?: return@mapNotNull null
			val longitude = landing.longitude ?: return@mapNotNull null
			landing.id to HarborProjection.metresBetween(stopLatitude, stopLongitude, latitude, longitude)
		}.filter { it.second <= NEXT_STOP_METRES }.minByOrNull { it.second }?.first
	}

	/** A bridge is drawn and hit as the deck between its first two points. */
	fun bridgeSegment(bridge: Bridge): FloatArray? {
		if (bridge.points.size < 2) return null
		val (start, end) = bridge.points
		if (start.size != 2 || end.size != 2 || !valid(start[0], start[1]) || !valid(end[0], end[1])) return null
		return floatArrayOf(HarborProjection.x(start[1]), HarborProjection.y(start[0]), HarborProjection.x(end[1]), HarborProjection.y(end[0]))
	}

	/** Bridges and seamarks come from the served chart, else from the bundled one (an empty served list included). */
	fun <T> marine(served: List<T>?, bundled: List<T>): List<T> = served?.takeIf { it.isNotEmpty() } ?: bundled

	/** [[latitude, longitude], …] to x, y pairs, skipping malformed points. */
	private fun project(path: List<List<Double>>): FloatArray {
		val values = FloatArray(path.size * 2)
		var count = 0
		for (point in path) {
			if (point.size != 2 || !valid(point[0], point[1])) continue
			values[count++] = HarborProjection.x(point[1])
			values[count++] = HarborProjection.y(point[0])
		}
		return values.copyOf(count)
	}

	private fun valid(latitude: Double, longitude: Double): Boolean =
		latitude.isFinite() && longitude.isFinite() && latitude in -85.0..85.0 && longitude in -180.0..180.0
}
