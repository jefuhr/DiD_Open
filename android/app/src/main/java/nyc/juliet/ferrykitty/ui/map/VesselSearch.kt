package nyc.juliet.ferrykitty.ui.map

import nyc.juliet.ferrykitty.core.Boat
import nyc.juliet.ferrykitty.ui.theme.ColorMath

/** Vessel naming, search and freshness rules shared by the map markers and their companion list. */
object VesselSearch {
	const val LIGHT_TEXT = ColorMath.WHITE
	const val DARK_TEXT = ColorMath.NEAR_BLACK

	/** A fix older than this is drawn as last reported, as on the web map and iOS. */
	const val STALE_FIX_SECONDS = 180.0

	/** Unknown-route markers use a neutral slate rather than pretending to a route color. */
	const val NEUTRAL_MARKER = 0xFF5D6B78

	/** "H-204" is drawn and searched as "H204"; a vessel without a hull number is marked "?". */
	fun compactHull(number: String?): String = (number ?: "").replace("-", "").trim()

	fun hullLabel(number: String?): String = compactHull(number).uppercase().ifEmpty { "?" }

	/** Name, hull, destination and stop; a hull query matches with or without its dash, whichever spelling the feed sends. */
	fun matches(boat: Boat, query: String): Boolean {
		val needle = query.trim()
		if (needle.isEmpty()) return true
		val hull = compactHull(boat.number)
		val compactNeedle = compactHull(needle)
		if (hull.isNotEmpty() && compactNeedle.isNotEmpty() && hull.contains(compactNeedle, ignoreCase = true)) return true
		return listOf(boat.name, boat.number.orEmpty(), hull, boat.destination.orEmpty(), boat.stop?.name.orEmpty())
			.joinToString(" ").contains(needle, ignoreCase = true)
	}

	fun filter(boats: List<Boat>, query: String, routeFilter: String?): List<Boat> =
		boats.filter { (routeFilter == null || it.routeId == routeFilter) && matches(it, query) }

	fun isStale(boat: Boat, feedStale: Boolean): Boolean = feedStale || (boat.ageSeconds ?: 0.0) > STALE_FIX_SECONDS

	/** Fresh enough to start a ride from the map without asking which boat. */
	fun isFresh(boat: Boat, feedStale: Boolean): Boolean {
		val age = boat.ageSeconds ?: return false
		return !feedStale && age in 0.0..STALE_FIX_SECONDS
	}

	fun markerColor(boat: Boat): Long = ColorMath.parseHex(boat.color) ?: NEUTRAL_MARKER

	fun textOn(hex: String?): Long = ColorMath.readableOn(ColorMath.parseHex(hex) ?: NEUTRAL_MARKER)

	/** A last-reported marker fades toward [background] (the water); its label is then chosen for the faded color. */
	fun markerFill(boat: Boat, stale: Boolean, background: Long): Long =
		if (stale) ColorMath.blend(markerColor(boat), background, STALE_OPACITY) else markerColor(boat)

	fun markerText(fill: Long): Long = ColorMath.readableOn(fill)

	/** How much of the route color a stale marker keeps. */
	const val STALE_OPACITY = 0.45

	/** The list's second line: where the boat is, then where it is going unless that is the same place. */
	fun doing(boat: Boat): String {
		val status = statusLine(boat)
		val destination = boat.destination?.takeIf { it.isNotBlank() } ?: return status
		return if (samePlace(destination, boat.stop?.name)) status else "$status · to $destination"
	}

	private fun samePlace(left: String?, right: String?): Boolean {
		fun flatten(value: String?) = value.orEmpty().lowercase().filter { it.isLetterOrDigit() }
		return !left.isNullOrBlank() && flatten(left) == flatten(right)
	}

	fun statusLine(boat: Boat): String {
		val where = boat.stop?.name
		return when {
			where == null -> if (boat.status == "stopped") "Alongside" else "Under way"
			boat.status == "stopped" -> "Alongside at $where"
			boat.status == "incoming" -> "Arriving at $where"
			else -> "Next stop $where"
		}
	}

	fun ageLabel(seconds: Double?): String? = when {
		seconds == null -> null
		seconds < 45 -> "just now"
		else -> "${Math.round(seconds / 60)} min ago"
	}

	fun spokenMarker(boat: Boat, stale: Boolean): String = listOfNotNull(
		boat.name,
		boat.number,
		boat.routeName ?: boat.route,
		boat.destination?.let { "to $it" },
		statusLine(boat),
		if (stale) "last reported position" else null,
	).joinToString(", ")
}
