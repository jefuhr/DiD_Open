package nyc.juliet.ferryboard.platform

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import nyc.juliet.ferryboard.BuildConfig
import nyc.juliet.ferryboard.MainActivity
import nyc.juliet.ferryboard.contract.FerryAction
import nyc.juliet.ferryboard.ui.WidgetSettingsContent
import nyc.juliet.ferryboard.ui.theme.FerryTheme

class FerryWidgetConfigurationActivity : ComponentActivity() {
	private lateinit var model: FerryViewModel
	private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
	private var applying = false
	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		setResult(Activity.RESULT_CANCELED)
		widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
		val policy = TestLaunchPolicy.resolve(BuildConfig.DEBUG,
			savedInstanceState?.getBoolean("fixtures") ?: intent.getBooleanExtra("FERRY_UI_TESTS", false),
			intent.getBooleanExtra("FERRY_RESET", false),
			savedInstanceState?.getBoolean("fixture-offline") ?: intent.getBooleanExtra("FERRY_OFFLINE", false), savedInstanceState != null)
		if (widgetId <= 0 || (!policy.fixtures && widgetId !in FerryWidgetProvider.ids(this))) { finish(); return }
		model = ViewModelProvider(this, FerryViewModel.Factory(applicationContext, policy, widgetDraft = true))[FerryViewModel::class.java]
		val restored = savedInstanceState?.getString("widget-draft")?.let { runCatching { ferryJson.decodeFromString<WidgetSettings>(it) }.getOrNull() }
		model.store.configureWidget(restored ?: WidgetSettingsStore(model.runtime.settings).read(widgetId))
		enableEdgeToEdge()
		setContent {
			val state = model.state.collectAsStateWithLifecycle(minActiveState = Lifecycle.State.RESUMED).value
			FerryTheme(themeId = state.preferences.theme, textSize = state.preferences.textSize) {
				Surface(modifier = Modifier.fillMaxSize()) {
					Column(Modifier.safeDrawingPadding()) {
						Text("Edit Ferry Board widget", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(16.dp))
						WidgetSettingsContent(state, model::dispatch, Modifier.weight(1f))
						Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
							OutlinedButton(onClick = { finish() }, modifier = Modifier.weight(1f)) { Text("Cancel") }
							Button(onClick = { applySettings() }, modifier = Modifier.weight(1f)) { Text("Apply") }
						}
					}
				}
			}
		}
		lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.RESUMED) {
			model.effects.collect { action ->
				when (action) {
					FerryAction.EnableWidgetLocation -> {
						if (model.runtime.fixtures) model.store.widgetStatus("Fixture sessions do not change location permissions.")
						else AlertDialog.Builder(this@FerryWidgetConfigurationActivity).setTitle("Optional widget location")
							.setMessage("Automatic nearest landings need separately enabled background location. Open Ferry Board to enable it, or keep a fixed landing without any location access. Your draft stays here until you apply it.")
							.setNegativeButton("Keep editing", null).setPositiveButton("Open Ferry Board") { _, _ -> startActivity(Intent(this@FerryWidgetConfigurationActivity, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("ferryboard://nearby"))) }.show()
					}
					FerryAction.RefreshWidgets -> model.store.widgetStatus("Apply your choices to refresh this widget.")
					else -> Unit
				}
			}
		} }
	}
	private fun applySettings() {
		if (applying) return
		if (!model.runtime.fixtures && widgetId !in FerryWidgetProvider.ids(this)) { finish(); return }
		val state = model.state.value
		val options = if (state.widgetUseAppDefaults) WidgetSettingsStore(model.runtime.settings).defaults() else state.widgetOptions
		if (!options.automaticLanding && (options.landingId == null || state.roster?.landings?.any { it.id == options.landingId } != true)) {
			model.store.widgetStatus("Choose a valid fixed landing before applying. Connect once if the landing list is unavailable."); return
		}
		try {
			WidgetSettingsStore(model.runtime.settings).save(widgetId, model.store.widgetRecord())
			applying = true
			lifecycleScope.launch {
				if (!model.runtime.fixtures) { FerryWidgetProvider.refreshCached(this@FerryWidgetConfigurationActivity, intArrayOf(widgetId)).join(); FerryWidgetProvider.requestRefresh(this@FerryWidgetConfigurationActivity) }
				setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)); finish()
			}
		} catch (_: Exception) { model.store.widgetStatus("These widget choices could not be saved. Please try again.") }
	}
	override fun onResume() { super.onResume(); if (::model.isInitialized) model.setActive(true) }
	override fun onPause() { if (::model.isInitialized) model.setActive(false); super.onPause() }
	override fun onSaveInstanceState(outState: Bundle) {
		if (::model.isInitialized) { outState.putBoolean("fixtures", model.runtime.fixtures); outState.putBoolean("fixture-offline", model.runtime.fixtureOffline); outState.putString("widget-draft", ferryJson.encodeToString(model.store.widgetRecord())) }
		super.onSaveInstanceState(outState)
	}
}
