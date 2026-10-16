package nyc.juliet.ferryboard.platform

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.SizeF
import kotlinx.coroutines.*
import nyc.juliet.ferrykitty.platform.*
import nyc.juliet.ferrykitty.core.*
import java.time.Instant

class FerryWidgetProvider : AppWidgetProvider() {
	override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
		requestRefresh(context)
		val pending = goAsync()
		widgetScope.launch { try { withTimeoutOrNull(8_000) { updateWidgets(context, appWidgetIds, network = false) } } finally { pending.finish() } }
	}
	override fun onEnabled(context: Context) { reconcileJobs(context) }
	override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
		val pending = goAsync()
		widgetScope.launch { try { withTimeoutOrNull(8_000) { updateWidgets(context, intArrayOf(appWidgetId), network = false) } } finally { pending.finish() } }
	}
	override fun onDeleted(context: Context, appWidgetIds: IntArray) {
		val storage = WidgetSettingsStore(AndroidRuntime.settings(context))
		appWidgetIds.forEach(storage::remove)
		val remaining = ids(context).filterNot { it in appWidgetIds }.toIntArray()
		reconcileJobs(context, remaining)
		scheduleExpiration(context, WidgetExpiryStore(AndroidRuntime.settings(context)).next(remaining))
	}
	override fun onDisabled(context: Context) { reconcileJobs(context, intArrayOf()) }
	override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
		val storage = WidgetSettingsStore(AndroidRuntime.settings(context))
		val expiry = WidgetExpiryStore(AndroidRuntime.settings(context))
		oldWidgetIds.zip(newWidgetIds.toList()).forEach { (old, new) -> storage.save(new, storage.read(old)); expiry.record(new, expiry.read(old)); storage.remove(old) }
		requestRefresh(context)
	}
	override fun onReceive(context: Context, intent: Intent) {
		if (intent.action == ACTION_REFRESH) {
			requestRefresh(context)
			val pending = goAsync()
			widgetScope.launch { try { withTimeoutOrNull(8_000) { updateWidgets(context, ids(context), network = false) } } finally { pending.finish() } }
		} else super.onReceive(context, intent)
	}
	companion object {
		const val ACTION_REFRESH = "nyc.juliet.ferryboard.REFRESH_WIDGETS"
		private const val PERIODIC_JOB = 0xF317
		private const val REQUESTED_JOB = 0xF318
		internal const val EXPIRATION_JOB = 0xF319
		private val widgetScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
		private val updateGenerations = mutableMapOf<Int, Long>()
		fun ids(context: Context): IntArray = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, FerryWidgetProvider::class.java))
		fun reconcileJobs(context: Context, remaining: IntArray = ids(context)) {
			val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
			if (remaining.isEmpty()) { scheduler.cancel(PERIODIC_JOB); scheduler.cancel(REQUESTED_JOB); scheduler.cancel(EXPIRATION_JOB); return }
			if (scheduler.getPendingJob(PERIODIC_JOB) == null) scheduler.schedule(JobInfo.Builder(PERIODIC_JOB, ComponentName(context, FerryWidgetJobService::class.java))
				.setPeriodic(15 * 60_000L, 5 * 60_000L).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build())
		}
		fun requestRefresh(context: Context): Boolean {
			val remaining = ids(context); reconcileJobs(context, remaining)
			if (remaining.isEmpty()) return false
			val scheduler = context.getSystemService(JobScheduler::class.java) ?: return false
			return scheduler.schedule(JobInfo.Builder(REQUESTED_JOB, ComponentName(context, FerryWidgetJobService::class.java))
				.setMinimumLatency(0).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).build()) == JobScheduler.RESULT_SUCCESS
		}
		private fun scheduleExpiration(context: Context, at: Instant?) {
			val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
			if (at == null || ids(context).isEmpty()) { scheduler.cancel(EXPIRATION_JOB); return }
			val delay = (at.toEpochMilli() - Instant.now().toEpochMilli() + 1_000).coerceAtLeast(1_000)
			// This is inexact too. Absolute footer times remain honest if Android delays it.
			scheduler.schedule(JobInfo.Builder(EXPIRATION_JOB, ComponentName(context, FerryWidgetJobService::class.java)).setMinimumLatency(delay).build())
		}
		fun refreshPermissionState(context: Context) {
			val remaining = ids(context)
			if (remaining.isEmpty()) return
			if (!AndroidLocation(context).backgroundGranted()) WidgetSettingsStore(AndroidRuntime.settings(context)).saveLastLanding(null)
			refreshCached(context, remaining)
		}
		fun refreshCached(context: Context, requestedIds: IntArray = ids(context)): Job = widgetScope.launch {
			withTimeoutOrNull(8_000) { updateWidgets(context.applicationContext, requestedIds, network = false) }
		}
		/** Adapters call on Main; network suspension does not block an immediate cached settings render. */
		internal suspend fun updateWidgets(context: Context, requestedIds: IntArray = ids(context), network: Boolean = true) {
			val generations = requestedIds.toList().associateWith { id -> ((updateGenerations[id] ?: 0L) + 1).also { updateGenerations[id] = it } }
			val runtime = AndroidRuntime.session(context)
			val storage = WidgetSettingsStore(runtime.settings)
			val expiry = WidgetExpiryStore(runtime.settings)
			val manager = AppWidgetManager.getInstance(context)
			val authorized = AndroidLocation(context).backgroundGranted()
			if (!authorized) storage.saveLastLanding(null)
			var fix: LocationResult? = null
			val results = mutableMapOf<WidgetOptions, WidgetPresentation>()
			for (id in requestedIds) {
				currentCoroutineContext().ensureActive()
				if (id !in ids(context)) continue
				val options = storage.options(id)
				val presentation = results[options] ?: run {
					if (network && options.automaticLanding && authorized && fix == null) fix = AndroidLocation(context).request(background = true)
					val value = WidgetDataSource(runtime.repository, storage, runtime.clock).presentation(options, authorized, fix, network)
					results[options] = value; value
				}
				// Do not publish an old per-instance choice after a configuration commit or deletion.
				if (id !in ids(context) || storage.options(id) != options || updateGenerations[id] != generations[id]) continue
				val safePresentation = if (options.automaticLanding && !AndroidLocation(context).backgroundGranted()) {
					storage.saveLastLanding(null)
					WidgetPresentation(message = "Location is not allowed. Tap to enable it or choose a fixed landing.", renderedAt = runtime.clock())
				} else presentation
				val layouts = mapOf(
					SizeF(180f, 180f) to FerryWidgetRenderer.render(context, safePresentation, options, WidgetSize.SMALL, id),
					SizeF(280f, 180f) to FerryWidgetRenderer.render(context, safePresentation, options, WidgetSize.MEDIUM, id),
					SizeF(280f, 280f) to FerryWidgetRenderer.render(context, safePresentation, options, WidgetSize.LARGE, id),
				)
				manager.updateAppWidget(id, android.widget.RemoteViews(layouts))
				expiry.record(id, safePresentation.expiresAt)
			}
			scheduleExpiration(context, expiry.next(ids(context)))
		}
	}
}

class FerryWidgetJobService : JobService() {
	private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
	private val jobs = mutableMapOf<Int, Job>()
	override fun onStartJob(params: JobParameters): Boolean {
		jobs.remove(params.jobId)?.cancel()
		val job = scope.launch(start = CoroutineStart.LAZY) {
			try { withTimeoutOrNull(45_000) { FerryWidgetProvider.updateWidgets(this@FerryWidgetJobService, network = params.jobId != FerryWidgetProvider.EXPIRATION_JOB) } }
			finally { if (currentCoroutineContext().isActive) { jobs.remove(params.jobId); jobFinished(params, false) } }
		}
		jobs[params.jobId] = job; job.start()
		return true
	}
	override fun onStopJob(params: JobParameters): Boolean { jobs.remove(params.jobId)?.cancel(); return FerryWidgetProvider.ids(this).isNotEmpty() }
	override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

class FerryWidgetBootReceiver : BroadcastReceiver() {
	override fun onReceive(context: Context, intent: Intent) { if (intent.action in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) FerryWidgetProvider.requestRefresh(context) }
}
