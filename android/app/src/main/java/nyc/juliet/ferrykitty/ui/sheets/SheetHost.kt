@file:OptIn(ExperimentalMaterial3Api::class)

package nyc.juliet.ferrykitty.ui.sheets

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import nyc.juliet.ferrykitty.contract.FerrySheet
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.ui.FerryUi
import nyc.juliet.ferrykitty.ui.WidgetPage
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.theme.ferryColors

/**
 * Shows [FerryUiState.sheet] as a full-height modal bottom sheet. Changing from one sheet to another swaps the content
 * in place; closing animates the sheet away before it leaves composition.
 */
@Composable
fun SheetHost(state: FerryUiState, ui: FerryUi) {
	val target = state.sheet
	var shown by remember { mutableStateOf<FerrySheet?>(null) }
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	LaunchedEffect(target) {
		if (target != null) {
			shown = target
		} else {
			ui.forgetOrigin()
			if (shown != null) {
				runCatching { sheetState.hide() }
				shown = null
			}
		}
	}
	// Settings keeps its place while one of its tools is open in the same sheet, and starts at the top when reopened.
	val settingsList = rememberSaveable(shown == null && target == null, saver = LazyListState.Saver) { LazyListState() }
	val sheet = shown ?: return
	ModalBottomSheet(
		onDismissRequest = { ui.close() },
		sheetState = sheetState,
		containerColor = ferryColors.card,
		contentColor = ferryColors.ink,
		contentWindowInsets = { WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal) },
	) {
		key(sheet) {
			val back: (() -> Unit)? = if (ui.parentOf(sheet) != null) ({ ui.back(sheet) }) else null
			when (sheet) {
				FerrySheet.LANDINGS -> SheetFrame(if (back != null) "Landings & favorites" else "Landings", ui, onBack = back) {
					LandingsContent(state, ui, inSheet = true, modifier = Modifier.weight(1f))
				}
				FerrySheet.FILTERS -> SheetFrame("Operators & routes", ui, onBack = back) { FiltersContent(state, ui, Modifier.weight(1f)) }
				FerrySheet.SETTINGS -> SettingsSheet(state, ui, settingsList)
				FerrySheet.ALERTS -> SheetFrame("Service alerts", ui, onBack = back) { AlertsContent(state, ui, Modifier.weight(1f)) }
				FerrySheet.CHANGELOG -> SheetFrame("What’s new", ui, onBack = back) { ChangelogContent(state, Modifier.weight(1f)) }
				FerrySheet.VESSELS -> SheetFrame(if (state.rideSession == null) "Choose boat" else "Switch boats", ui, onBack = back) {
					VesselPickerContent(state, ui, Modifier.weight(1f))
				}
				FerrySheet.WIDGET -> SheetFrame("Nearby ferry widget", ui, onBack = back) { WidgetPage(state, ui, Modifier.weight(1f)) }
				FerrySheet.TRIP -> SheetFrame("Trip details", ui) { TripContent(state, ui, Modifier.weight(1f)) }
				FerrySheet.BOAT -> SheetFrame(state.selectedBoat?.name ?: "Vessel", ui, fill = false) { BoatContent(state, ui) }
				FerrySheet.BRIDGE -> SheetFrame(state.selectedBridge?.name ?: "Bridge", ui, fill = false) { BridgeContent(state) }
				FerrySheet.SEAMARK -> SheetFrame(state.selectedSeamark?.name ?: "Marine reference", ui, fill = false) { SeamarkContent(state) }
			}
		}
	}
}

/**
 * A sheet page: title, optional back arrow for sub-pages, and Done, which always closes the whole sheet. System back
 * returns from a sub-page before it closes the sheet.
 */
@Composable
internal fun SheetFrame(
	title: String,
	ui: FerryUi,
	onBack: (() -> Unit)? = null,
	fill: Boolean = true,
	content: @Composable ColumnScope.() -> Unit,
) {
	if (onBack != null) BackHandler(onBack = onBack)
	Column(if (fill) Modifier.fillMaxHeight() else Modifier) {
		Row(
			verticalAlignment = Alignment.CenterVertically,
			modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 4.dp, end = 8.dp),
		) {
			if (onBack != null) {
				IconButton(onClick = onBack, modifier = Modifier.testTag("sheetBack")) {
					Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
				}
			} else {
				Spacer(Modifier.width(12.dp))
			}
			Text(
				title,
				style = MaterialTheme.typography.titleLarge,
				fontWeight = FontWeight.SemiBold,
				color = ferryColors.heading,
				maxLines = 2,
				overflow = TextOverflow.Ellipsis,
				modifier = Modifier.weight(1f).semantics { heading() },
			)
			TextButton(onClick = { ui.close() }, modifier = Modifier.heightIn(min = TouchTarget).testTag("dismissSheet")) {
				Text("Done", fontWeight = FontWeight.SemiBold)
			}
		}
		HorizontalDivider(thickness = 0.5.dp, color = ferryColors.line)
		content()
	}
}

/** A saveable back stack of sub-page names for sheets that push pages, like iOS navigation inside a sheet. */
@Composable
internal fun rememberPageStack(root: String): SnapshotStateList<String> = rememberSaveable(
	saver = listSaver(save = { it.toList() }, restore = { mutableStateListOf<String>().apply { addAll(it) } }),
) { mutableStateListOf(root) }
