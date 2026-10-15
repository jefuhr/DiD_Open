package nyc.juliet.ferryboard

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.KeyEvent
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import nyc.juliet.ferryboard.contract.AppPreferences
import nyc.juliet.ferryboard.platform.AndroidRuntime
import nyc.juliet.ferryboard.platform.PreferenceCodec
import nyc.juliet.ferryboard.platform.TestLaunchPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream

/** Real activity journeys with debug-only transport and storage, never the live server. */
@RunWith(AndroidJUnit4::class)
class FerryJourneysTest {
	@get:Rule val compose = createEmptyComposeRule()
	private var scenario: ActivityScenario<MainActivity>? = null
	private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()

	@Before fun start() { launch() }
	@After fun stop() { scenario?.close() }

	private fun launch(reset: Boolean = true, offline: Boolean = false, link: String? = null) {
		scenario?.close()
		val intent = Intent(context, MainActivity::class.java)
			.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
			.putExtra("FERRY_UI_TESTS", true)
			.putExtra("FERRY_RESET", reset)
			.putExtra("FERRY_OFFLINE", offline)
		if (link != null) { intent.action = Intent.ACTION_VIEW; intent.data = Uri.parse(link) }
		scenario = ActivityScenario.launch(intent)
	}

	private fun exists(tag: String): Boolean = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
	private fun waitTag(tag: String) {
		compose.waitUntil(20_000) { exists(tag) }
	}
	private fun reveal(tag: String) {
		if (!exists(tag)) {
			val scrolls = compose.onAllNodes(hasScrollToIndexAction())
			for (i in scrolls.fetchSemanticsNodes().indices.reversed()) {
				runCatching { scrolls[i].performScrollToNode(hasTestTag(tag)) }
				if (exists(tag)) break
			}
		}
		waitTag(tag)
		runCatching { compose.onNodeWithTag(tag).performScrollTo() }
	}
	private fun tap(tag: String) { reveal(tag); compose.onNodeWithTag(tag).performClick() }
	private fun dismiss() { tap("dismissSheet") }
	private fun shot(name: String) {
		compose.waitForIdle()
		// Compose idleness precedes the system compositor's submission of a new dialog/window frame.
		InstrumentationRegistry.getInstrumentation().waitForIdleSync()
		android.os.SystemClock.sleep(350)
		val directory = screenshotDirectory()
		val bitmap = settledScreenshot()
		File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
		bitmap.recycle()
	}
	private fun shell(command: String) {
		InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command).use { descriptor ->
			FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
		}
	}

	@Test fun landingFavoritesAndPreferencesSurviveRelaunch() {
		waitTag("departure-nine")
		tap("chooseLanding")
		tap("favorite-26")
		tap("landing-26")
		compose.onNodeWithTag("landingTitle").assertTextContains("79", substring = true)
		tap("settings")
		tap("clockFormat")
		tap("settingsTheme")
		tap("theme-hello-kitty")
		shot("preferences-hello-kitty")
		launch(reset = false)
		waitTag("landingTitle")
		compose.onNodeWithTag("landingTitle").assertTextContains("79", substring = true)
		tap("settings")
		reveal("clockFormat")
		compose.onNodeWithTag("clockFormat").assertIsOn()
	}

	@Test fun operatorsDatesAndAlertsRemainConnected() {
		waitTag("departure-nine")
		shot("departures-phone")
		tap("operatorFilter")
		tap("operator-NYC Ferry")
		dismiss()
		compose.onNodeWithText("No matching departures").assertExists()
		compose.onNodeWithText("Show all departures").performClick()
		waitTag("departure-nine")
		tap("nextDay")
		compose.onNodeWithTag("scheduleDate").assertTextContains("Sep 5", substring = true)
			.assertContentDescriptionContains("Saturday, September 5, 2026", substring = true)
		tap("scheduleDate")
		waitTag("departure-nine")
		tap("serviceAlerts")
		compose.onNodeWithText("Service update").assertExists()
		shot("service-alerts")
	}

	@Test fun routesAndOperationalMovementsFilterIndependently() {
		waitTag("departure-nine")
		tap("operatorFilter")
		tap("expandOperator-NYC Ferry")
		tap("movementFilter-crewShuttle")
		dismiss()
		compose.onNodeWithTag("departure-crew").assertDoesNotExist()
		compose.onNodeWithTag("departure-home").assertExists()
		tap("operatorFilter")
		if (!exists("movementFilter-pierC")) tap("expandOperator-NYC Ferry")
		tap("movementFilter-pierC")
		dismiss()
		compose.onNodeWithTag("departure-home").assertDoesNotExist()
		compose.onNodeWithTag("departure-nine").assertExists()
		tap("operatorFilter")
		if (!exists("routeFilter-ER")) tap("expandOperator-NYC Ferry")
		tap("routeFilter-ER")
		dismiss()
		compose.onNodeWithText("No matching departures").assertExists()
		compose.onNodeWithText("Show all departures").performClick()
		waitTag("departure-nine")
	}

	@Test fun hullSearchSelectsTheCorrectBoatAndCanSwitchRide() {
		waitTag("departure-nine")
		tap("navigation-map")
		waitTag("mapBoat-opportunity")
		tap("mapZoomIn")
		tap("mapZoomOut")
		compose.onNodeWithTag("harborMap").performTouchInput { swipeLeft() }
		tap("mapFitHarbor")
		shot("harbor-map")
		compose.onNodeWithTag("vesselSearch").performTextInput("H204")
		compose.onNodeWithTag("mapBoat-opportunity").assertExists()
		compose.onNodeWithTag("mapBoat-bay-hopper").assertDoesNotExist()
		compose.onNodeWithTag("vesselSearch").performTextReplacement("H-204")
		tap("mapBoat-opportunity")
		tap("rideThisBoat")
		waitTag("rideVesselName")
		compose.onNodeWithTag("rideVesselName").assertTextEquals("Opportunity")
		shot("ride-opportunity")
		tap("switchBoat")
		tap("vessel-bay-hopper")
		compose.onNodeWithTag("rideVesselName").assertTextEquals("Bay Hopper")
		tap("exitRide")
		compose.onNodeWithTag("rideBar").assertDoesNotExist()
	}

	@Test fun tripRideAndCachedOfflineRestoration() {
		waitTag("departure-nine")
		tap("departure-nine")
		waitTag("tripRide")
		compose.onNodeWithTag("tripRide").assertIsDisplayed()
		shot("trip-stops")
		dismiss()
		tap("navigation-map")
		tap("mapBoat-opportunity")
		tap("rideThisBoat")
		waitTag("rideArrival")
		compose.onNodeWithTag("rideArrival").assertTextContains("estimated", substring = true, ignoreCase = true)
		tap("minimizeRide")
		waitTag("rideBar")
		launch(reset = false, offline = true)
		waitTag("rideVesselName")
		compose.onNodeWithTag("rideVesselName").assertTextEquals("Opportunity")
		compose.onNodeWithTag("rideArrival").assertTextContains("scheduled", substring = true, ignoreCase = true)
		shot("offline-ride")
		tap("exitRide")
		tap("navigation-departures")
		waitTag("departure-nine")
		compose.onNodeWithTag("rideBar").assertDoesNotExist()
	}

	@Test fun firstLaunchOfflineShowsRecoveryInsteadOfSampleDepartures() {
		launch(reset = true, offline = true)
		compose.waitUntil(20_000) { compose.onAllNodesWithText("Schedule unavailable").fetchSemanticsNodes().isNotEmpty() }
		compose.onNodeWithTag("departure-nine").assertDoesNotExist()
		compose.onNodeWithText("Try again").assertExists()
		shot("offline-first-launch")
	}

	@Test fun deepLinksChooseCurrentLandingAndWidgetSetup() {
		launch(link = "ferryboard://landing/26")
		waitTag("landingTitle")
		compose.waitUntil(20_000) { compose.onAllNodes(hasTestTag("landingTitle") and hasText("79", substring = true)).fetchSemanticsNodes().isNotEmpty() }
		launch(reset = false, link = "ferryboard://landing/16")
		waitTag("departure-nine")
		launch(reset = false, link = "ferryboard://nearby")
		waitTag("widgetEnableLocation")
		shot("widget-setup")
	}

	@Test fun systemBackUnwindsSubpagesAndMinimizesWithoutEndingTheRide() {
		waitTag("departure-nine")
		tap("settings")
		tap("settingsTheme")
		scenario?.recreate()
		waitTag("theme-night")
		InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
		waitTag("settingsTheme")
		shot("back-from-theme-after-recreation")
		tap("settingsWidget")
		waitTag("widgetEnableLocation")
		scenario?.recreate()
		waitTag("widgetEnableLocation")
		InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
		waitTag("settingsWidget")
		shot("back-from-widget-after-recreation")
		InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
		compose.waitUntil(20_000) { !exists("dismissSheet") }
		tap("navigation-map")
		tap("mapBoat-opportunity")
		tap("rideThisBoat")
		waitTag("rideVesselName")
		InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
		waitTag("rideBar")
		compose.waitUntil(20_000) { !exists("rideVesselName") }
		tap("rideBar")
		waitTag("rideVesselName")
		compose.onNodeWithTag("rideVesselName").assertTextEquals("Opportunity")
		tap("exitRide")
		compose.onNodeWithTag("rideBar").assertDoesNotExist()
	}

	@Test fun coldMapLaunchCanOpenFreshAlertsFromSettingsAndReturn() {
		scenario?.close(); scenario = null
		val runtime = AndroidRuntime.session(context, TestLaunchPolicy(fixtures = true, reset = true, offline = false))
		runtime.settings.write("preferences", PreferenceCodec.encode(AppPreferences(launchTab = "map")))
		launch(reset = false)
		waitTag("mapSettings")
		tap("mapSettings")
		tap("settingsAlerts")
		compose.waitUntil(20_000) { compose.onAllNodesWithText("Service update").fetchSemanticsNodes().isNotEmpty() }
		shot("map-settings-alerts")
		tap("sheetBack")
		reveal("settingsAlerts")
		compose.onNodeWithTag("settingsAlerts").assertIsDisplayed()
		dismiss()
		waitTag("harborMap")
	}

	@Test fun widgetDefaultsCopyAndPersistIndependently() {
		waitTag("departure-nine")
		tap("chooseLanding")
		tap("landing-26")
		tap("operatorFilter")
		tap("operator-NY Waterway")
		dismiss()
		tap("settings")
		tap("settingsWidget")
		tap("widgetCopySettings")
		reveal("widgetAutomaticLanding")
		compose.onNodeWithTag("widgetAutomaticLanding").assertIsOff()
		reveal("widgetOperator-NY Waterway")
		compose.onNodeWithTag("widgetOperator-NY Waterway").assertIsOff()
		tap("widgetBoatNames")
		shot("widget-detail-settings")
		launch(reset = false, link = "ferryboard://nearby")
		reveal("widgetBoatNames")
		compose.onNodeWithTag("widgetBoatNames").assertIsOff()
	}

	/**
	 * Every shown [text] (inside [within], when given) renders whole on one line inside the window: no wrapped, clipped
	 * or offscreen clock. The semantics text layout is re-measured at the node's maximum width, so its overflow flags
	 * are not used; the line's own extent is compared with the node instead.
	 */
	private fun assertWholeOnOneLine(text: String, within: String? = null) {
		val matcher = hasText(text) and if (within != null) hasAnyAncestor(hasTestTag(within)) else hasText(text)
		val nodes = compose.onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes()
		assertTrue("$text is shown", nodes.isNotEmpty())
		val width = context.resources.displayMetrics.widthPixels
		for (node in nodes) {
			val layouts = mutableListOf<TextLayoutResult>()
			node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
			val layout = layouts.single()
			val bounds = node.boundsInWindow
			assertEquals("$text wraps at $bounds", 1, layout.lineCount)
			val line = layout.getLineRight(0) - layout.getLineLeft(0)
			assertTrue("$text is clipped: a $line x ${layout.getLineBottom(0)} px line in ${node.size}",
				line <= node.size.width + 1f && layout.getLineBottom(0) <= node.size.height + 1f)
			assertTrue("$text runs off screen at $bounds", bounds.left >= 0f && bounds.right <= width)
		}
	}
	private fun bounds(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
	private fun statusBarHeight(): Int {
		var height = 0
		scenario?.onActivity { activity ->
			height = ViewCompat.getRootWindowInsets(activity.window.decorView)?.getInsets(WindowInsetsCompat.Type.statusBars())?.top ?: 0
		}
		return height
	}

	@Test fun largeTextAndTabletWorkspaceKeepPrimaryActionsReachable() {
		waitTag("departure-nine")
		try {
			shell("settings put system font_scale 1.8")
			scenario?.recreate()
			waitTag("departure-nine")
			tap("settings")
			reveal("clockFormat")
			compose.onNodeWithTag("clockFormat").assertIsDisplayed()
			shot("large-text-settings")
			tap("clockFormat")
			dismiss()
			tap("departure-nine")
			reveal("tripRide")
			compose.onNodeWithTag("tripRide").assertIsDisplayed()
			compose.onNodeWithTag("tripMap").assertIsDisplayed()
			shot("large-text-trip")
			// Whole 12-hour times with their estimate marker, at the wider clock spacing.
			for (text in listOf("9:00 AM", "9:01 AM", "9:12 AM", "9:11 AM", "EST", "sched 9:10 AM")) assertWholeOnOneLine(text, within = "tripStops")
			tap("tripMap")
			waitTag("harborMap")
			compose.waitUntil(20_000) {
				!exists("dismissSheet") && compose.onAllNodesWithTag("mapBoatMarker-opportunity", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
			}
			compose.onNodeWithTag("mapBoatMarker-opportunity", useUnmergedTree = true).assertIsSelected()
			shot("large-text-trip-map")
			tap("navigation-departures")
			tap("departure-nine")
			reveal("tripRide")
			tap("tripRide")
			waitTag("rideArrival")
			compose.onNodeWithTag("rideArrival").assertIsDisplayed()
			shot("large-text-ride")
			for (text in listOf("9:12 AM", "9:13 AM", "estimated")) assertWholeOnOneLine(text)
			tap("exitRide")
			shell("settings put system font_scale 1.0")
			shell("wm size 1600x2560")
			shell("wm density 240")
			launch(reset = false)
			waitTag("tabletWorkspace")
			waitTag("departure-nine")
			// The sidebar's surface runs under the status bar; its content, from the title down, stays below it.
			assertEquals("Sidebar top", 0f, bounds("landingSidebar").top, 0.5f)
			val title = compose.onNode(hasText("Ferry Board") and hasAnyAncestor(hasTestTag("landingSidebar"))).fetchSemanticsNode().boundsInRoot
			assertTrue("Sidebar title at ${title.top} clears the ${statusBarHeight()} px status bar", title.top >= statusBarHeight())
			shot("tablet-departures")
			tap("navigation-map")
			waitTag("harborMap")
			assertTrue("Portrait: the lists stack below the chart", bounds("mapPanel").top >= bounds("harborMap").bottom)
			shot("tablet-map")
			shell("wm size 2560x1600")
			launch(reset = false)
			waitTag("tabletWorkspace")
			if (!exists("harborMap")) tap("navigation-map")
			waitTag("harborMap")
			val chart = bounds("harborMap")
			assertTrue("Landscape: the lists sit beside the chart", bounds("mapPanel").left >= chart.right)
			val density = context.resources.displayMetrics.density
			assertTrue("Landscape: the chart keeps ${chart.width / density} dp", chart.width / density >= 480f)
			shot("tablet-map-landscape")
		} finally {
			shell("settings put system font_scale 1.0")
			shell("wm size reset")
			shell("wm density reset")
		}
	}

	@Test fun everyThemeKeepsTheDepartureBoardAndSettingsReachable() {
		waitTag("departure-nine")
		for (theme in listOf("nyc-ferry", "night", "hello-kitty", "cinnamoroll", "pompompurin", "kuromi", "windows-xp", "hacker", "burger-king")) {
			tap("settings")
			tap("settingsTheme")
			tap("theme-$theme")
			dismiss()
			waitTag("departure-nine")
			compose.onNodeWithTag("chooseLanding").assertIsDisplayed()
			shot("theme-$theme")
		}
	}
}
