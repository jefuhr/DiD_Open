package nyc.juliet.ferrykitty

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/** Keep every run's images separate so a focused rerun cannot report an older screen as new evidence. */
internal fun screenshotDirectory(): File {
	val run = InstrumentationRegistry.getArguments().getString("ferryEvidenceRun") ?: "manual"
	require(run.matches(Regex("[A-Za-z0-9_-]+")))
	val context = ApplicationProvider.getApplicationContext<Context>()
	return File(context.getExternalFilesDir(null), "screenshots/$run").apply { mkdirs() }
}

/**
 * The screen once two captures a quarter second apart agree. After [timeoutMillis] it returns the latest capture.
 * A stable image may still precede a pending GPU frame; callers checking a theme change also verify an independent
 * theme marker. The caller recycles the result.
 */
internal fun settledScreenshot(timeoutMillis: Long = 3_000): Bitmap {
	val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
	fun capture(): Bitmap {
		// A loaded software-rendered emulator occasionally returns no capture; try again briefly.
		var raw = automation.takeScreenshot()
		repeat(4) {
			if (raw == null) {
				SystemClock.sleep(500)
				raw = automation.takeScreenshot()
			}
		}
		val captured = checkNotNull(raw) { "No screen capture after retries" }
		return captured.copy(Bitmap.Config.ARGB_8888, false).also { captured.recycle() }
	}
	val deadline = SystemClock.uptimeMillis() + timeoutMillis
	var previous = capture()
	while (true) {
		SystemClock.sleep(250)
		val next = capture()
		val settled = next.sameAs(previous)
		previous.recycle()
		if (settled || SystemClock.uptimeMillis() >= deadline) return next
		previous = next
	}
}
