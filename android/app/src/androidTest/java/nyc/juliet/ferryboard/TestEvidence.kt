package nyc.juliet.ferryboard

import android.content.Context
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
