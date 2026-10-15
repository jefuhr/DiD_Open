package nyc.juliet.ferryboard.ui.map

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sinh

/**
 * Web Mercator, as on the web map, in local drawing units. One unit is 2^-19 of the world (about 58 m in the harbor) and
 * the origin sits just northwest of the chart, so coordinates stay small enough for exact Float storage at every zoom.
 */
object HarborProjection {
	const val UNITS_PER_WORLD = 524_288.0
	private const val EARTH_CIRCUMFERENCE_METRES = 40_075_016.686
	private const val ORIGIN_LONGITUDE = -74.5
	private const val ORIGIN_LATITUDE = 41.2
	private val originX = worldX(ORIGIN_LONGITUDE)
	private val originY = worldY(ORIGIN_LATITUDE)

	fun worldX(longitude: Double): Double = (longitude + 180) / 360

	fun worldY(latitude: Double): Double {
		val sine = sin(latitude * PI / 180).coerceIn(-0.9999, 0.9999)
		return 0.5 - ln((1 + sine) / (1 - sine)) / (4 * PI)
	}

	fun x(longitude: Double): Float = ((worldX(longitude) - originX) * UNITS_PER_WORLD).toFloat()

	fun y(latitude: Double): Float = ((worldY(latitude) - originY) * UNITS_PER_WORLD).toFloat()

	fun longitude(x: Float): Double = (x / UNITS_PER_WORLD + originX) * 360 - 180

	fun latitude(y: Float): Double = atan(sinh(PI * (1 - 2 * (y / UNITS_PER_WORLD + originY)))) * 180 / PI

	fun metresPerUnit(latitude: Double): Double = EARTH_CIRCUMFERENCE_METRES * cos(latitude * PI / 180) / UNITS_PER_WORLD

	/** Planar distance, accurate over the few hundred metres used to match a stop to a landing. */
	fun metresBetween(latitude: Double, longitude: Double, otherLatitude: Double, otherLongitude: Double): Double {
		val easting = (otherLongitude - longitude) * cos(latitude * PI / 180)
		val northing = otherLatitude - latitude
		return kotlin.math.hypot(easting, northing) * 111_320.0
	}
}
