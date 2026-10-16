package nyc.juliet.ferrykitty

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import nyc.juliet.ferrykitty.contract.FerryAction
import nyc.juliet.ferrykitty.contract.FerryUiState
import nyc.juliet.ferrykitty.core.Vessel
import nyc.juliet.ferrykitty.platform.AndroidRuntime
import nyc.juliet.ferrykitty.platform.FerryStateStore
import nyc.juliet.ferrykitty.platform.TestLaunchPolicy
import nyc.juliet.ferrykitty.ui.FerryUi
import nyc.juliet.ferrykitty.ui.rememberFerryUi
import nyc.juliet.ferrykitty.ui.ride.RideScreen
import nyc.juliet.ferrykitty.ui.sheets.TripContent
import nyc.juliet.ferrykitty.ui.theme.FerryTheme
import nyc.juliet.ferrykitty.ui.theme.ferryColors
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Trip stops and ride clocks in 12-hour time with live estimates, at narrow widths and the text sizes just below and at
 * the accessibility threshold: whole words in stop names, whole clocks and reachable trip actions. The real state owner
 * loads the fixture schedule, trip and ride, so the screens show exactly what the app shows; no device setting changes.
 */
@RunWith(AndroidJUnit4::class)
class TripWrappingTest {
	@get:Rule val compose = createComposeRule()
	private val context get() = ApplicationProvider.getApplicationContext<Context>()
	private val width = mutableStateOf(360.dp)
	private val fontScale = mutableStateOf(1.2f)
	private lateinit var scope: CoroutineScope
	private lateinit var store: FerryStateStore
	private val problems = mutableListOf<String>()

	/** Narrow phones (320 and 360 dp) at large non-accessibility text, the threshold's edge and accessibility text. */
	private val cases = listOf(320.dp to 1.2f, 360.dp to 1.2f, 320.dp to 1.49f, 360.dp to 1.49f, 320.dp to 1.8f, 360.dp to 1.8f)

	private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
	private fun await(condition: (FerryUiState) -> Boolean) = compose.waitUntil(20_000) { condition(store.state.value) }

	@Before fun load() {
		val session = AndroidRuntime.session(context, TestLaunchPolicy(fixtures = true, reset = true, offline = false))
		scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
		main {
			store = FerryStateStore(session.repository, session.settings, scope, session.clock)
			store.setActive(true)
			store.dispatch(FerryAction.SelectLanding(16))
		}
		await { state -> state.boardRows.any { it.departure.tripId == "nine" } }
		main { store.dispatch(FerryAction.SetPreferences(store.state.value.preferences.copy(twelveHour = true))) }
		await { it.preferences.twelveHour }
	}

	@After fun stop() {
		main { store.close() }
		scope.cancel()
	}

	private fun show(content: @Composable (FerryUiState, FerryUi) -> Unit) {
		compose.setContent {
			val state by store.state.collectAsState()
			val base = LocalDensity.current
			CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale.value)) {
				FerryTheme(themeId = state.preferences.theme, textSize = "system") {
					Surface(color = ferryColors.card) {
						Box(Modifier.width(width.value).fillMaxHeight().testTag("narrowFrame")) { content(state, rememberFerryUi { store.dispatch(it) }) }
					}
				}
			}
		}
	}

	private fun use(case: Pair<Dp, Float>) {
		compose.runOnIdle {
			width.value = case.first
			fontScale.value = case.second
		}
		compose.waitForIdle()
	}

	private fun frame(): Rect = compose.onNodeWithTag("narrowFrame").fetchSemanticsNode().boundsInRoot

	private fun layout(node: SemanticsNode): TextLayoutResult {
		val layouts = mutableListOf<TextLayoutResult>()
		node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
		return layouts.single()
	}

	/** The placed nodes whose whole text is [text], optionally inside [within]; lazily composed, unplaced items are skipped. */
	private fun nodes(text: String, within: String? = null): List<SemanticsNode> {
		val matcher = if (within != null) hasText(text) and hasAnyAncestor(hasTestTag(within)) else hasText(text)
		return compose.onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().filter { it.layoutInfo.isPlaced }
	}

	/** A name may wrap between words, never inside one, and must stay inside the frame. */
	private fun checkWholeWords(case: String, text: String, within: String? = null) {
		val found = nodes(text, within)
		if (found.isEmpty()) problems += "$case: $text is not shown"
		for (node in found) {
			val layout = layout(node)
			for (line in 0 until layout.lineCount - 1) {
				val end = layout.getLineEnd(line, visibleEnd = false)
				if (end in 1 until text.length && !text[end - 1].isWhitespace() && !text[end].isWhitespace()) {
					problems += "$case: \"$text\" breaks inside a word after \"${text.substring(0, end)}\" (${layout.lineCount} lines in ${node.size.width} px)"
				}
			}
			checkInside(case, text, node)
		}
	}

	/** A clock or estimate marker renders whole on one line, inside its node and the frame. */
	private fun checkWholeLine(case: String, text: String, within: String? = null) {
		val found = nodes(text, within)
		if (found.isEmpty()) problems += "$case: $text is not shown"
		for (node in found) {
			val layout = layout(node)
			val line = layout.getLineRight(0) - layout.getLineLeft(0)
			when {
				layout.lineCount != 1 -> problems += "$case: \"$text\" wraps onto ${layout.lineCount} lines in ${node.size.width} px"
				layout.isLineEllipsized(0) -> problems += "$case: \"$text\" is ellipsized"
				line > node.size.width + 1f || layout.getLineBottom(0) > node.size.height + 1f ->
					problems += "$case: \"$text\" is clipped: a $line px line in ${node.size}"
			}
			checkInside(case, text, node)
		}
	}

	/** Horizontal containment, from unclipped bounds: a stop scrolled out of view still counts, with its real width. */
	private fun checkInside(case: String, label: String, node: SemanticsNode) {
		val frame = frame()
		val bounds = Rect(node.positionInRoot, node.size.toSize())
		if (bounds.width <= 0f || bounds.left < frame.left - 1f || bounds.right > frame.right + 1f) problems += "$case: $label at $bounds leaves the frame $frame"
	}

	private fun shot(name: String) {
		compose.waitForIdle()
		InstrumentationRegistry.getInstrumentation().waitForIdleSync()
		val bitmap = settledScreenshot()
		File(screenshotDirectory(), "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
		bitmap.recycle()
	}

	private fun name(case: Pair<Dp, Float>) = "${case.first.value.toInt()}dp-${case.second}"

	@Test fun tripStopNamesClocksAndActionsStayWholeAtNarrowWidths() {
		val row = store.state.value.boardRows.first { it.departure.tripId == "nine" }
		main { store.dispatch(FerryAction.OpenTrip(row)) }
		await { state -> state.trip.let { it != null && !it.loading && it.connections != null } }
		show { state, ui -> TripContent(state, ui, Modifier.fillMaxSize()) }
		for (case in cases) {
			use(case)
			val label = "trip ${name(case)}"
			shot("trip-wrap-${name(case)}")
			for (stop in listOf("Pier 11", "DUMBO")) checkWholeWords(label, stop, within = "tripStops")
			for (clock in listOf("9:00 AM", "9:01 AM", "9:12 AM", "9:11 AM", "EST", "sched 9:10 AM")) checkWholeLine(label, clock, within = "tripStops")
			for (action in listOf("tripMap", "tripRide")) {
				val node = compose.onNodeWithTag(action).assertIsDisplayed().fetchSemanticsNode()
				checkInside(label, action, node)
			}
		}
		// Where both fit, the times stay beside the name, as before.
		use(411.dp to 1f)
		val name = nodes("DUMBO", within = "tripStops").single().boundsInRoot
		val clock = nodes("9:12 AM", within = "tripStops").single().boundsInRoot
		if (clock.top >= name.bottom || clock.left <= name.right) problems += "trip 411dp-1.0: DUMBO's times moved off its line ($name, $clock)"
		shot("trip-wrap-411dp-1.0")
		assertTrue(problems.joinToString("\n"), problems.isEmpty())
	}

	@Test fun rideClocksStayWholeAtNarrowWidths() {
		main { store.dispatch(FerryAction.StartRide(Vessel("opportunity", "Opportunity"))) }
		await { state -> state.ride.let { it != null && it.nextStop != null && !it.stale } }
		show { state, ui -> RideScreen(state, ui, wide = false) }
		for (case in cases) {
			use(case)
			val label = "ride ${name(case)}"
			shot("ride-wrap-${name(case)}")
			compose.onNodeWithTag("rideNextStop").assertIsDisplayed()
			for (clock in listOf("9:12 AM", "9:13 AM", "estimated")) checkWholeLine(label, clock, within = "rideNextStop")
			checkWholeWords(label, "DUMBO", within = "rideNextStop")
			// The same renderer also lays out history clocks. Check their real widths even when below the viewport.
			for (clock in listOf("9:12 AM", "9:13 AM")) checkWholeLine(label, clock)
		}
		assertTrue(problems.joinToString("\n"), problems.isEmpty())
	}
}
