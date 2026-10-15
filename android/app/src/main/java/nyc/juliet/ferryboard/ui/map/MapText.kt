package nyc.juliet.ferryboard.ui.map

import nyc.juliet.ferryboard.core.Boat
import nyc.juliet.ferryboard.core.Boats

enum class ChartStatus { LOADING, READY, UNAVAILABLE }

/** The map's status line, empty states and spoken summary, matching the iOS and web wording. */
object MapText {
	fun reporting(routeLabel: String?, count: Int): String =
		(routeLabel?.let { "$it · " } ?: "") + if (count == 1) "1 reporting vessel" else "$count reporting vessels"

	/** Positions are live only while the feed is fresh; saved or failed feeds say so. */
	fun feed(boats: Boats?): String = if (boats?.stale == false) "Live" else "Saved / unavailable"

	/** A vessel asked for by name (Find boat) that has no position yet. */
	fun notReporting(wanted: String?, boats: List<Boat>): String? {
		val name = wanted?.trim()?.takeIf { it.isNotEmpty() } ?: return null
		if (boats.any { it.name == name || it.number == name || it.vesselId == name || it.id == name }) return null
		return "$name is not reporting a position right now."
	}

	fun noVessels(total: Int, searching: Boolean, routeFiltered: Boolean): String = when {
		total == 0 -> "No vessels are reporting here. Routes and landings are still shown, and you can still choose your boat."
		searching -> "No vessels match your search."
		routeFiltered -> "No vessels are reporting on this route right now."
		else -> "No vessels are reporting here."
	}

	/** The canvas's description for TalkBack; the lists below the map repeat every object on it. */
	fun summary(shown: Int, total: Int, live: Boolean, landings: Int, route: String?, marine: Boolean, chart: ChartStatus): String = buildString {
		append("Harbor map. ")
		append(if (shown == total) "$shown ${if (shown == 1) "vessel" else "vessels"} shown" else "$shown of $total vessels shown")
		append(if (live) ", live positions. " else ", last reported positions. ")
		append(if (landings == 1) "1 landing. " else "$landings landings. ")
		append(route?.let { "$it route. " } ?: "All routes. ")
		append(if (marine) "Marine references shown." else "Marine references hidden.")
		if (chart == ChartStatus.UNAVAILABLE) append(" Chart unavailable.")
	}

	fun landingNumber(id: Int): String = "Landing $id"

	const val CHART_UNAVAILABLE = "Harbor chart unavailable. Routes, landings and vessels are still shown."
}
