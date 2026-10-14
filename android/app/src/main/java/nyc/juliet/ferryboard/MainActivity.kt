package nyc.juliet.ferryboard

import android.Manifest
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import nyc.juliet.ferryboard.contract.*
import nyc.juliet.ferryboard.platform.*
import nyc.juliet.ferryboard.ui.FerryApp

class MainActivity : ComponentActivity() {
	private lateinit var model: FerryViewModel
	private var pendingNearest = false
	private var pendingWidgetForeground = false
	private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
		val granted = AndroidLocation(this).foregroundGranted()
		if (pendingNearest) {
			pendingNearest = false
			lifecycleScope.launch {
				lifecycle.currentStateFlow.first { state -> state.isAtLeast(Lifecycle.State.RESUMED) }
				if (granted) model.dispatch(FerryAction.FindNearest)
				else model.store.locationResult(model.store.locationRequestToken(), null, "Location was not allowed. You can choose a landing manually.")
			}
		}
		if (pendingWidgetForeground) {
			pendingWidgetForeground = false
			model.store.widgetStatus(if (granted) "Location while using the app is enabled. Tap Enable widget location again to allow background updates." else "Location was not allowed. Fixed-landing widgets work without it.")
		}
	}
	private val settingsRequest = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { recheckWidgetLocation() }

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		pendingNearest = savedInstanceState?.getBoolean("pending-nearest") ?: false
		pendingWidgetForeground = savedInstanceState?.getBoolean("pending-widget-foreground") ?: false
		val policy = TestLaunchPolicy.resolve(BuildConfig.DEBUG,
			savedInstanceState?.getBoolean("fixtures") ?: intent.getBooleanExtra("FERRY_UI_TESTS", false),
			intent.getBooleanExtra("FERRY_RESET", false),
			savedInstanceState?.getBoolean("fixture-offline") ?: intent.getBooleanExtra("FERRY_OFFLINE", false), savedInstanceState != null)
		model = ViewModelProvider(this, FerryViewModel.Factory(applicationContext, policy))[FerryViewModel::class.java]
		if (savedInstanceState == null) handleIntent(intent)
		enableEdgeToEdge()
		setContent {
			val state = model.state.collectAsStateWithLifecycle(minActiveState = Lifecycle.State.RESUMED).value
			FerryApp(state, model::dispatch)
		}
		lifecycleScope.launch {
			repeatOnLifecycle(Lifecycle.State.RESUMED) {
				launch { model.effects.collect { handleEffect(it) } }
			}
		}
		onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
			override fun handleOnBackPressed() {
				when {
					model.state.value.sheet != null -> model.dispatch(FerryAction.OpenSheet(null))
					model.state.value.showingRide -> model.dispatch(FerryAction.MinimizeRide)
					else -> { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
				}
			}
		})
	}
	override fun onResume() { super.onResume(); model.setActive(true); if (!model.runtime.fixtures) recheckWidgetLocation() }
	override fun onPause() { model.setActive(false); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onPause() }
	override fun onSaveInstanceState(outState: Bundle) {
		outState.putBoolean("fixtures", model.runtime.fixtures)
		outState.putBoolean("fixture-offline", model.runtime.fixtureOffline)
		outState.putBoolean("pending-nearest", pendingNearest); outState.putBoolean("pending-widget-foreground", pendingWidgetForeground)
		super.onSaveInstanceState(outState)
	}
	override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }
	private fun handleIntent(intent: Intent) { FerryLinks.parse(intent.dataString)?.let(model.store::handleLink) }

	private fun handleEffect(action: FerryAction) {
		when (action) {
			FerryAction.FindNearest -> if (AndroidLocation(this).foregroundGranted()) model.findNearest() else {
				pendingNearest = true
				permissionRequest.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
			}
			FerryAction.EnableWidgetLocation -> enableWidgetLocation()
			FerryAction.RefreshWidgets -> if (model.runtime.fixtures) model.store.widgetStatus("Test settings are isolated from your Home Screen widgets.") else {
				FerryWidgetProvider.refreshCached(this)
				val scheduled = FerryWidgetProvider.requestRefresh(this)
				model.store.widgetStatus(if (scheduled) "Widget refresh requested. Android controls when background updates run." else "Add a widget first, or try again if Android could not schedule a refresh.")
			}
			FerryAction.PinWidget -> {
				if (model.runtime.fixtures) { model.store.widgetStatus("Widget pinning is disabled in fixture sessions."); return }
				val manager = AppWidgetManager.getInstance(this)
				if (manager.isRequestPinAppWidgetSupported) {
					val accepted = manager.requestPinAppWidget(ComponentName(this, FerryWidgetProvider::class.java), null, null)
					model.store.widgetStatus(if (accepted) "Widget pin requested. Confirm it in your launcher." else "Your launcher could not pin the widget.")
				} else model.store.widgetStatus("Add Ferry Board from your launcher's widget picker.")
			}
			is FerryAction.OpenUrl -> {
				val uri = runCatching { Uri.parse(action.url) }.getOrNull()
				if (uri?.scheme !in setOf("https", "http") || uri?.host.isNullOrBlank()) return
				try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) { model.store.widgetStatus("No browser is available to open this link.") }
			}
			else -> Unit
		}
	}
	private fun enableWidgetLocation() {
		if (model.runtime.fixtures) { model.store.widgetStatus("Fixture sessions do not request widget location or change real widgets."); return }
		val location = AndroidLocation(this)
		if (!location.foregroundGranted()) {
			AlertDialog.Builder(this).setTitle("Nearest-landing widgets")
				.setMessage("Location is optional. First allow location while using Ferry Board. You can separately enable background location afterward, or choose a fixed landing without location access.")
				.setNegativeButton("Use a fixed landing", null)
				.setPositiveButton("Allow while using the app") { _, _ ->
					pendingWidgetForeground = true
					permissionRequest.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
				}.show()
		} else if (!location.backgroundGranted()) {
			val label = packageManager.backgroundPermissionOptionLabel
			AlertDialog.Builder(this).setTitle("Allow nearest widgets in the background")
				.setMessage("To update the nearest landing while Ferry Board is closed, open Permissions → Location and choose $label. Widgets take a brief location fix when Android runs an update, never continuously, and coordinates stay on your device. Fixed landings need no location permission.")
				.setNegativeButton("Keep fixed landing", null)
				.setPositiveButton("Open app settings") { _, _ -> settingsRequest.launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }.show()
		} else { model.store.widgetStatus("Background location is enabled for nearest-landing widgets."); FerryWidgetProvider.requestRefresh(this) }
	}
	private fun recheckWidgetLocation() {
		if (model.runtime.fixtures) return
		if (!AndroidLocation(this).backgroundGranted()) WidgetSettingsStore(AndroidRuntime.settings(this)).saveLastLanding(null)
		FerryWidgetProvider.refreshPermissionState(this)
	}
}
