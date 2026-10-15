package nyc.juliet.ferryboard.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import kotlin.coroutines.resume

class AndroidLocation(private val context: Context, private val clock: () -> Instant = { Instant.now() }) {
	fun foregroundGranted() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
	fun backgroundGranted() = foregroundGranted() && ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

	/** One bounded request, cancelled on lifecycle stop. No service or continuous listener. */
	suspend fun request(background: Boolean): LocationResult {
		if (if (background) !backgroundGranted() else !foregroundGranted()) return LocationResult.NotAuthorized
		val manager = context.getSystemService(LocationManager::class.java) ?: return LocationResult.Unavailable
		val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
			.firstOrNull { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) } ?: return LocationResult.Unavailable
		return try {
			withTimeoutOrNull(8_000) {
				suspendCancellableCoroutine { continuation ->
					val cancellation = CancellationSignal()
					continuation.invokeOnCancellation { cancellation.cancel() }
					manager.getCurrentLocation(provider, cancellation, ContextCompat.getMainExecutor(context)) { location ->
						if (!continuation.isActive) return@getCurrentLocation
						val valid = location != null && location.hasAccuracy() && location.accuracy in 0f..5_000f &&
							location.latitude.isFinite() && location.longitude.isFinite() && location.latitude in -90.0..90.0 && location.longitude in -180.0..180.0 &&
							(clock().toEpochMilli() - location.time) in 0..900_000L
						continuation.resume(if (valid) LocationResult.Fix(LocationFix(location!!.latitude, location.longitude, Instant.ofEpochMilli(location.time))) else LocationResult.Unavailable)
					}
				}
			} ?: LocationResult.Unavailable
		} catch (_: SecurityException) { LocationResult.NotAuthorized }
		catch (_: IllegalArgumentException) { LocationResult.Unavailable }
	}
}
