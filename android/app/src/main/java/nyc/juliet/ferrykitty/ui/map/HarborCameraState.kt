package nyc.juliet.ferrykitty.ui.map

import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.DecayAnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Velocity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Where the harbor map looks. Hoisted in FerryApp and saved across rotation, tab and layout changes. The position is
 * snapshot state read only while drawing and placing, so panning, flinging and easing redraw the chart without
 * recomposing the screen.
 */
@Stable
class HarborCameraState internal constructor(saved: CameraPosition?, followsFit: Boolean, focusedBoatId: String?, consumedFocusRequest: String? = null) {
	constructor() : this(null, true, null)

	/** The current view, or null until the map has been laid out once. */
	internal var position: CameraPosition? by mutableStateOf(saved)
		private set

	/** True once a viewport is known, so effects can wait for it. */
	internal var ready: Boolean by mutableStateOf(false)
		private set

	/** Until the user moves the map it keeps fitting the harbor as data and window sizes change. */
	internal var followsFit: Boolean = followsFit
		private set

	/** The vessel the camera last eased to, so a restored screen does not chase it again. */
	internal var focusedBoatId: String? = focusedBoatId
	/** Retained with the camera so remounting or restoring it cannot replay a consumed request. */
	internal var consumedFocusRequest: String? = consumedFocusRequest

	internal var viewport: ViewportSize = ViewportSize(0f, 0f)
		private set
	internal var fit: CameraPosition? = null
		private set
	internal var panBounds: UnitRect = ChartGeometry.DEFAULT_BOUNDS
		private set

	private var harbor: UnitRect = ChartGeometry.DEFAULT_BOUNDS
	private var paddingPx = 0f
	private var motion: Job? = null
	private var motionTarget: CameraPosition? = null

	internal fun setHarbor(harbor: UnitRect, pan: UnitRect, paddingPx: Float) {
		if (harbor == this.harbor && pan == panBounds && paddingPx == this.paddingPx) return
		this.harbor = harbor
		this.panBounds = pan
		this.paddingPx = paddingPx
		relayout()
	}

	internal fun setViewport(viewport: ViewportSize) {
		if (viewport == this.viewport) return
		this.viewport = viewport
		relayout()
	}

	private fun relayout() {
		if (viewport.isEmpty) return
		val target = motionTarget
		stop()
		val newFit = CameraPosition.fit(harbor, viewport, paddingPx)
		fit = newFit
		position = MapCamera.adapt(target ?: position, followsFit, newFit, panBounds)
		ready = true
	}

	/** Ends any easing or fling, for example when a finger touches the map. */
	internal fun stop() {
		motion?.cancel()
		motion = null
		motionTarget = null
	}

	/** One gesture step: pan by the centroid's movement, then zoom about the current centroid. */
	internal fun transform(centroid: Offset, pan: Offset, zoom: Float) {
		val current = position ?: return
		val fit = fit ?: return
		followsFit = false
		val moved = current.panned(pan.x, pan.y).zoomedAbout(centroid.x, centroid.y, zoom, viewport, MapCamera.zoomLimits(fit))
		position = MapCamera.constrain(moved, fit, panBounds)
	}

	internal fun fling(scope: CoroutineScope, velocity: Velocity, decay: DecayAnimationSpec<Offset>) {
		if (position == null) return
		followsFit = false
		launchMotion(scope, null) {
			var last = Offset.Zero
			AnimationState(Offset.VectorConverter, Offset.Zero, Offset(velocity.x, velocity.y)).animateDecay(decay) {
				val current = position
				if (current == null) {
					cancelAnimation()
					return@animateDecay
				}
				val next = current.panned(value.x - last.x, value.y - last.y).clamped(panBounds)
				last = value
				if (next == current) cancelAnimation() else position = next
			}
		}
	}

	/** Zoom buttons and double tap: [factor] about a screen point (the center when null). */
	internal fun zoomBy(scope: CoroutineScope, factor: Float, focus: Offset? = null) {
		val from = motionTarget ?: position ?: return
		val fit = fit ?: return
		followsFit = false
		val x = focus?.x ?: (viewport.width / 2f)
		val y = focus?.y ?: (viewport.height / 2f)
		val target = MapCamera.constrain(from.zoomedAbout(x, y, factor, viewport, MapCamera.zoomLimits(fit)), fit, panBounds)
		animateTo(scope, target, durationMillis = 280)
	}

	internal fun fitHarbor(scope: CoroutineScope) {
		val fit = fit ?: return
		followsFit = true
		animateTo(scope, fit)
	}

	/** Eases to a point at no less than 5× fit; [boatId] records which vessel is being followed. */
	internal fun focus(scope: CoroutineScope, x: Float, y: Float, boatId: String? = null) {
		val fit = fit ?: return
		if (boatId != null) focusedBoatId = boatId
		followsFit = false
		animateTo(scope, MapCamera.focus(motionTarget ?: position, x, y, fit, panBounds), durationMillis = 420)
	}

	private fun animateTo(scope: CoroutineScope, target: CameraPosition, durationMillis: Int = 360) {
		val from = position
		if (from == null || from == target) {
			stop()
			position = target
			return
		}
		launchMotion(scope, target) {
			animate(0f, 1f, animationSpec = tween(durationMillis, easing = FastOutSlowInEasing)) { value, _ ->
				position = from.interpolate(target, value)
			}
		}
	}

	private fun launchMotion(scope: CoroutineScope, target: CameraPosition?, block: suspend CoroutineScope.() -> Unit) {
		stop()
		motionTarget = target
		val job = scope.launch(start = CoroutineStart.LAZY) {
			try {
				block()
			} finally {
				if (motion === coroutineContext[Job]) {
					motion = null
					motionTarget = null
				}
			}
		}
		motion = job
		job.start()
	}

	companion object {
		/** Saves the settled view (an easing's destination), whether it still follows the fit, and the followed vessel. */
		val Saver = listSaver<HarborCameraState, Any>(
			save = { state ->
				val position = state.motionTarget ?: state.position
				listOf(position?.centerX ?: Float.NaN, position?.centerY ?: Float.NaN, position?.zoom ?: Float.NaN,
					state.followsFit, state.focusedBoatId.orEmpty(), state.consumedFocusRequest.orEmpty())
			},
			restore = { values ->
				val x = values[0] as Float
				val y = values[1] as Float
				val zoom = values[2] as Float
				val position = if (x.isFinite() && y.isFinite() && zoom.isFinite() && zoom > 0f) CameraPosition(x, y, zoom) else null
				HarborCameraState(position, values[3] as Boolean, (values[4] as String).ifEmpty { null }, (values.getOrNull(5) as? String)?.ifEmpty { null })
			},
		)
	}
}

/** The harbor map's camera, to hoist above the tabs and layouts that show the map. */
@Composable
fun rememberHarborCameraState(): HarborCameraState = rememberSaveable(saver = HarborCameraState.Saver) { HarborCameraState() }
