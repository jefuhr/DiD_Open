package nyc.juliet.ferryboard

import android.content.Intent
import android.content.res.Configuration
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetHostView
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import nyc.juliet.ferryboard.core.WidgetDeparture
import nyc.juliet.ferryboard.core.WidgetOptions
import nyc.juliet.ferryboard.platform.FerryWidgetRenderer
import nyc.juliet.ferryboard.platform.WidgetPresentation
import nyc.juliet.ferryboard.platform.WidgetSize
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.ceil

/** Renders production RemoteViews in a native widget host without binding an ID or running live jobs. */
@RunWith(AndroidJUnit4::class)
class FerryWidgetRenderingTest {
	private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
	private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()
	private lateinit var scenario: ActivityScenario<MainActivity>
	private var rendered: View? = null
	private val now = Instant.parse("2026-09-04T12:50:00Z")
	private val presentation get() = WidgetPresentation(
		landingId = 16,
		landingName = "Pier 11 / Wall St",
		locationLabel = "Fixed landing",
		message = null,
		rows = listOf(WidgetDeparture("first", "09:02", "ER", "East 34th Street", "ER1 · Opportunity", "12 min", true)),
		updatedAt = now,
		renderedAt = now,
		saved = false,
	)

	@Before fun start() {
		scenario = ActivityScenario.launch(Intent(context, MainActivity::class.java)
			.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
			.putExtra("FERRY_UI_TESTS", true).putExtra("FERRY_RESET", true))
	}
	@After fun stop() { scenario.close() }

	private fun render(value: WidgetPresentation, options: WidgetOptions, size: WidgetSize,
		widthDp: Int = if (size == WidgetSize.SMALL) 180 else 340,
		heightDp: Int = if (size == WidgetSize.LARGE) 340 else 180,
		fontScale: Float? = null) {
		val drawn = CountDownLatch(1)
		scenario.onActivity { activity ->
			val root = FrameLayout(activity)
			root.setBackgroundColor(0xFFE4E7EB.toInt())
			val density = activity.resources.displayMetrics.density
			// Collection adapters require an AppWidgetHostView even when no launcher ID is bound.
			val host = AppWidgetHostView(activity)
			val renderContext = if (fontScale == null) activity else activity.createConfigurationContext(Configuration(activity.resources.configuration).apply { this.fontScale = fontScale })
			val view = FerryWidgetRenderer.render(renderContext, value, options, size).apply(renderContext, host)
			host.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
			root.addView(host, FrameLayout.LayoutParams((widthDp * density).toInt(), (heightDp * density).toInt(), Gravity.CENTER))
			view.viewTreeObserver.addOnDrawListener { drawn.countDown() }
			activity.setContentView(root)
			rendered = view
		}
		assertTrue("The widget did not draw", drawn.await(10, TimeUnit.SECONDS))
		instrumentation.waitForIdleSync()
	}
	private fun text(): String {
		var result = ""
		instrumentation.runOnMainSync {
			fun values(view: View): List<String> {
				if (view.visibility != View.VISIBLE) return emptyList()
				return (if (view is TextView) listOf(view.text.toString()) else emptyList()) +
					if (view is ViewGroup) (0 until view.childCount).flatMap { values(view.getChildAt(it)) } else emptyList()
			}
			result = rendered?.let { values(it).joinToString(" | ") }.orEmpty()
		}
		return result
	}
	private fun awaitText(expected: String) {
		val deadline = SystemClock.uptimeMillis() + 5_000
		while (!text().contains(expected) && SystemClock.uptimeMillis() < deadline) {
			SystemClock.sleep(50)
			instrumentation.waitForIdleSync()
		}
		assertTrue("Expected '$expected' in widget: ${text()}", text().contains(expected))
	}
	private fun shot(name: String) {
		val directory = screenshotDirectory()
		var bitmap: Bitmap? = null
		instrumentation.runOnMainSync {
			val view = checkNotNull(rendered)
			assertTrue(view.isAttachedToWindow && view.width > 0 && view.height > 0)
			bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
		}
		File(directory, "$name.png").outputStream().use { checkNotNull(bitmap).compress(Bitmap.CompressFormat.PNG, 100, it) }
		bitmap?.recycle()
	}

	@Test fun everyWidgetSizeRendersTheSelectedLandingAndEstimatedDeparture() {
		for (size in WidgetSize.entries) {
			render(presentation, WidgetOptions(automaticLanding = false, landingId = 16), size)
			awaitText("Pier 11")
			awaitText("09:02")
			awaitText("East 34th Street")
			assertTrue(text().contains("~"))
			shot("widget-${size.name.lowercase()}")
		}
	}

	@Test fun independentWidgetOptionsAndSavedStateReachTheRealViews() {
		render(presentation, WidgetOptions(automaticLanding = false, landingId = 16, showCountdown = true), WidgetSize.LARGE)
		awaitText("12 min")
		val other = presentation.copy(landingId = 26, landingName = "Midtown West / Pier 79", saved = true,
			rows = presentation.rows.map { it.copy(estimated = false) })
		render(other, WidgetOptions(automaticLanding = false, landingId = 26, showCountdown = false, theme = "night"), WidgetSize.LARGE)
		awaitText("Pier 79")
		awaitText("Saved")
		assertFalse(text().contains("12 min"))
		assertFalse(text().contains("~"))
		assertFalse(text().contains("Pier 11"))
		shot("widget-saved-night")
	}

	@Test fun mediumBoundaryShowsTwoCompleteDeparturesWithTwelveHourClocks() {
		val value = presentation.copy(rows = listOf(
			presentation.rows.first().copy(time = "9:02 AM"),
			presentation.rows.first().copy(id = "second", time = "9:25 AM", destination = "Rockaway / Sunset Park", countdown = "35 min"),
		))
		render(value, WidgetOptions(automaticLanding = false, landingId = 16, twelveHour = true), WidgetSize.MEDIUM, 280, 180)
		awaitText("9:25 AM")
		shot("widget-medium-minimum-two-departures")
		instrumentation.runOnMainSync {
			fun checkText(view: View) {
				if (view.visibility != View.VISIBLE) return
				if (view is TextView && view.text.isNotEmpty()) {
					val visible = Rect()
					assertTrue("Clipped medium widget text: ${view.text}", view.getGlobalVisibleRect(visible) && visible.height() >= view.height &&
						view.layout.getLineBottom(view.layout.lineCount - 1) <= view.height - view.compoundPaddingTop - view.compoundPaddingBottom)
				}
				if (view is ViewGroup) (0 until view.childCount).forEach { checkText(view.getChildAt(it)) }
			}
			checkText(checkNotNull(rendered))
		}
	}

	@Test fun locationSetupStateCannotDisplayLeftoverLiveRows() {
		val missing = presentation.copy(landingId = null, landingName = "Nearest landing",
			locationLabel = null, rows = emptyList(), updatedAt = null,
			message = "Allow location or choose a fixed landing")
		render(missing, WidgetOptions(), WidgetSize.MEDIUM)
		awaitText("Allow location or choose a fixed landing")
		awaitText("Not updated")
		assertFalse(text().contains("Opportunity"))
		shot("widget-location-required")
	}

	@Test fun compactWidgetsExposeLastLocationStatusToAccessibility() {
		for (size in listOf(WidgetSize.SMALL, WidgetSize.MEDIUM)) {
			render(presentation.copy(locationLabel = "Last location · waiting for GPS", saved = true), WidgetOptions(), size)
			awaitText("Pier 11")
			var descriptions = ""
			instrumentation.runOnMainSync {
				fun labels(view: View): List<String> {
					if (view.visibility != View.VISIBLE || view.importantForAccessibility == View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) return emptyList()
					val own = if (view.isImportantForAccessibility) listOfNotNull(view.contentDescription?.toString()) else emptyList()
					return own + if (view is ViewGroup) (0 until view.childCount).flatMap { labels(view.getChildAt(it)) } else emptyList()
				}
				descriptions = rendered?.let { labels(it).joinToString(" | ") }.orEmpty()
			}
			assertTrue("$size widget lost accessible location freshness: $descriptions", descriptions.contains("Last location"))
		}
	}

	@Test fun minimumWidgetSizeKeepsTheDepartureAndFreshnessVisible() {
		val provider = AppWidgetManager.getInstance(context).installedProviders
			.first { it.provider.className == "nyc.juliet.ferryboard.platform.FerryWidgetProvider" }
		val density = context.resources.displayMetrics.density
		render(presentation, WidgetOptions(automaticLanding = false, landingId = 16), WidgetSize.SMALL,
			ceil(provider.minResizeWidth / density).toInt(), ceil(provider.minResizeHeight / density).toInt())
		awaitText("09:02")
		shot("widget-minimum-size")
		instrumentation.runOnMainSync {
			for (id in listOf(R.id.widget_title, R.id.widget_time, R.id.widget_destination, R.id.widget_footer)) {
				val view = checkNotNull(rendered?.findViewById<View>(id))
				val visible = Rect()
				assertTrue("${context.resources.getResourceEntryName(id)} is clipped at the advertised minimum widget size",
					view.isAttachedToWindow && view.getGlobalVisibleRect(visible) && view.width > 0 && view.height > 0 && visible.height() >= view.height)
				if (view is TextView) {
					assertTrue("${context.resources.getResourceEntryName(id)} text is clipped inside its measured view",
						view.layout.getLineBottom(view.layout.lineCount - 1) <= view.height - view.compoundPaddingTop - view.compoundPaddingBottom)
				}
			}
		}
	}

	@Test fun smallWidgetKeepsTheFirstDepartureAndFreshnessAtLargeSystemText() {
		render(presentation.copy(rows = presentation.rows.map { it.copy(time = "9:02 AM") }),
			WidgetOptions(automaticLanding = false, landingId = 16, twelveHour = true), WidgetSize.SMALL, 180, 180, fontScale = 1.8f)
		awaitText("9:02 AM")
		shot("widget-small-large-text")
		instrumentation.runOnMainSync {
			for (id in listOf(R.id.widget_title, R.id.widget_time, R.id.widget_destination, R.id.widget_footer)) {
				val view = checkNotNull(rendered?.findViewById<TextView>(id))
				val visible = Rect()
				assertTrue("Large text is clipped: ${view.text}", view.getGlobalVisibleRect(visible) && visible.height() >= view.height &&
					view.layout.getLineBottom(view.layout.lineCount - 1) <= view.height - view.compoundPaddingTop - view.compoundPaddingBottom)
			}
			assertEquals(View.GONE, rendered?.findViewById<View>(R.id.widget_countdown)?.visibility)
			assertTrue(rendered?.findViewById<View>(R.id.widget_row)?.contentDescription.toString().contains("12 min"))
		}
	}

	@Test fun widgetSettingsAndRefreshHaveAccessibleTouchTargets() {
		for (size in WidgetSize.entries) {
			render(presentation, WidgetOptions(), size)
			instrumentation.runOnMainSync {
				val minimum = 48 * context.resources.displayMetrics.density
				for (id in listOf(R.id.widget_settings, R.id.widget_refresh)) {
					val view = checkNotNull(rendered?.findViewById<View>(id))
					if (view.visibility == View.VISIBLE) assertTrue("$size ${context.resources.getResourceEntryName(id)} needs a 48dp touch target",
						view.width >= minimum && view.height >= minimum)
				}
			}
		}
	}
}
