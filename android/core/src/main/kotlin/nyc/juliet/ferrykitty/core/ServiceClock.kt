package nyc.juliet.ferrykitty.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.floor

object ServiceClock {
	data class Parts(val dateKey: String, val seconds: Double)
	fun validTimezone(timezone: String): Boolean = try { ZoneId.of(timezone); true } catch (_: Exception) { false }
	fun calendar(timezone: String = "America/New_York"): ZoneId = try { ZoneId.of(timezone) } catch (_: Exception) { ZoneOffset.UTC }
	fun parts(now: Instant, timezone: String = "America/New_York"): Parts {
		val local = now.atZone(calendar(timezone))
		return Parts(local.toLocalDate().toString(), local.toLocalTime().toSecondOfDay().toDouble())
	}
	fun date(key: String, timezone: String = "UTC"): Instant? = try {
		LocalDate.parse(key).atTime(12, 0).atZone(calendar(timezone)).toInstant()
	} catch (_: DateTimeParseException) { null }
	fun addDays(date: String, amount: Int): String = try { LocalDate.parse(date).plusDays(amount.toLong()).toString() } catch (_: Exception) { date }
	fun instant(text: String?): Instant? = text?.let { try { Instant.parse(it) } catch (_: DateTimeParseException) { null } }
	fun elapsed(at: Instant, now: Instant): Double = (now.epochSecond - at.epochSecond).toDouble() + (now.nano - at.nano) / 1e9
	fun fromEpochSeconds(seconds: Double): Instant? {
		if (!seconds.isFinite()) return null
		val whole = floor(seconds)
		return try { Instant.ofEpochSecond(whole.toLong(), ((seconds - whole) * 1e9).toLong()) } catch (_: Exception) { null }
	}
	fun time(seconds: Double, twelveHour: Boolean = false): String {
		if (!seconds.isFinite()) return ""
		val day = ((floor(seconds) % 86400 + 86400) % 86400).toInt()
		val hour = day / 3600
		val minute = day % 3600 / 60
		return if (twelveHour) String.format(Locale.US, "%d:%02d %s", if (hour % 12 == 0) 12 else hour % 12, minute, if (hour < 12) "AM" else "PM")
		else String.format(Locale.US, "%02d:%02d", hour, minute)
	}
}
