package nyc.juliet.ferryboard.contract

import kotlinx.serialization.Serializable
import nyc.juliet.ferryboard.core.*
import java.time.Instant

@Serializable
enum class FerryTab { DEPARTURES, MAP }

enum class FerrySheet { LANDINGS, FILTERS, SETTINGS, ALERTS, VESSELS, WIDGET, CHANGELOG, TRIP, BOAT, BRIDGE, SEAMARK }

@Serializable
data class AppPreferences(
	val landingId: Int? = null,
	val favorites: Set<Int> = emptySet(),
	val hiddenOperators: Set<String> = emptySet(),
	val hiddenRoutes: Set<String> = emptySet(),
	val hiddenNYCMovements: Set<NYCFerryMovement> = emptySet(),
	val sortByRoute: Boolean = false,
	val twelveHour: Boolean = false,
	val theme: String = "nyc-ferry",
	val textSize: String = "system",
	val launchLanding: String = "lastUsed",
	val homeLandingId: Int? = null,
	val launchTab: String = "departures",
	val lastTab: FerryTab = FerryTab.DEPARTURES,
	val showDwellTimes: Boolean = true,
	val showLayoverTimes: Boolean = true,
	val showMarineReferences: Boolean = true,
	val departuresPerRoute: Int = 0,
	val departureWindowMinutes: Int = 0,
	val keepScreenAwake: Boolean = false,
) {
	val filters: DepartureFilters get() = DepartureFilters(hiddenOperators, hiddenRoutes, hiddenNYCMovements)
}

@Serializable
data class RideSession(val vessel: Vessel, val startedAtEpochMillis: Long, val returnTab: FerryTab)

data class TripDetail(
	val row: ScheduledDeparture,
	val data: DisplayData,
	val connections: Connections? = null,
	val loading: Boolean = false,
	val note: String? = null,
)

/** Shared contract: UI emits actions; Android state owns network, storage, and lifecycle. */
data class FerryUiState(
	val preferences: AppPreferences = AppPreferences(),
	val tab: FerryTab = FerryTab.DEPARTURES,
	val sheet: FerrySheet? = null,
	val roster: LandingRoster? = null,
	val schedule: DisplayData? = null,
	val scheduleSaved: Boolean = false,
	val realtime: Realtime = Realtime.empty,
	val boardRows: List<ScheduledDeparture> = emptyList(),
	val boardGroups: List<DepartureGroup> = emptyList(),
	val landingTitle: String = "Choose a landing",
	val boardStatus: String = "CONNECTING",
	val boardNote: String? = null,
	val updatedAt: Instant? = null,
	val loadingLanding: Boolean = false,
	val refreshing: Boolean = false,
	val boardError: String? = null,
	val offlineWarning: String? = null,
	val viewDate: String? = null,
	val now: Instant = Instant.now(),
	val alerts: Alerts? = null,
	val harbor: Harbor? = null,
	val boats: Boats? = null,
	val mapError: String? = null,
	val mapSearch: String = "",
	val routeFilter: String? = null,
	val selectedBoatId: String? = null,
	val wantedVesselName: String? = null,
	/** One explicit Find Boat request, independent of the retained vessel selection. */
	val boatFocusRequest: String? = null,
	val vessels: List<Vessel> = emptyList(),
	val selectedBoat: Boat? = null,
	val selectedBridge: Bridge? = null,
	val selectedSeamark: Seamark? = null,
	val trip: TripDetail? = null,
	val rideSession: RideSession? = null,
	val ride: Ride? = null,
	val showingRide: Boolean = false,
	val rideError: String? = null,
	val changelog: Changelog? = null,
	val locationStatus: String? = null,
	val locating: Boolean = false,
	val widgetOptions: WidgetOptions = WidgetOptions(),
	val widgetUseAppDefaults: Boolean = true,
	val configuringWidget: Boolean = false,
	val widgetStatus: String? = null,
)

sealed interface FerryAction {
	data class SelectTab(val tab: FerryTab) : FerryAction
	data class OpenSheet(val sheet: FerrySheet?) : FerryAction
	data class SelectLanding(val id: Int) : FerryAction
	data class ToggleFavorite(val id: Int) : FerryAction
	data class SetPreferences(val preferences: AppPreferences) : FerryAction
	data class SelectDate(val date: String?) : FerryAction
	data class StepDate(val days: Int) : FerryAction
	data object Refresh : FerryAction
	data object ResetFilters : FerryAction
	data object FindNearest : FerryAction
	data class OpenTrip(val row: ScheduledDeparture) : FerryAction
	data class OpenBoat(val id: String) : FerryAction
	data class FindBoat(val name: String) : FerryAction
	data class SetMapSearch(val query: String) : FerryAction
	data class SetRouteFilter(val id: String?) : FerryAction
	data class OpenBridge(val bridge: Bridge) : FerryAction
	data class OpenSeamark(val seamark: Seamark) : FerryAction
	data class StartRide(val vessel: Vessel) : FerryAction
	data object ShowRide : FerryAction
	data object MinimizeRide : FerryAction
	data object ExitRide : FerryAction
	data class SetWidgetOptions(val options: WidgetOptions) : FerryAction
	data class SetWidgetUseDefaults(val enabled: Boolean) : FerryAction
	data object CopySettingsToWidget : FerryAction
	data object ResetWidgetFilters : FerryAction
	data object EnableWidgetLocation : FerryAction
	data object RefreshWidgets : FerryAction
	data object PinWidget : FerryAction
	data class OpenUrl(val url: String) : FerryAction
}
