package nyc.juliet.ferryboard.ui.ride

import nyc.juliet.ferryboard.core.RideStop
import nyc.juliet.ferryboard.core.ServiceClock
import java.time.Instant
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToLong

/** Ride wording ported from ios/FerryBoard/RideView.swift. */
object RideFormat {
	fun time(instant: Instant?, timezone: String, twelveHour: Boolean): String =
		instant?.let { ServiceClock.time(ServiceClock.parts(it, timezone).seconds, twelveHour) } ?: "—"

	/** Both clocks stay visible elsewhere; a dwell or layover reads as minutes, keeping seconds when short. */
	fun duration(seconds: Double): String {
		val whole = max(0L, seconds.roundToLong())
		val minutes = whole / 60
		val remainder = whole % 60
		if (minutes == 0L) return "$remainder sec"
		return if (remainder == 0L) "$minutes min" else "${minutes}m ${remainder}s"
	}

	fun service(stop: RideStop, final: Boolean = false): String? = when {
		stop.pickupType == 1 && stop.dropOffType == 1 -> "No pickup or drop-off"
		stop.dropOffType == 1 -> "Pickup only"
		final -> "Final drop-off"
		stop.pickupType == 1 -> "Drop-off only"
		else -> null
	}

	fun tripState(state: String): String =
		if (state == "reassigned") "Assignment changed" else state.replaceFirstChar { it.titlecase(Locale.US) }

	fun countdown(arrival: Boolean, at: Instant, now: Instant): String {
		val minutes = max(0, ceil((at.toEpochMilli() - now.toEpochMilli()) / 60_000.0).toInt())
		return "${if (arrival) "Arrival" else "Departure"} ${if (minutes == 0) "due now" else "in $minutes min"}"
	}

	fun epochMillis(value: Double?): Instant? = value?.let { ServiceClock.fromEpochSeconds(it / 1000) }
}
