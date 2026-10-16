package nyc.juliet.ferrykitty.platform

import kotlinx.coroutines.CancellationException
import nyc.juliet.ferrykitty.core.*
import java.time.Instant

data class LocationFix(val latitude: Double, val longitude: Double, val at: Instant)
sealed interface LocationResult {
	data class Fix(val value: LocationFix) : LocationResult
	data object Unavailable : LocationResult
	data object NotAuthorized : LocationResult
}

data class WidgetPresentation(
	val landingId: Int? = null,
	val landingName: String = "Nearby ferries",
	val locationLabel: String? = null,
	val message: String? = null,
	val rows: List<WidgetDeparture> = emptyList(),
	val updatedAt: Instant? = null,
	val renderedAt: Instant = Instant.now(),
	val saved: Boolean = true,
	val expiresAt: Instant? = null,
	val estimatesAt: Instant? = null,
)

/** Shared core projections are rebuilt at the actual job time, never labeled continuously live. */
internal class WidgetDataSource(private val repository: FerryRepository, private val settings: WidgetSettingsStore, private val clock: () -> Instant) {
	suspend fun presentation(options: WidgetOptions, authorized: Boolean, fix: LocationResult?, network: Boolean): WidgetPresentation {
		val now = clock()
		var landing: LastWidgetLanding? = null
		var locationLabel = "Fixed landing"
		// Reject revoked permission before even reading cached location, regardless of connectivity.
		if (options.automaticLanding && (!authorized || fix == LocationResult.NotAuthorized)) { settings.saveLastLanding(null); return WidgetPresentation(message = "Location is not allowed. Tap to enable it or choose a fixed landing.", renderedAt = now) }
		val roster = if (network) fetch<LandingRoster>(FerryEndpoint("api/landings")) else repository.saved<LandingRoster>(FerryEndpoint("api/landings"))
		if (options.automaticLanding) {
			if (fix is LocationResult.Fix) {
				NearbyWidgetBoard.nearest(roster?.value?.landings.orEmpty(), fix.value.latitude, fix.value.longitude)?.let {
					landing = LastWidgetLanding(it.id, it.displayName, fix.value.at.toEpochMilli()); settings.saveLastLanding(landing)
					locationLabel = "Nearest landing"
				}
			}
			if (landing == null) {
				when (val decision = widgetLocationDecision(options, true, settings.lastLanding(), now)) {
					is WidgetLocationDecision.LastLocation -> { landing = decision.landing; locationLabel = "Last location · waiting for GPS" }
					else -> return WidgetPresentation(message = "Location is unavailable. Tap to try again or choose a fixed landing.", renderedAt = now)
				}
			}
		} else {
			val id = options.landingId ?: return WidgetPresentation(message = "Choose a fixed landing in widget settings.", renderedAt = now)
			if (roster != null && roster.value.landings.none { it.id == id }) return WidgetPresentation(message = "This landing is no longer available. Choose another in widget settings.", renderedAt = now)
			landing = LastWidgetLanding(id, roster?.value?.landings?.firstOrNull { it.id == id }?.displayName ?: options.landingName ?: "Landing $id", now.toEpochMilli())
		}
		val selected = landing
		if (options.automaticLanding && roster != null && roster.value.landings.none { it.id == selected.id }) { settings.saveLastLanding(null); return WidgetPresentation(message = "Choose a landing in Ferry Kitty.", renderedAt = now) }
		val endpoint = FerryEndpoint("api/display-data", mapOf("landingId" to "${selected.id}"))
		val schedule = if (network) fetch<DisplayData>(endpoint) else repository.saved<DisplayData>(endpoint)
		val realtimeEndpoint = FerryEndpoint("api/realtime", mapOf("landingId" to "${selected.id}"))
		val realtime = if (network) fetch<Realtime>(realtimeEndpoint) else repository.saved<Realtime>(realtimeEndpoint)
		val created = clock()
		if (options.automaticLanding && !NearbyWidgetBoard.usableLocation(Instant.ofEpochMilli(selected.atEpochMillis), created)) return WidgetPresentation(message = "Location needs a refresh. Tap to open Ferry Kitty.", renderedAt = created)
		val rows = schedule?.let { NearbyWidgetBoard.departures(it.value, if (realtime?.saved == false) realtime.value else Realtime.empty, realtime?.receivedAt, created, options) }.orEmpty()
		val expirations = mutableListOf<Instant>()
		if (options.automaticLanding) {
			expirations.add(Instant.ofEpochMilli(selected.atEpochMillis).plusSeconds(if (locationLabel == "Nearest landing") 900 else 21_600))
		}
		if (realtime?.saved == false && realtime.value.available != false && !realtime.value.stale) {
			ServiceClock.instant(realtime.value.fetchedAt)?.plusSeconds(300)?.let(expirations::add)
			expirations.add(realtime.receivedAt.plusSeconds(300))
		}
		return WidgetPresentation(selected.id, schedule?.value?.meta?.landing?.displayName ?: selected.name, locationLabel,
			if (schedule == null) "Schedule unavailable. Tap to open the board." else if (rows.isEmpty()) if (options.filters.isActive) "No departures match your widget filters in this window." else "No upcoming ferries in the schedule window." else null,
			rows, schedule?.receivedAt, created, schedule?.saved ?: true, expirations.filter { it.isAfter(created) }.minOrNull(),
			if (rows.any { it.estimated }) ServiceClock.instant(realtime?.value?.fetchedAt) else null)
	}
	private suspend inline fun <reified T> fetch(endpoint: FerryEndpoint): SavedResponse<T>? = try { repository.fetch<T>(endpoint) } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
}
