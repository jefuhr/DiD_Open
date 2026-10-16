package nyc.juliet.ferrykitty.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.outlined.DirectionsBoat
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerryTab
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.ui.board.BoardScreen
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.map.HarborCameraState
import nyc.juliet.ferrykitty.ui.map.HarborMapScreen
import nyc.juliet.ferrykitty.ui.map.rememberHarborCameraState
import nyc.juliet.ferrykitty.ui.ride.RideScreen
import nyc.juliet.ferrykitty.ui.ride.RideFormat
import nyc.juliet.ferrykitty.ui.sheets.LandingSidebar
import nyc.juliet.ferrykitty.ui.sheets.SheetHost
import nyc.juliet.ferrykitty.ui.theme.FerryText
import nyc.juliet.ferrykitty.ui.theme.FerryTheme
import nyc.juliet.ferrykitty.ui.theme.KeepScreenOn
import nyc.juliet.ferrykitty.ui.theme.ferryColors

/** How the window is navigated: bottom bar on phones, a rail in between, and the landing sidebar on tablets. */
enum class AppLayout {
	PHONE, RAIL, WORKSPACE;

	companion object {
		fun of(widthDp: Float, heightDp: Float): AppLayout = when {
			widthDp >= 840f && heightDp >= 480f -> WORKSPACE
			widthDp >= 600f || (heightDp < 480f && widthDp > heightDp) -> RAIL
			else -> PHONE
		}
	}
}

/**
 * The Ferry Kitty app. Reads [state] and reports every intent through [onAction]; networking, storage, permissions and
 * lifecycle stay with the Android state owner.
 */
@Composable
fun FerryApp(state: FerryUiState, onAction: (FerryAction) -> Unit) {
	FerryTheme(themeId = state.preferences.theme, textSize = state.preferences.textSize) {
		KeepScreenOn(state.preferences.keepScreenAwake)
		val ui = rememberFerryUi(onAction)
		val camera = rememberHarborCameraState()
		Surface(color = ferryColors.background, contentColor = ferryColors.ink, modifier = Modifier.fillMaxSize()) {
			// Registered first so screens and the ride dashboard handle back before it: the map returns to departures.
			BackHandler(enabled = state.tab == FerryTab.MAP && !state.showingRide) { ui.selectTab(FerryTab.DEPARTURES) }
			BoxWithConstraints(Modifier.fillMaxSize()) {
				when (AppLayout.of(maxWidth.value, maxHeight.value)) {
					AppLayout.PHONE -> PhoneShell(state, ui, camera)
					AppLayout.RAIL -> RailShell(state, ui, camera)
					AppLayout.WORKSPACE -> WorkspaceShell(state, ui, camera)
				}
				AnimatedVisibility(
					visible = state.showingRide,
					enter = slideInVertically(tween(260)) { it / 3 } + fadeIn(tween(200)),
					exit = slideOutVertically(tween(220)) { it / 3 } + fadeOut(tween(180)),
				) {
					RideScreen(state, ui, wide = maxWidth >= 700.dp)
				}
			}
		}
		SheetHost(state, ui)
	}
}

@Composable
private fun TabContent(state: FerryUiState, ui: FerryUi, camera: HarborCameraState, showLandingButton: Boolean, contentPadding: PaddingValues, modifier: Modifier = Modifier) {
	Crossfade(targetState = state.tab, animationSpec = tween(140), label = "tab", modifier = modifier) { tab ->
		when (tab) {
			FerryTab.DEPARTURES -> BoardScreen(state, ui, showLandingButton, contentPadding)
			FerryTab.MAP -> HarborMapScreen(state, ui, camera, contentPadding)
		}
	}
}

private data class Destination(val tab: FerryTab, val label: String, val selected: ImageVector, val unselected: ImageVector, val tag: String)

private val destinations = listOf(
	Destination(FerryTab.DEPARTURES, "Departures", Icons.Filled.DirectionsBoat, Icons.Outlined.DirectionsBoat, "navigation-departures"),
	Destination(FerryTab.MAP, "Map", Icons.Filled.Map, Icons.Outlined.Map, "navigation-map"),
)

@Composable
private fun PhoneShell(state: FerryUiState, ui: FerryUi, camera: HarborCameraState) {
	Scaffold(
		containerColor = ferryColors.background,
		contentWindowInsets = WindowInsets(0),
		bottomBar = {
			Column {
				RideBar(state, ui)
				NavigationBar(containerColor = ferryColors.card, contentColor = ferryColors.ink) {
					for (destination in destinations) {
						val selected = state.tab == destination.tab
						NavigationBarItem(
							selected = selected,
							onClick = { if (!selected) ui.selectTab(destination.tab) },
							icon = { Icon(if (selected) destination.selected else destination.unselected, contentDescription = null) },
							label = { Text(destination.label) },
							modifier = Modifier.testTag(destination.tag),
						)
					}
				}
			}
		},
	) { padding ->
		TabContent(state, ui, camera, showLandingButton = true, contentPadding = PaddingValues(0.dp), modifier = Modifier.padding(padding))
	}
}

@Composable
private fun RailShell(state: FerryUiState, ui: FerryUi, camera: HarborCameraState) {
	Row(Modifier.fillMaxSize()) {
		NavigationRail(
			containerColor = ferryColors.card,
			contentColor = ferryColors.ink,
			windowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start),
		) {
			Spacer(Modifier.weight(1f))
			for (destination in destinations) {
				val selected = state.tab == destination.tab
				NavigationRailItem(
					selected = selected,
					onClick = { if (!selected) ui.selectTab(destination.tab) },
					icon = { Icon(if (selected) destination.selected else destination.unselected, contentDescription = null) },
					label = { Text(destination.label) },
					modifier = Modifier.testTag(destination.tag),
				)
			}
			Spacer(Modifier.weight(1f))
		}
		ShellContent(state, ui, camera, showLandingButton = true, modifier = Modifier.weight(1f))
	}
}

@Composable
private fun WorkspaceShell(state: FerryUiState, ui: FerryUi, camera: HarborCameraState) {
	Row(Modifier.fillMaxSize().testTag("tabletWorkspace")) {
		LandingSidebar(
			state = state,
			ui = ui,
			windowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start),
			modifier = Modifier.width(300.dp).fillMaxHeight().testTag("landingSidebar"),
		)
		VerticalDivider(thickness = 0.5.dp, color = ferryColors.line)
		ShellContent(state, ui, camera, showLandingButton = false, modifier = Modifier.weight(1f))
	}
}

/** Content beside a rail or sidebar: it runs under the gesture bar, so the screens pad their own bottom edge. */
@Composable
private fun ShellContent(state: FerryUiState, ui: FerryUi, camera: HarborCameraState, showLandingButton: Boolean, modifier: Modifier = Modifier) {
	val riding = state.rideSession != null && !state.showingRide
	Column(modifier.fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.End))) {
		TabContent(
			state, ui, camera, showLandingButton,
			contentPadding = if (riding) PaddingValues(0.dp) else WindowInsets.navigationBars.only(WindowInsetsSides.Bottom).asPaddingValues(),
			modifier = Modifier.weight(1f),
		)
		RideBar(state, ui, Modifier.navigationBarsPadding())
	}
}

/** A minimized ride stays one tap away, with its next landing when known. */
@Composable
private fun RideBar(state: FerryUiState, ui: FerryUi, modifier: Modifier = Modifier) {
	val session = state.rideSession ?: return
	if (state.showingRide) return
	val ride = state.ride
	val stop = ride?.nextStop
	val detail = if (ride != null && stop != null) {
		"${stop.name} · ARR ${RideFormat.time(stop.instant(arrival = true, stale = ride.stale), ride.timezone, state.preferences.twelveHour)}"
	} else "Your boat · tap to return"
	Surface(color = ferryColors.card, shadowElevation = 3.dp, modifier = modifier.fillMaxWidth()) {
		Row(
			verticalAlignment = Alignment.CenterVertically,
			horizontalArrangement = Arrangement.spacedBy(10.dp),
			modifier = Modifier
				.testTag("rideBar")
				.clickable(role = Role.Button, onClickLabel = "Return to your boat's confirmed trips") { ui.send(FerryAction.ShowRide) }
				.heightIn(min = 56.dp)
				.padding(horizontal = 16.dp, vertical = 6.dp),
		) {
			Icon(Icons.Filled.DirectionsBoat, contentDescription = null, tint = ferryColors.accent, modifier = Modifier.size(22.dp))
			Column(Modifier.weight(1f)) {
				Text(session.vessel.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = ferryColors.heading,
					maxLines = 1, overflow = TextOverflow.Ellipsis)
				Text(detail, style = FerryText.caption, color = ferryColors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
			}
			when {
				ride == null -> Text("Loading", style = FerryText.caption, color = ferryColors.muted)
				ride.stale || ride.positionStale -> Text("SAVED", style = FerryText.pill, color = ferryColors.muted)
			}
			Box(Modifier.size(TouchTarget / 2), contentAlignment = Alignment.Center) {
				Icon(Icons.Filled.KeyboardArrowUp, contentDescription = null, tint = ferryColors.muted)
			}
		}
	}
}
