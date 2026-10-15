package nyc.juliet.ferryboard.ui.map

import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

data class MapPoint(val x: Float, val y: Float)

data class ViewportSize(val width: Float, val height: Float) {
	val isEmpty: Boolean get() = width <= 0f || height <= 0f
}

/** A rectangle in drawing units. */
data class UnitRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
	val width: Float get() = right - left
	val height: Float get() = bottom - top
	val centerX: Float get() = (left + right) / 2f
	val centerY: Float get() = (top + bottom) / 2f
	fun intersects(other: UnitRect): Boolean = left <= other.right && right >= other.left && top <= other.bottom && bottom >= other.top
	fun contains(other: UnitRect): Boolean = left <= other.left && top <= other.top && right >= other.right && bottom >= other.bottom
	fun union(other: UnitRect): UnitRect = UnitRect(min(left, other.left), min(top, other.top), max(right, other.right), max(bottom, other.bottom))
	fun inflate(amount: Float): UnitRect = UnitRect(left - amount, top - amount, right + amount, bottom + amount)

	companion object {
		fun of(points: FloatArray): UnitRect? {
			if (points.size < 2) return null
			var left = Float.POSITIVE_INFINITY
			var top = Float.POSITIVE_INFINITY
			var right = Float.NEGATIVE_INFINITY
			var bottom = Float.NEGATIVE_INFINITY
			var index = 0
			while (index + 1 < points.size) {
				left = min(left, points[index]); right = max(right, points[index])
				top = min(top, points[index + 1]); bottom = max(bottom, points[index + 1])
				index += 2
			}
			return UnitRect(left, top, right, bottom)
		}

		fun ofCoordinates(minLatitude: Double, maxLatitude: Double, minLongitude: Double, maxLongitude: Double): UnitRect =
			UnitRect(HarborProjection.x(minLongitude), HarborProjection.y(maxLatitude), HarborProjection.x(maxLongitude), HarborProjection.y(minLatitude))
	}
}

/** Where the map looks: a center in drawing units and a zoom in pixels per unit. North is always up. */
data class CameraPosition(val centerX: Float, val centerY: Float, val zoom: Float) {
	fun toScreen(x: Float, y: Float, viewport: ViewportSize): MapPoint =
		MapPoint((x - centerX) * zoom + viewport.width / 2f, (y - centerY) * zoom + viewport.height / 2f)

	fun toUnits(screenX: Float, screenY: Float, viewport: ViewportSize): MapPoint =
		MapPoint((screenX - viewport.width / 2f) / zoom + centerX, (screenY - viewport.height / 2f) / zoom + centerY)

	/** The visible area in drawing units. */
	fun visible(viewport: ViewportSize): UnitRect {
		val halfWidth = viewport.width / 2f / zoom
		val halfHeight = viewport.height / 2f / zoom
		return UnitRect(centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight)
	}

	/** Content follows the finger: a drag of (dx, dy) pixels moves every point by the same amount on screen. */
	fun panned(dx: Float, dy: Float): CameraPosition = copy(centerX = centerX - dx / zoom, centerY = centerY - dy / zoom)

	/** Zooms by [factor] while the unit under ([focusX], [focusY]) stays under it. */
	fun zoomedAbout(focusX: Float, focusY: Float, factor: Float, viewport: ViewportSize, limits: ClosedFloatingPointRange<Float>): CameraPosition {
		val target = (zoom * factor).coerceIn(limits)
		if (target == zoom) return this
		val anchor = toUnits(focusX, focusY, viewport)
		return CameraPosition(
			anchor.x - (focusX - viewport.width / 2f) / target,
			anchor.y - (focusY - viewport.height / 2f) / target,
			target,
		)
	}

	/** Keeps the center over the harbor so the chart cannot be panned out of sight. */
	fun clamped(bounds: UnitRect): CameraPosition =
		copy(centerX = centerX.coerceIn(bounds.left, bounds.right), centerY = centerY.coerceIn(bounds.top, bounds.bottom))

	/** Moves linearly and zooms geometrically, so a long zoom feels even. */
	fun interpolate(target: CameraPosition, fraction: Float): CameraPosition {
		val t = fraction.coerceIn(0f, 1f)
		if (t >= 1f) return target
		val zoom = exp(ln(zoom.toDouble()) + (ln(target.zoom.toDouble()) - ln(zoom.toDouble())) * t).toFloat()
		return CameraPosition(centerX + (target.centerX - centerX) * t, centerY + (target.centerY - centerY) * t, zoom)
	}

	companion object {
		fun fit(bounds: UnitRect, viewport: ViewportSize, paddingPx: Float): CameraPosition {
			val width = max(1f, viewport.width - paddingPx * 2)
			val height = max(1f, viewport.height - paddingPx * 2)
			val zoom = min(width / max(bounds.width, 1e-3f), height / max(bounds.height, 1e-3f))
			return CameraPosition(bounds.centerX, bounds.centerY, zoom)
		}
	}
}
