package nyc.juliet.ferrykitty.ui.board

import nyc.juliet.ferrykitty.contract.AppPreferences
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.DisplayData
import nyc.juliet.ferrykitty.core.Realtime
import nyc.juliet.ferrykitty.core.ScheduleEngine
import nyc.juliet.ferrykitty.core.ScheduledDeparture
import nyc.juliet.ferrykitty.core.ServiceClock

/** Derived, read-only facts about the board, computed from [FerryUiState] the way the iOS store does. */
object BoardModel {
	/** Local display options never rewrite downloaded schedules or cached source data. */
	fun displaySchedule(schedule: DisplayData?, preferences: AppPreferences): DisplayData? = schedule?.let {
		it.copy(meta = it.meta.copy(
			showDwellTimes = preferences.showDwellTimes,
			showLayoverTimes = preferences.showLayoverTimes,
			departuresShown = if (preferences.departuresPerRoute > 0) preferences.departuresPerRoute else it.meta.departuresShown,
			departureWindowMinutes = if (preferences.departureWindowMinutes > 0) preferences.departureWindowMinutes else it.meta.departureWindowMinutes,
		))
	}

	fun timezone(state: FerryUiState): String = state.schedule?.meta?.timezone ?: "America/New_York"

	fun isToday(state: FerryUiState): Boolean = state.schedule?.let { ScheduleEngine.frame(it, state.viewDate, state.now).live } ?: true

	fun currentDate(state: FerryUiState): String =
		state.schedule?.let { ScheduleEngine.frame(it, state.viewDate, state.now).dateKey } ?: ServiceClock.parts(state.now, timezone(state)).dateKey

	fun today(state: FerryUiState): String = ServiceClock.parts(state.now, timezone(state)).dateKey

	fun canStep(state: FerryUiState, days: Int): Boolean {
		val schedule = state.schedule ?: return false
		return ScheduleEngine.range(schedule)?.contains(ServiceClock.addDays(currentDate(state), days)) == true
	}

	fun covers(state: FerryUiState, date: String): Boolean {
		val schedule = state.schedule ?: return false
		return ScheduleEngine.range(schedule)?.contains(date) == true
	}

	fun clock(state: FerryUiState): String = ServiceClock.time(ServiceClock.parts(state.now, timezone(state)).seconds, state.preferences.twelveHour)

	/** Whether times on the board are live estimates, saved data or the published timetable. */
	fun freshness(state: FerryUiState): String = when {
		state.schedule == null -> if (state.loadingLanding || state.boardStatus == "CONNECTING") "Loading schedule" else "No schedule yet"
		!isToday(state) -> "Published schedule"
		state.realtime.available == false -> "Scheduled · live unavailable"
		state.realtime.stale -> "Scheduled · saved data"
		else -> "Live estimates"
	}

	fun isLive(state: FerryUiState): Boolean = state.schedule != null && isToday(state) && !state.realtime.stale && state.realtime.available != false

	/** A trip sheet can open for a sailing with published calls, or a timetable-only trip. */
	fun canOpen(schedule: DisplayData?, row: ScheduledDeparture): Boolean {
		val schedules = schedule?.tripSchedules ?: return false
		val departure = row.departure
		val trip = schedules[departure.tripId] ?: schedules[departure.liveTripId ?: departure.tripId] ?: return false
		return trip.stops.size >= 2 || trip.timetableOnly == true
	}

	fun pauses(display: DisplayData?, row: ScheduledDeparture, realtime: Realtime) =
		display?.let { ScheduleEngine.departurePauses(it, row, realtime) }
}
