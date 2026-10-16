package nyc.juliet.ferrykitty.platform

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import nyc.juliet.ferryboard.platform.FerryWidgetProvider
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.core.NearbyWidgetBoard

class FerryViewModel(context: Context, policy: TestLaunchPolicy, widgetDraft: Boolean = false) : ViewModel() {
	val runtime = AndroidRuntime.session(context, policy)
	private val app = context.applicationContext
	private val effectChannel = Channel<FerryAction>(Channel.BUFFERED)
	val effects = effectChannel.receiveAsFlow()
	val store = FerryStateStore(runtime.repository, runtime.settings, viewModelScope, runtime.clock,
		onEffect = { effectChannel.trySend(it) },
		onWidgetDefaultsChanged = { if (!runtime.fixtures) { FerryWidgetProvider.refreshCached(app); FerryWidgetProvider.requestRefresh(app) } }, widgetDraft = widgetDraft)
	val state = store.state
	private var locationJob: Job? = null
	fun dispatch(action: FerryAction) = store.dispatch(action)
	fun setActive(active: Boolean) { if (!active) locationJob?.cancel(); store.setActive(active) }
	fun findNearest() {
		locationJob?.cancel()
		val token = store.locationRequestToken()
		locationJob = viewModelScope.launch {
			val roster = state.value.roster ?: withTimeoutOrNull(8_000) { state.first { it.roster != null }.roster }
			if (roster == null) { store.locationResult(token, null, "Connect to load landings before finding the nearest one."); return@launch }
			when (val result = AndroidLocation(app).request(background = false)) {
				is LocationResult.Fix -> {
					val landing = NearbyWidgetBoard.nearest(roster.landings, result.value.latitude, result.value.longitude)
					store.locationResult(token, landing?.id, if (landing != null) "Nearest landing: ${landing.displayName}" else "No nearby landing could be found.")
				}
				LocationResult.NotAuthorized -> store.locationResult(token, null, "Location is not allowed. Choose a landing manually or enable location in settings.")
				LocationResult.Unavailable -> store.locationResult(token, null, "Location is unavailable. Try again or choose a landing manually.")
			}
		}
	}
	override fun onCleared() { store.close(); effectChannel.close() }
	class Factory(private val context: Context, private val policy: TestLaunchPolicy, private val widgetDraft: Boolean = false) : ViewModelProvider.Factory {
		override fun <T : ViewModel> create(modelClass: Class<T>): T {
			require(modelClass.isAssignableFrom(FerryViewModel::class.java))
			@Suppress("UNCHECKED_CAST") return FerryViewModel(context, policy, widgetDraft) as T
		}
	}
}
