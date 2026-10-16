package nyc.juliet.ferrykitty

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import nyc.juliet.ferryboard.platform.FerryWidgetConfigurationActivity
import nyc.juliet.ferrykitty.core.WidgetOptions
import nyc.juliet.ferrykitty.platform.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real configuration activity with isolated fixture IDs; never binds or changes a production widget. */
@RunWith(AndroidJUnit4::class)
class FerryWidgetConfigurationTest {
	@get:Rule val compose = createEmptyComposeRule()
	private val context get() = ApplicationProvider.getApplicationContext<Context>()
	private lateinit var settings: WidgetSettingsStore
	private var scenario: ActivityScenario<FerryWidgetConfigurationActivity>? = null

	@Before fun prepare() {
		val runtime = AndroidRuntime.session(context, TestLaunchPolicy(fixtures = true, reset = true, offline = false))
		settings = WidgetSettingsStore(runtime.settings)
		val fixed = WidgetOptions(automaticLanding = false, landingId = 16, landingName = "Pier 11 / Wall St")
		settings.saveDefaults(fixed)
		settings.save(731, WidgetSettings(useAppDefaults = false, options = fixed))
		settings.save(732, WidgetSettings(useAppDefaults = false, options = fixed.copy(showCountdown = false)))
	}
	@After fun stop() { scenario?.close() }

	private fun launch() {
		scenario = ActivityScenario.launch(Intent(context, FerryWidgetConfigurationActivity::class.java)
			.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
			.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 731)
			.putExtra("FERRY_UI_TESTS", true))
		compose.waitUntil(20_000) { compose.onAllNodesWithTag("widgetBoatNames").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodes(hasScrollToIndexAction()).fetchSemanticsNodes().isNotEmpty() }
	}
	private fun boatNames(): SemanticsNodeInteraction {
		if (compose.onAllNodesWithTag("widgetBoatNames").fetchSemanticsNodes().isEmpty()) {
			val scrolls = compose.onAllNodes(hasScrollToIndexAction())
			for (i in scrolls.fetchSemanticsNodes().indices.reversed()) {
				runCatching { scrolls[i].performScrollToNode(hasTestTag("widgetBoatNames")) }
				if (compose.onAllNodesWithTag("widgetBoatNames").fetchSemanticsNodes().isNotEmpty()) break
			}
		}
		return compose.onNodeWithTag("widgetBoatNames").also { runCatching { it.performScrollTo() } }
	}

	@Test fun applyPersistsOnlyTheConfiguredInstanceAndRetainsTheFixedLanding() {
		launch()
		boatNames().assertIsOn().performClick()
		compose.onNodeWithText("Apply").performClick()
		InstrumentationRegistry.getInstrumentation().waitForIdleSync()
		assertFalse(settings.options(731).showBoatNames)
		assertEquals(16, settings.options(731).landingId)
		assertTrue(settings.options(732).showBoatNames)
		assertFalse(settings.options(732).showCountdown)
		assertTrue(settings.defaults().showBoatNames)
	}

	@Test fun rotationPreservesTheDraftAndCancelLeavesStoredChoicesUntouched() {
		launch()
		boatNames().performClick()
		scenario?.recreate()
		boatNames().assertIsOff()
		compose.onNodeWithText("Cancel").performClick()
		InstrumentationRegistry.getInstrumentation().waitForIdleSync()
		assertTrue(settings.options(731).showBoatNames)
		assertEquals(16, settings.options(731).landingId)
		assertTrue(settings.defaults().showBoatNames)
	}
}
