package nyc.juliet.ferrykitty.ui.map

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/** The bundled chart: still loading, parsed with ready-made paths, or unavailable (water, routes and landings only). */
internal sealed interface ChartLoad {
	data object Loading : ChartLoad
	class Ready(val geometry: ChartGeometry, val paths: ChartPaths) : ChartLoad
	data object Unavailable : ChartLoad
}

internal val ChartLoad.geometry: ChartGeometry? get() = (this as? ChartLoad.Ready)?.geometry

internal val ChartLoad.status: ChartStatus
	get() = when (this) {
		ChartLoad.Loading -> ChartStatus.LOADING
		is ChartLoad.Ready -> ChartStatus.READY
		ChartLoad.Unavailable -> ChartStatus.UNAVAILABLE
	}

internal class ShapePath(val path: Path, val bounds: UnitRect)

internal class StreetPath(val street: ChartStreet, val path: Path)

/** Paths for every chart feature in drawing units, built once beside the parse so drawing only culls and strokes. */
internal class ChartPaths(geometry: ChartGeometry) {
	val land: List<ShapePath> = geometry.land.map { polygon ->
		val path = Path().apply { fillType = PathFillType.EvenOdd }
		for (ring in polygon.rings) path.addPolyline(ring, close = true)
		ShapePath(path, polygon.bounds)
	}
	val parks: List<ShapePath> = geometry.parks.map { ShapePath(Path().apply { addPolyline(it.points, close = true) }, it.bounds) }
	val channels: List<ShapePath> = geometry.channels.map { ShapePath(Path().apply { addPolyline(it.points, close = false) }, it.bounds) }
	val streets: List<StreetPath> = geometry.streets.map { StreetPath(it, Path().apply { addPolyline(it.points, close = false) }) }
}

/** Appends x, y pairs as one subpath. */
internal fun Path.addPolyline(points: FloatArray, close: Boolean) {
	if (points.size < 4) return
	moveTo(points[0], points[1])
	var index = 2
	while (index + 1 < points.size) {
		lineTo(points[index], points[index + 1])
		index += 2
	}
	if (close) close()
}

/**
 * Reads `assets/harbor-chart.json` (copied by Gradle from content/) once per process: the file is read on the IO
 * dispatcher and parsed on Dispatchers.Default, then shared by the harbor map and the ride mini map.
 */
internal object HarborChartStore {
	const val ASSET = "harbor-chart.json"
	private val started = AtomicBoolean(false)
	private val state = MutableStateFlow<ChartLoad>(ChartLoad.Loading)
	private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

	fun chart(context: Context): StateFlow<ChartLoad> {
		if (started.compareAndSet(false, true)) {
			val assets = context.applicationContext.assets
			scope.launch {
				state.value = try {
					val text = withContext(Dispatchers.IO) { assets.open(ASSET).bufferedReader().use { it.readText() } }
					val geometry = ChartParser.parse(text)
					if (geometry.isEmpty) ChartLoad.Unavailable else ChartLoad.Ready(geometry, ChartPaths(geometry))
				} catch (_: Exception) {
					ChartLoad.Unavailable
				}
			}
		}
		return state
	}
}

@Composable
internal fun rememberHarborChart(): ChartLoad {
	val context = LocalContext.current
	val chart = remember { HarborChartStore.chart(context) }
	return chart.collectAsState().value
}
