package nyc.juliet.ferrykitty.ui.map

import kotlin.math.max
import nyc.juliet.ferrykitty.core.MapBounds

/** Camera rules from the Android UX plan. Every limit is relative to the camera that fits the harbor. */
object MapCamera {
	const val FIT_PADDING_DP = 24f
	const val MIN_OF_FIT = 0.75f
	const val MAX_OF_FIT = 20f

	/** Buoys, marine labels, side streets and every landing name appear from here, as on the web map. */
	const val CLOSE_OF_FIT = 2.2f

	/** Following a vessel never leaves the camera further out than this. */
	const val FOLLOW_OF_FIT = 5f

	/** Zoom buttons and double tap. */
	const val ZOOM_STEP = 2f

	/** The ride mini map shows about this much latitude around the boat. */
	const val MINI_MAP_LATITUDE_SPAN = 0.02

	/** The served harbor in drawing units, or [fallback] (the chart's extent) when the bounds are missing or unusable. */
	fun harbor(bounds: MapBounds?, fallback: UnitRect): UnitRect {
		if (bounds == null) return fallback
		val usable = bounds.minLatitude.isFinite() && bounds.maxLatitude.isFinite() && bounds.minLongitude.isFinite() &&
			bounds.maxLongitude.isFinite() && bounds.minLatitude < bounds.maxLatitude && bounds.minLongitude < bounds.maxLongitude &&
			bounds.minLatitude >= -85.0 && bounds.maxLatitude <= 85.0 && bounds.minLongitude >= -180.0 && bounds.maxLongitude <= 180.0
		return if (usable) UnitRect.ofCoordinates(bounds.minLatitude, bounds.maxLatitude, bounds.minLongitude, bounds.maxLongitude) else fallback
	}

	fun zoomLimits(fit: CameraPosition): ClosedFloatingPointRange<Float> = fit.zoom * MIN_OF_FIT..fit.zoom * MAX_OF_FIT

	fun isClose(zoom: Float, fit: CameraPosition): Boolean = zoom >= fit.zoom * CLOSE_OF_FIT

	/** Keeps the zoom within the limits and the center over [pan], so the harbor can never be lost. */
	fun constrain(camera: CameraPosition, fit: CameraPosition, pan: UnitRect): CameraPosition =
		CameraPosition(camera.centerX, camera.centerY, camera.zoom.coerceIn(zoomLimits(fit))).clamped(pan)

	/** Centers on a vessel or landing at no less than 5× fit, keeping a closer zoom the user already chose. */
	fun focus(camera: CameraPosition?, x: Float, y: Float, fit: CameraPosition, pan: UnitRect): CameraPosition =
		constrain(CameraPosition(x, y, max(camera?.zoom ?: 0f, fit.zoom * FOLLOW_OF_FIT)), fit, pan)

	/** After a new viewport or harbor: a camera that still follows the fit refits; a chosen view is kept within limits. */
	fun adapt(camera: CameraPosition?, followsFit: Boolean, fit: CameraPosition, pan: UnitRect): CameraPosition =
		if (camera == null || followsFit) fit else constrain(camera, fit, pan)

	/** The ride mini map's fixed camera: centered on the boat and about 0.02° of latitude tall. */
	fun miniMap(latitude: Double, longitude: Double, viewport: ViewportSize): CameraPosition {
		val half = MINI_MAP_LATITUDE_SPAN / 2
		val span = HarborProjection.y(latitude - half) - HarborProjection.y(latitude + half)
		return CameraPosition(HarborProjection.x(longitude), HarborProjection.y(latitude), viewport.height / max(span, 1e-3f))
	}
}
