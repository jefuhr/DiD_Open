package nyc.juliet.ferrykitty.ui.map

import kotlin.math.roundToInt

/**
 * Where the harbor map puts its companion lists, decided from the map screen's own content area: the space left after
 * the navigation shell, system bars and padding, not the window. The lists sit beside the chart only in landscape space
 * where the chart still keeps [MIN_CHART_BESIDE_DP] after the panel and its divider; otherwise they stack below it.
 */
internal object MapLayout {
	const val MIN_CHART_BESIDE_DP = 480f

	/** Below this height the lists stay below the chart, collapsed, under a compact header. */
	const val MIN_HEIGHT_BESIDE_DP = 480f
	const val PANEL_DP = 300f
	const val WIDE_PANEL_DP = 360f
	const val DIVIDER_DP = 1f

	/**
	 * The side panel's width in dp, the wider one when the chart can spare it, or null to stack the lists below. The
	 * chart's share is counted in whole pixels at [density], as the row lays it out, so it never falls short of 480 dp.
	 */
	fun sidePanelWidth(widthDp: Float, heightDp: Float, density: Float = 1f): Float? {
		if (widthDp <= heightDp || heightDp < MIN_HEIGHT_BESIDE_DP) return null
		val width = (widthDp * density).roundToInt()
		fun keepsChart(panelDp: Float) =
			width - (panelDp * density).roundToInt() - (DIVIDER_DP * density).roundToInt() >= MIN_CHART_BESIDE_DP * density
		return when {
			keepsChart(WIDE_PANEL_DP) -> WIDE_PANEL_DP
			keepsChart(PANEL_DP) -> PANEL_DP
			else -> null
		}
	}
}
