package nyc.juliet.ferryboard.ui.map

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateCentroidSize
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.pow

private sealed interface GestureEnd {
	class Tapped(val position: Offset) : GestureEnd
	class Flung(val velocity: Velocity) : GestureEnd
	data object Moved : GestureEnd
	data object Cancelled : GestureEnd
}

/**
 * The chart's gestures: one-finger pan with fling, two-finger pinch about the centroid, double tap to zoom in and a
 * single tap (after the double-tap window) to select. [onDown] lets a touch stop any easing or fling.
 */
internal suspend fun PointerInputScope.detectHarborGestures(
	onDown: () -> Unit,
	onTransform: (centroid: Offset, pan: Offset, zoom: Float) -> Unit,
	onFling: (Velocity) -> Unit,
	onTap: (Offset) -> Unit,
	onDoubleTap: (Offset) -> Unit,
) {
	val doubleTapSlop = 48.dp.toPx() * 2
	val minimumFling = 100.dp.toPx()
	val maximumFling = viewConfiguration.maximumFlingVelocity
	fun fling(end: GestureEnd.Flung) {
		val speed = hypot(end.velocity.x, end.velocity.y)
		if (speed < minimumFling) return
		val scale = if (speed > maximumFling) maximumFling / speed else 1f
		onFling(Velocity(end.velocity.x * scale, end.velocity.y * scale))
	}
	awaitEachGesture {
		val down = awaitFirstDown(requireUnconsumed = true)
		onDown()
		val first = follow(down, onTransform)
		if (first is GestureEnd.Flung) fling(first)
		var tap = (first as? GestureEnd.Tapped)?.position
		while (tap != null) {
			val next = withTimeoutOrNull(viewConfiguration.doubleTapTimeoutMillis) { awaitFirstDown(requireUnconsumed = true) }
			if (next == null) {
				onTap(tap)
				break
			}
			onDown()
			val second = follow(next, onTransform)
			when {
				second is GestureEnd.Tapped && (second.position - tap).getDistance() <= doubleTapSlop -> {
					onDoubleTap(second.position)
					tap = null
				}
				second is GestureEnd.Tapped -> {
					// Two taps far apart are two selections; the second may still become a double tap.
					onTap(tap)
					tap = second.position
				}
				else -> {
					if (second is GestureEnd.Flung) fling(second)
					tap = null
				}
			}
		}
	}
}

/** Follows one touch sequence until every finger lifts, applying pan and pinch once past the touch slop. */
private suspend fun AwaitPointerEventScope.follow(down: PointerInputChange, onTransform: (Offset, Offset, Float) -> Unit): GestureEnd {
	val slop = viewConfiguration.touchSlop
	val tracker = VelocityTracker()
	tracker.addPosition(down.uptimeMillis, down.position)
	var transforming = false
	var pastSlopPan = Offset.Zero
	var pastSlopZoom = 1f
	var fingers = 1
	var multiTouch = false
	while (true) {
		val event = awaitPointerEvent()
		if (event.changes.any { it.isConsumed }) return GestureEnd.Cancelled
		val pressed = event.changes.count { it.pressed }
		if (pressed == 0) {
			return when {
				!transforming && !multiTouch -> GestureEnd.Tapped(down.position)
				transforming && fingers == 1 && !multiTouch -> GestureEnd.Flung(tracker.calculateVelocity())
				else -> GestureEnd.Moved
			}
		}
		if (pressed > 1) multiTouch = true
		if (pressed != fingers) {
			fingers = pressed
			tracker.resetTracking()
		}
		val zoom = event.calculateZoom()
		val pan = event.calculatePan()
		if (!transforming) {
			pastSlopPan += pan
			pastSlopZoom *= zoom
			val zoomMotion = abs(1 - pastSlopZoom) * event.calculateCentroidSize(useCurrent = false)
			if (pastSlopPan.getDistance() > slop || zoomMotion > slop) transforming = true
		}
		if (transforming) {
			if (zoom != 1f || pan != Offset.Zero) onTransform(event.calculateCentroid(useCurrent = true), pan, zoom)
			event.changes.forEach { if (it.positionChanged()) it.consume() }
		}
		if (pressed == 1) event.changes.firstOrNull { it.pressed }?.let { tracker.addPosition(it.uptimeMillis, it.position) }
	}
}

/** Mouse wheel and touchpad scroll zoom about the pointer, for Chromebooks and tablets with a pointer. */
internal suspend fun PointerInputScope.detectScrollZoom(onZoom: (focus: Offset, factor: Float) -> Unit) {
	awaitPointerEventScope {
		while (true) {
			val event = awaitPointerEvent()
			if (event.type != PointerEventType.Scroll) continue
			val change = event.changes.firstOrNull() ?: continue
			val delta = change.scrollDelta.y
			if (delta == 0f) continue
			onZoom(change.position, 1.2f.pow(-delta))
			change.consume()
		}
	}
}
