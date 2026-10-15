package nyc.juliet.ferryboard

import android.content.Context
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import nyc.juliet.ferryboard.contract.AppPreferences
import nyc.juliet.ferryboard.contract.FerryUiState
import nyc.juliet.ferryboard.core.Boats
import nyc.juliet.ferryboard.core.FerryJson
import nyc.juliet.ferryboard.core.Harbor
import nyc.juliet.ferryboard.ui.map.CameraPosition
import nyc.juliet.ferryboard.ui.map.HarborCameraState
import nyc.juliet.ferryboard.ui.map.HarborMapScreen
import nyc.juliet.ferryboard.ui.map.rememberHarborCameraState
import nyc.juliet.ferryboard.ui.rememberFerryUi
import nyc.juliet.ferryboard.ui.theme.FerryTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

/** A retained map must preserve user gestures while a new explicit Find Boat request must refocus. */
@RunWith(AndroidJUnit4::class)
class MapCameraLifecycleTest {
	@get:Rule val compose = createComposeRule()
	private val state = mutableStateOf(FerryUiState())
	private val visible = mutableStateOf(true)
	private val layout = mutableStateOf(0)
	private lateinit var camera: HarborCameraState
	private lateinit var restoration: StateRestorationTester

	private fun start() {
		val context = ApplicationProvider.getApplicationContext<Context>()
		val harbor = FerryJson.decode<Harbor>(context.assets.open("map.json").use { it.readBytes() })
		val boats = FerryJson.decode<Boats>(context.assets.open("boats.json").use { it.readBytes() })
		val boat = boats.boats.first()
		state.value = FerryUiState(preferences = AppPreferences(showMarineReferences = false), harbor = harbor, boats = boats,
			selectedBoatId = boat.id, selectedBoat = boat, wantedVesselName = boat.name, boatFocusRequest = "first-request",
			now = Instant.parse("2026-09-04T12:50:00Z"))
		restoration = StateRestorationTester(compose)
		restoration.setContent {
			camera = rememberHarborCameraState()
			FerryTheme(themeId = "nyc-ferry", textSize = "system") {
				if (visible.value) key(layout.value) {
					HarborMapScreen(state.value, rememberFerryUi {}, camera, PaddingValues(0.dp))
				}
			}
		}
		compose.waitForIdle()
		compose.waitUntil(20_000) { camera.consumedFocusRequest == "first-request" }
		compose.mainClock.advanceTimeBy(600)
		compose.waitForIdle()
	}
	private fun position(): CameraPosition = compose.runOnIdle { checkNotNull(camera.position) }
	private fun pan(): CameraPosition {
		compose.runOnIdle { camera.stop(); camera.transform(Offset.Zero, Offset(-180f, 120f), 1f) }
		return position()
	}

	@Test fun returningToTheTabAndReplacingLayoutPreserveThePannedCamera() {
		start()
		val focused = position()
		val panned = pan()
		assertNotEquals(focused, panned)
		compose.runOnIdle { visible.value = false }
		compose.waitForIdle()
		compose.runOnIdle { visible.value = true }
		compose.waitForIdle()
		assertEquals(panned, position())
		compose.runOnIdle { layout.value++ }
		compose.waitForIdle()
		assertEquals(panned, position())
	}

	@Test fun repeatingFindBoatForTheSameVesselRecentersAgain() {
		start()
		val focused = position()
		assertNotEquals(focused, pan())
		compose.runOnIdle { state.value = state.value.copy(boatFocusRequest = "second-request") }
		compose.waitForIdle()
		compose.mainClock.advanceTimeBy(600)
		compose.waitForIdle()
		assertEquals("second-request", camera.consumedFocusRequest)
		assertEquals(focused, position())
	}

	@Test fun restorationKeepsTheCameraAndTheConsumedRequest() {
		start()
		val panned = pan()
		restoration.emulateSavedInstanceStateRestore()
		compose.waitForIdle()
		assertEquals("first-request", camera.consumedFocusRequest)
		assertEquals(panned, position())
	}
}
