package nyc.juliet.ferryboard.ui.map

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.semantics.SemanticsPropertyKey

/**
 * Where the map's own controls sit over the chart: the zoom and fit buttons, the scale bar and the attribution. Each
 * reports its laid-out bounds, so the space kept free of labels follows larger text or a wrapped attribution rather than
 * assumed sizes. Snapshot state: when a control moves or resizes, the chart re-places its labels on the next frame.
 */
@Stable
internal class MapOverlays {
	private var chart by mutableStateOf(Offset.Zero)
	private val covered = mutableStateMapOf<String, Rect>()

	fun chartPlaced(coordinates: LayoutCoordinates) {
		chart = coordinates.positionInRoot()
	}

	fun controlPlaced(key: String, coordinates: LayoutCoordinates) {
		val bounds = coordinates.boundsInRoot()
		if (covered[key] != bounds) covered[key] = bounds
	}

	/** The covered areas in the chart canvas's pixels. Reading them while drawing redraws the chart when they change. */
	val areas: List<Rect>
		get() {
			val origin = chart
			return covered.values.map { it.translate(-origin) }
		}
}

/** Reports this control's bounds as [key] to [overlays], so the chart keeps its labels clear of it. */
internal fun Modifier.coversMap(overlays: MapOverlays, key: String): Modifier = onGloballyPositioned { overlays.controlPlaced(key, it) }

/** The chart's overlay registry, for instrumentation to compare with the controls' bounds. Accessibility services ignore it. */
internal val MapOverlaysKey = SemanticsPropertyKey<MapOverlays>("FerryMapOverlays")
