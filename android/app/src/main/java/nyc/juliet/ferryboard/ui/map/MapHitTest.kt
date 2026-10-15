package nyc.juliet.ferryboard.ui.map

import kotlin.math.hypot

enum class MapLayer { VESSEL, LANDING, SEAMARK, BRIDGE }

data class MapHit(val layer: MapLayer, val index: Int)

/**
 * What a tap on the chart selects: vessels, then landings, then seamarks, then bridges, each within the touch radius
 * (24 dp, half of a 48 dp target). Positions are screen pixels; a NaN position cannot be hit.
 */
object MapHitTest {
	const val RADIUS_DP = 24f

	/** [vessels], [landings] and [seamarks] hold x, y pairs; [bridges] holds ax, ay, bx, by segments. */
	fun pick(x: Float, y: Float, radius: Float, vessels: FloatArray, landings: FloatArray, seamarks: FloatArray, bridges: FloatArray): MapHit? {
		nearestPoint(x, y, vessels, radius).let { if (it >= 0) return MapHit(MapLayer.VESSEL, it) }
		nearestPoint(x, y, landings, radius).let { if (it >= 0) return MapHit(MapLayer.LANDING, it) }
		nearestPoint(x, y, seamarks, radius).let { if (it >= 0) return MapHit(MapLayer.SEAMARK, it) }
		nearestSegment(x, y, bridges, radius).let { if (it >= 0) return MapHit(MapLayer.BRIDGE, it) }
		return null
	}

	/** The index of the nearest x, y pair within [radius], or -1. */
	fun nearestPoint(x: Float, y: Float, points: FloatArray, radius: Float): Int {
		var best = -1
		var bestDistance = radius
		var index = 0
		while (index + 1 < points.size) {
			val distance = hypot(points[index] - x, points[index + 1] - y)
			if (distance <= bestDistance) {
				best = index / 2
				bestDistance = distance
			}
			index += 2
		}
		return best
	}

	/** The index of the nearest ax, ay, bx, by segment within [radius], or -1. */
	fun nearestSegment(x: Float, y: Float, segments: FloatArray, radius: Float): Int {
		var best = -1
		var bestDistance = radius
		var index = 0
		while (index + 3 < segments.size) {
			val distance = distanceToSegment(x, y, segments[index], segments[index + 1], segments[index + 2], segments[index + 3])
			if (distance <= bestDistance) {
				best = index / 4
				bestDistance = distance
			}
			index += 4
		}
		return best
	}

	fun distanceToSegment(x: Float, y: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
		val dx = bx - ax
		val dy = by - ay
		val lengthSquared = dx * dx + dy * dy
		val t = if (lengthSquared <= 0f) 0f else (((x - ax) * dx + (y - ay) * dy) / lengthSquared).coerceIn(0f, 1f)
		return hypot(x - (ax + t * dx), y - (ay + t * dy))
	}
}
