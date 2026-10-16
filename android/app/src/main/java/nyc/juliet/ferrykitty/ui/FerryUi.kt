package nyc.juliet.ferrykitty.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import nyc.juliet.ferrykitty.contract.AppPreferences
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerrySheet
import nyc.juliet.ferrykitty.contract.FerryTab
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.Vessel

/**
 * The action sequences the iOS screens perform. The UI never stores data itself: every change is a [FerryAction].
 * The only local values are presentation: which vessel the picker suggests, and which sheet back returns to.
 */
@Stable
class FerryUi internal constructor(
	private val suggestion: MutableState<String?>,
	private val origin: MutableState<Pair<FerrySheet, FerrySheet>?>,
	private val dispatch: () -> (FerryAction) -> Unit,
) {
	/** The vessel picker's "Suggested" row, set just before the picker opens. */
	val vesselSuggestion: String? get() = suggestion.value

	fun send(action: FerryAction) = dispatch()(action)

	fun open(sheet: FerrySheet?) = send(FerryAction.OpenSheet(sheet))

	fun close() = open(null)

	/**
	 * Opens [child] from [parent] the way iOS pushes a page inside a sheet: the root sees the real sheet, so its loading
	 * and polling apply, while back returns to [parent].
	 */
	fun push(child: FerrySheet, parent: FerrySheet) {
		origin.value = child to parent
		open(child)
	}

	/** The sheet that back returns to from [sheet], if it was pushed. */
	fun parentOf(sheet: FerrySheet?): FerrySheet? = origin.value?.takeIf { it.first == sheet }?.second

	fun back(sheet: FerrySheet) {
		val parent = parentOf(sheet)
		origin.value = null
		open(parent)
	}

	internal fun forgetOrigin() {
		origin.value = null
	}

	fun selectTab(tab: FerryTab) = send(FerryAction.SelectTab(tab))

	fun update(preferences: AppPreferences) = send(FerryAction.SetPreferences(preferences))

	fun openVessels(suggestion: String? = null) {
		this.suggestion.value = suggestion
		open(FerrySheet.VESSELS)
	}

	/** The boat shortcut: return to an active ride, or choose one. */
	fun yourBoat(state: FerryUiState) {
		if (state.rideSession != null) send(FerryAction.ShowRide) else openVessels(null)
	}

	/** Choosing a landing from a sheet shows its board, as iOS does after the sheet closes. */
	fun selectLanding(id: Int, closeSheet: Boolean = true) {
		send(FerryAction.SelectLanding(id))
		if (closeSheet) close()
	}

	fun startRide(vessel: Vessel) {
		send(FerryAction.StartRide(vessel))
		close()
	}

	fun findBoat(name: String) {
		send(FerryAction.FindBoat(name))
		close()
	}
}

@Composable
fun rememberFerryUi(onAction: (FerryAction) -> Unit): FerryUi {
	val current by rememberUpdatedState(onAction)
	val suggestion = rememberSaveable { mutableStateOf<String?>(null) }
	val origin = rememberSaveable { mutableStateOf<Pair<FerrySheet, FerrySheet>?>(null) }
	return remember(suggestion, origin) { FerryUi(suggestion, origin) { current } }
}
