package nyc.juliet.ferrykitty.ui.sheets

import java.text.Collator
import java.util.Locale
import nyc.juliet.ferrykitty.core.Connection
import nyc.juliet.ferrykitty.core.Departure
import nyc.juliet.ferrykitty.core.DepartureFilters
import nyc.juliet.ferrykitty.core.DisplayData
import nyc.juliet.ferrykitty.core.FerryRoute
import nyc.juliet.ferrykitty.core.Landing
import nyc.juliet.ferrykitty.core.LandingRoster

/** Operator, route and landing rules shared by the filter, landing and trip screens. */
object FilterLogic {
	private val collator: Collator = Collator.getInstance(Locale.US).apply { strength = Collator.SECONDARY }

	/** Finder-style ordering: case-insensitive, with numbers compared by value ("Route 2" before "Route 10"). */
	val natural: Comparator<String> = Comparator { left, right ->
		val a = chunks(left)
		val b = chunks(right)
		for (index in 0 until minOf(a.size, b.size)) {
			val x = a[index]
			val y = b[index]
			val result = if (x.first().isDigit() && y.first().isDigit()) {
				x.trimStart('0').length.compareTo(y.trimStart('0').length).takeIf { it != 0 } ?: x.trimStart('0').compareTo(y.trimStart('0'))
			} else collator.compare(x, y)
			if (result != 0) return@Comparator result
		}
		a.size.compareTo(b.size)
	}

	private fun chunks(text: String): List<String> {
		val result = mutableListOf<String>()
		val current = StringBuilder()
		for (character in text) {
			if (current.isNotEmpty() && current.last().isDigit() != character.isDigit()) {
				result += current.toString()
				current.clear()
			}
			current.append(character)
		}
		if (current.isNotEmpty()) result += current.toString()
		return result
	}

	fun operatorName(routeId: String, schedule: DisplayData?): String =
		schedule?.routes?.get(routeId)?.`operator` ?: schedule?.meta?.agencyName ?: "NYC Ferry"

	fun operatorName(departure: Departure, schedule: DisplayData?): String = departure.`operator` ?: operatorName(departure.routeId, schedule)

	/** The routes under an operator's switch: the roster's catalog merged with the current landing's routes. */
	fun routes(operatorName: String, roster: LandingRoster?, schedule: DisplayData?): List<Pair<String, FerryRoute>> {
		val merged = roster?.routes.orEmpty() + schedule?.routes.orEmpty()
		return merged.filter { (id, route) ->
			(route.`operator` ?: schedule?.meta?.agencyName ?: "NYC Ferry") == operatorName && !(operatorName == "NYC Ferry" && id == "CREW")
		}.toList().sortedWith { a, b -> natural.compare(a.second.name, b.second.name) }
	}

	fun visible(departure: Departure, filters: DepartureFilters, schedule: DisplayData?): Boolean =
		filters.allows(departure, operatorName(departure, schedule))

	fun visible(connection: Connection, filters: DepartureFilters, schedule: DisplayData?): Boolean =
		filters.allows(connection.routeId, connection.`operator` ?: operatorName(connection.routeId, schedule))

	/** Search by name or landing number; favorites first, then by name. */
	fun landings(landings: List<Landing>, query: String, favorites: Set<Int>): List<Landing> {
		val needle = query.trim()
		return landings.filter { needle.isEmpty() || "${it.displayName} ${it.id}".contains(needle, ignoreCase = true) }
			.sortedWith { a, b ->
				val favoriteA = a.id in favorites
				val favoriteB = b.id in favorites
				if (favoriteA != favoriteB) (if (favoriteA) -1 else 1) else natural.compare(a.displayName, b.displayName)
			}
	}

	/** Alphabetical, for pickers that list every landing. */
	fun alphabetical(landings: List<Landing>): List<Landing> = landings.sortedWith { a, b -> natural.compare(a.displayName, b.displayName) }

	/** Short route code worth showing beside a route name, as the iOS filter list does. */
	fun routeCode(route: FerryRoute): String? =
		route.shortName?.takeIf { it != route.name && it.any(Char::isLetter) }
}
