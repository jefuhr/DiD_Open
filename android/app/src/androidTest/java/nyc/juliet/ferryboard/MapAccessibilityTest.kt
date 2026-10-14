package nyc.juliet.ferryboard

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import nyc.juliet.ferryboard.contract.AppPreferences
import nyc.juliet.ferryboard.contract.FerryAction
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.Boats
import nyc.juliet.ferryboard.core.FerryJson
import nyc.juliet.ferryboard.core.Harbor
import nyc.juliet.ferryboard.ui.map.HarborMapScreen
import nyc.juliet.ferryboard.ui.map.rememberHarborCameraState
import nyc.juliet.ferryboard.ui.rememberFerryUi
import nyc.juliet.ferryboard.ui.theme.FerryTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList

/** Semantic activation must preserve the named object even when physical marker hit areas overlap. */
@RunWith(AndroidJUnit4::class)
class MapAccessibilityTest {
	@get:Rule val compose = createComposeRule()
	private val context get() = ApplicationProvider.getApplicationContext<Context>()
	private val actions = CopyOnWriteArrayList<FerryAction>()

	private fun showOverlappingMarkers() {
		val harbor = FerryJson.decode<Harbor>(context.assets.open("map.json").use { it.readBytes() })
		val feed = FerryJson.decode<Boats>(context.assets.open("boats.json").use { it.readBytes() })
		val landing = harbor.landings.first { it.id == 16 }
		val first = feed.boats.first().copy(id = "first", latitude = requireNotNull(landing.latitude), longitude = requireNotNull(landing.longitude))
		val second = first.copy(id = "second", name = "Second vessel")
		val state = FerryUiState(preferences = AppPreferences(showMarineReferences = false), harbor = harbor,
			boats = feed.copy(boats = listOf(first, second)), now = Instant.parse("2026-09-04T12:50:00Z"))
		compose.setContent {
			FerryTheme(themeId = "nyc-ferry", textSize = "system") {
				HarborMapScreen(state, rememberFerryUi { actions.add(it) }, rememberHarborCameraState(), PaddingValues(0.dp))
			}
		}
		compose.waitUntil(20_000) {
			runCatching { compose.onNodeWithTag("mapBoatMarker-first", useUnmergedTree = true).assertIsDisplayed() }.isSuccess
		}
	}

	private fun activate(tag: String) {
		compose.onNodeWithTag(tag, useUnmergedTree = true).performSemanticsAction(SemanticsActions.OnClick) { assertTrue(it()) }
		compose.waitForIdle()
	}
	private fun shot(name: String) {
		compose.waitForIdle()
		val instrumentation = InstrumentationRegistry.getInstrumentation()
		instrumentation.waitForIdleSync()
		// Capture the submitted window without asking Compose to force another chart redraw.
		android.os.SystemClock.sleep(350)
		val directory = screenshotDirectory()
		val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
		File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
		bitmap.recycle()
	}

	@Test fun landingSemanticActionOpensThatLandingBesideADockedVessel() {
		showOverlappingMarkers()
		shot("map-overlapping-markers")
		activate("mapLandingMarker-16")
		assertTrue("The landing action opened a boat: $actions", actions.none { it is FerryAction.OpenBoat })
		compose.onNodeWithTag("mapLandingCallout").assertExists()
		compose.onNodeWithTag("mapLandingDepartures").performClick()
		assertTrue(actions.contains(FerryAction.SelectLanding(16)))
	}

	@Test fun eachColocatedVesselSemanticActionKeepsItsOwnIdentity() {
		showOverlappingMarkers()
		activate("mapBoatMarker-first")
		activate("mapBoatMarker-second")
		assertEquals(listOf("first", "second"), actions.filterIsInstance<FerryAction.OpenBoat>().map { it.id })
	}
}
