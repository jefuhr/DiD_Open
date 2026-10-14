package nyc.juliet.ferryboard.core

import java.net.URI
import java.time.Instant
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

data class WidgetDeparture(val id: String, val time: String, val route: String, val destination: String, val detail: String, val countdown: String, val estimated: Boolean)

object NearbyWidgetBoard {
	const val liveLifetime: Double = 300.0
	const val locationLifetime: Double = 21600.0
	const val maximumRows: Int = 12

	fun fitCandidates(available: Int, maximum: Int): List<Int> = (minOf(available, maximum).coerceAtLeast(1) downTo 1).toList()
	fun usableLocation(at: Instant, now: Instant): Boolean = ServiceClock.elapsed(at, now) in 0.0..locationLifetime
	private fun valid(latitude: Double, longitude: Double): Boolean = latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0
	fun nearest(landings: List<Landing>, latitude: Double, longitude: Double): Landing? {
		if (!valid(latitude, longitude)) return null
		fun radians(value: Double) = value * Math.PI / 180
		return landings.mapNotNull { landing ->
			val lat = landing.latitude ?: return@mapNotNull null
			val lon = landing.longitude ?: return@mapNotNull null
			if (!valid(lat, lon)) return@mapNotNull null
			val distance = sin(radians(lat - latitude) / 2).pow(2) + cos(radians(latitude)) * cos(radians(lat)) * sin(radians(lon - longitude) / 2).pow(2)
			landing to distance
		}.minByOrNull { it.second }?.first
	}

	fun freshRealtime(realtime: Realtime, receivedAt: Instant?, now: Instant): Realtime {
		val fetchedAt = ServiceClock.instant(realtime.fetchedAt) ?: return Realtime.empty
		if (receivedAt == null || realtime.available == false || realtime.stale || ServiceClock.elapsed(receivedAt, now) !in 0.0..liveLifetime || ServiceClock.elapsed(fetchedAt, now) !in 0.0..liveLifetime) return Realtime.empty
		return if (realtime.vehiclesStale == true) realtime.copy(vehicles = emptyList()) else realtime
	}

	fun departures(data: DisplayData, realtime: Realtime, receivedAt: Instant?, now: Instant, options: WidgetOptions = WidgetOptions()): List<WidgetDeparture> {
		val live = freshRealtime(realtime, receivedAt, now)
		val schedule = data.copy(meta = data.meta.copy(showDwellTimes = options.showDwells, showLayoverTimes = options.showLayovers,
			departureWindowMinutes = if (options.departureWindowMinutes > 0) options.departureWindowMinutes else data.meta.departureWindowMinutes))
		val window = schedule.meta.departureWindowMinutes * 60.0
		fun visible(row: ScheduledDeparture): Boolean {
			val operatorName = row.departure.`operator` ?: schedule.routes[row.departure.routeId]?.`operator` ?: schedule.meta.agencyName ?: "NYC Ferry"
			return row.delta <= window && options.filters.allows(row.departure, operatorName)
		}
		val rows = if (options.sortByRoute) ScheduleEngine.groups(schedule, live, now = now).flatMap { group ->
			val visibleRows = group.departures.filter(::visible)
			if (options.departuresPerRoute > 0) visibleRows.take(options.departuresPerRoute) else visibleRows
		} else ScheduleEngine.timeline(schedule, live, now = now).filter(::visible)
		return rows.take(maximumRows).map { row ->
			val departure = row.departure
			val route = schedule.routes[departure.routeId]?.shortName ?: departure.routeId
			val details = mutableListOf<String>()
			if (options.showAssignments) departure.boatAssignment?.let { details.add("$route$it") }
			if (options.showBoatNames) {
				if (row.boatName != null) details.add(row.boatName)
				else row.predictedBoatName?.let { details.add("Pred. $it") }
			}
			if (options.showAssignments && !departure.crewBoats.isNullOrEmpty()) details.add(departure.crewBoats.joinToString("/"))
			when {
				departure.crewShuttle == true -> details.add("CREW")
				departure.fromHomePort == true -> details.add("FROM PIER C")
				departure.destination.equals("Pier C", ignoreCase = true) -> details.add("TO PIER C")
				departure.outOfService == true -> details.add("OOS")
			}
			if (departure.arrival == true) details.add("ARR")
			departure.secondsEnd?.let { details.add("until ${ServiceClock.time(it, options.twelveHour)}") }
			if (departure.approximate == true) details.add("Approx.")
			if (!departure.endsShift.isNullOrEmpty() && departure.outOfService != true && departure.crewShuttle != true) details.add(if (departure.endsShift == "unsure") "FINAL?" else "FINAL")
			if (row.isLastOfDay) details.add("LAST")
			val pauses = ScheduleEngine.departurePauses(schedule, row, live)
			pauses.dwellMinutes?.takeIf { it > 0 }?.let { details.add("Dwell ${it}m") }
			pauses.layover?.let { details.add("${if (it.hasLiveTiming) "Est. turn" else "Turn"} ${it.minutes}m") }
			WidgetDeparture(row.id, ServiceClock.time(departure.seconds + row.delay, options.twelveHour), route, departure.destination,
				details.joinToString(" · "), if (row.delta <= 90) { if (departure.arrival == true) "Arriving" else "Due" } else row.relativeTime, row.hasLiveTiming)
		}
	}
}

sealed interface FerryWidgetLink {
	data object Nearby : FerryWidgetLink
	data class Landing(val id: Int) : FerryWidgetLink
	companion object {
		fun parse(text: String): FerryWidgetLink? {
			val uri = try { URI(text) } catch (_: Exception) { return null }
			if (!uri.scheme.equals("ferryboard", ignoreCase = true)) return null
			if (uri.host == "nearby" && uri.path in listOf("", "/")) return Nearby
			if (uri.host != "landing" || !uri.path.matches(Regex("/[0-9]+"))) return null
			return uri.path.drop(1).toIntOrNull()?.takeIf { it > 0 }?.let { Landing(it) }
		}
	}
}
