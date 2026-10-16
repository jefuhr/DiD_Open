package nyc.juliet.ferrykitty.ui.map

data class ScaleBarSpec(val lengthPx: Float, val label: String)

/** The map's scale bar: the longest round distance that fits, in metres and kilometres or feet and miles. */
object ScaleBar {
	private const val METRES_PER_FOOT = 0.3048
	private const val METRES_PER_MILE = 1609.344

	private val metric: List<Pair<Double, String>> =
		listOf(5, 10, 20, 50, 100, 200, 500).map { it.toDouble() to "$it m" } + listOf(1, 2, 5, 10, 20, 50).map { it * 1000.0 to "$it km" }

	private val imperial: List<Pair<Double, String>> =
		listOf(10, 20, 50, 100, 200, 500, 1000, 2000).map { it * METRES_PER_FOOT to "$it ft" } +
			listOf(0.5 * METRES_PER_MILE to "0.5 mi") + listOf(1, 2, 5, 10, 20, 50).map { it * METRES_PER_MILE to "$it mi" }

	fun of(metresPerPixel: Double, maxLengthPx: Float, imperial: Boolean): ScaleBarSpec? {
		if (!metresPerPixel.isFinite() || metresPerPixel <= 0.0 || !maxLengthPx.isFinite() || maxLengthPx <= 0f) return null
		val steps = if (imperial) this.imperial else metric
		val longest = metresPerPixel * maxLengthPx
		val step = steps.lastOrNull { it.first <= longest } ?: steps.first()
		return ScaleBarSpec((step.first / metresPerPixel).toFloat(), step.second)
	}

	/** Ground distance per screen pixel at the camera's center. */
	fun metresPerPixel(camera: CameraPosition): Double =
		HarborProjection.metresPerUnit(HarborProjection.latitude(camera.centerY)) / camera.zoom
}
