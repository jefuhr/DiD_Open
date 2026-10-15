package nyc.juliet.ferryboard.ui.theme

/**
 * The text size preference applied over the device font scale. A large device font always wins: Compact only tightens
 * the default size and Larger only raises smaller ones, matching the iOS rule that accessibility sizes are respected.
 */
object TextScale {
	const val COMPACT = 0.9f
	const val LARGER = 1.2f

	/** At and above this, rows stack and boards keep one column. */
	const val ACCESSIBILITY = 1.5f

	fun resolve(system: Float, preference: String): Float = when (preference) {
		"compact" -> if (system > 1f) system else minOf(system, COMPACT)
		"larger" -> maxOf(system, LARGER)
		else -> system
	}

	fun isAccessibilityText(scale: Float): Boolean = scale >= ACCESSIBILITY

	val choices: List<Pair<String, String>> = listOf("system" to "System", "compact" to "Compact", "larger" to "Larger")

	fun label(preference: String): String = choices.firstOrNull { it.first == preference }?.second ?: "System"
}
