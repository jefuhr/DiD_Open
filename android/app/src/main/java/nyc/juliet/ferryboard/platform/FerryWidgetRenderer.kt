package nyc.juliet.ferryboard.platform

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.net.Uri
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import nyc.juliet.ferryboard.MainActivity
import nyc.juliet.ferryboard.R
import nyc.juliet.ferryboard.core.WidgetDeparture
import nyc.juliet.ferryboard.core.WidgetOptions
import nyc.juliet.ferryboard.ui.theme.ColorMath
import nyc.juliet.ferryboard.ui.theme.FerryThemes
import nyc.juliet.ferryboard.ui.theme.TextScale
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class WidgetSize { SMALL, MEDIUM, LARGE }

/** Deterministic native render surface used by both hosted widgets and instrumentation. */
object FerryWidgetRenderer {
	fun render(context: Context, presentation: WidgetPresentation, options: WidgetOptions, size: WidgetSize, widgetId: Int = AppWidgetManager.INVALID_APPWIDGET_ID): RemoteViews {
		val large = size == WidgetSize.LARGE
		val views = RemoteViews(context.packageName, if (large) R.layout.widget_board_large else R.layout.widget_board)
		val palette = palette(context, options.theme)
		views.setColorStateList(R.id.widget_root, "setBackgroundTintList", ColorStateList.valueOf(palette.background))
		views.setTextViewText(R.id.widget_title, presentation.landingName)
		val locationLabel = presentation.locationLabel ?: if (options.automaticLanding) "Nearest landing" else "Fixed landing"
		views.setContentDescription(R.id.widget_title, "${presentation.landingName}, $locationLabel${if (presentation.saved) ", Saved schedule" else ""}")
		views.setInt(R.id.widget_title, "setMaxLines", if (large) 2 else 1)
		views.setViewVisibility(R.id.widget_refresh, if (size == WidgetSize.SMALL) View.GONE else View.VISIBLE)
		views.setViewVisibility(R.id.widget_settings, if (size == WidgetSize.SMALL) View.GONE else View.VISIBLE)
		views.setTextColor(R.id.widget_title, palette.foreground)
		views.setTextColor(R.id.widget_location, palette.secondary)
		views.setTextColor(R.id.widget_message, palette.foreground)
		views.setTextColor(R.id.widget_footer, palette.secondary)
		views.setImageViewResource(R.id.widget_location_icon, if (!options.automaticLanding) R.drawable.ic_anchor else if (presentation.locationLabel?.startsWith("Last location") == true || presentation.landingId == null) R.drawable.ic_location_off else R.drawable.ic_nearby)
		views.setInt(R.id.widget_location_icon, "setColorFilter", palette.accent)
		views.setInt(R.id.widget_refresh, "setColorFilter", palette.accent)
		views.setInt(R.id.widget_settings, "setColorFilter", palette.accent)
		views.setTextViewText(R.id.widget_location, locationLabel)
		views.setViewVisibility(R.id.widget_location, if (large) View.VISIBLE else View.GONE)
		val systemScale = context.resources.configuration.fontScale.coerceAtLeast(0.1f)
		// SP already applies device scaling. Only apply the shared preference's additional adjustment.
		val factor = TextScale.resolve(systemScale, options.textSize) / systemScale
		views.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, (if (large) 17f else 14f) * factor)
		views.setTextViewTextSize(R.id.widget_footer, TypedValue.COMPLEX_UNIT_SP, 10f * factor)
		val timePattern = if (options.twelveHour) "h:mm a" else "HH:mm"
		val stamp = DateTimeFormatter.ofPattern("MMM d · $timePattern", Locale.US).withZone(ZoneId.of("America/New_York"))
		val at = DateTimeFormatter.ofPattern(timePattern, Locale.US).withZone(ZoneId.of("America/New_York")).format(presentation.renderedAt)
		val footer = buildList {
			add(if (presentation.saved) "Saved schedule" else "Schedule snapshot")
			presentation.updatedAt?.let { add("Updated ${stamp.format(it)}") }
			if (presentation.rows.any { it.estimated }) add("Estimates as of ${stamp.format(presentation.estimatesAt ?: presentation.renderedAt)}")
		}.joinToString(" · ")
		views.setTextViewText(R.id.widget_footer, footer)
		if (!large) {
			// Keep absolute freshness dates visible even if Android leaves an old snapshot on the launcher.
			val largeText = TextScale.isAccessibilityText(TextScale.resolve(systemScale, options.textSize))
			val compactTime = if (largeText && options.twelveHour) "h:mma" else timePattern
			val shortStamp = DateTimeFormatter.ofPattern("M/d $compactTime", Locale.US).withZone(ZoneId.of("America/New_York"))
			fun compactStamp(instant: Instant) = shortStamp.format(instant).let { if (largeText) it.replace("AM", "a").replace("PM", "p") else it }
			val compactFooter = buildList {
				add(presentation.updatedAt?.let { "${if (presentation.saved) "Saved" else if (largeText) "Upd." else "Updated"} ${compactStamp(it)}" } ?: "Not updated")
				if (presentation.rows.any { it.estimated }) add("Est. ${compactStamp(presentation.estimatesAt ?: presentation.renderedAt)}")
			}.joinToString("\n")
			views.setTextViewText(R.id.widget_footer, compactFooter)
			views.setContentDescription(R.id.widget_footer, footer)
		}
		views.setTextViewText(R.id.widget_message, presentation.message ?: "No upcoming ferries in the schedule window.")
		views.setViewVisibility(R.id.widget_message, if (presentation.rows.isEmpty()) View.VISIBLE else View.GONE)
		val link = if (presentation.landingId != null) "ferryboard://landing/${presentation.landingId}" else "ferryboard://nearby"
		// Preview/instrumentation rendering cannot trigger production widget jobs or write choices.
		val open = if (widgetId > 0) PendingIntent.getActivity(context, widgetId, Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(link)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) else null
		if (open != null) {
			views.setOnClickPendingIntent(R.id.widget_root, open)
			val refresh = PendingIntent.getBroadcast(context, widgetId, Intent(context, FerryWidgetProvider::class.java).setAction(FerryWidgetProvider.ACTION_REFRESH).setData(Uri.parse("ferryboard://widget-refresh/$widgetId")), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
			views.setOnClickPendingIntent(R.id.widget_refresh, refresh)
			val edit = PendingIntent.getActivity(context, widgetId, Intent(context, FerryWidgetConfigurationActivity::class.java).setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).setData(Uri.parse("ferryboard://widget-settings/$widgetId")), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
			views.setOnClickPendingIntent(R.id.widget_settings, edit)
		}
		if (large) {
			views.setViewVisibility(R.id.widget_list, if (presentation.rows.isEmpty()) View.GONE else View.VISIBLE)
			if (open != null) views.setPendingIntentTemplate(R.id.widget_list, open)
			val items = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
			presentation.rows.take(12).forEach { row -> items.addItem(stableId(row.id), row(context, row, palette, options, factor, at, WidgetSize.LARGE).also { it.setOnClickFillInIntent(R.id.widget_row, Intent()) }) }
			views.setRemoteAdapter(R.id.widget_list, items.build())
		} else {
			views.setViewVisibility(R.id.widget_rows, if (presentation.rows.isEmpty()) View.GONE else View.VISIBLE)
			views.removeAllViews(R.id.widget_rows)
			val capacity = if (size == WidgetSize.SMALL || TextScale.resolve(systemScale, options.textSize) > 1.15f) 1 else 2
			presentation.rows.take(capacity).forEach { row -> views.addView(R.id.widget_rows, row(context, row, palette, options, factor, at, size)) }
		}
		return views
	}

	private fun row(context: Context, row: WidgetDeparture, palette: Palette, options: WidgetOptions, factor: Float, at: String, size: WidgetSize): RemoteViews {
		val compact = size == WidgetSize.SMALL
		val accessibility = compact && TextScale.isAccessibilityText(TextScale.resolve(context.resources.configuration.fontScale, options.textSize))
		val views = RemoteViews(context.packageName, when (size) {
			WidgetSize.SMALL -> R.layout.widget_departure_compact
			WidgetSize.MEDIUM -> R.layout.widget_departure_medium
			WidgetSize.LARGE -> R.layout.widget_departure
		})
		views.setTextViewText(R.id.widget_time, (if (row.estimated) "~" else "") + row.time)
		views.setTextViewText(R.id.widget_route, row.route)
		views.setTextViewText(R.id.widget_destination, row.destination)
		// Countdown is explicitly tied to this snapshot and never a ticking/live claim.
		views.setTextViewText(R.id.widget_countdown, "${row.countdown} at $at")
		views.setViewVisibility(R.id.widget_countdown, if (options.showCountdown && !accessibility) View.VISIBLE else View.GONE)
		views.setTextViewText(R.id.widget_detail, row.detail)
		// At large font sizes the smallest widget prioritizes clock, destination and freshness; the full row stays spoken.
		views.setViewVisibility(R.id.widget_detail, if (row.detail.isBlank() || accessibility) View.GONE else View.VISIBLE)
		if (accessibility) views.setInt(R.id.widget_destination, "setMaxLines", 1)
		views.setTextColor(R.id.widget_time, palette.foreground)
		views.setTextColor(R.id.widget_destination, palette.foreground)
		views.setTextColor(R.id.widget_route, palette.accent)
		views.setTextColor(R.id.widget_countdown, palette.secondary)
		views.setTextColor(R.id.widget_detail, palette.secondary)
		views.setTextViewTextSize(R.id.widget_time, TypedValue.COMPLEX_UNIT_SP, (if (compact) 12f else 14f) * factor)
		views.setTextViewTextSize(R.id.widget_destination, TypedValue.COMPLEX_UNIT_SP, (if (compact) 12f else 14f) * factor)
		views.setTextViewTextSize(R.id.widget_detail, TypedValue.COMPLEX_UNIT_SP, 10f * factor)
		views.setTextViewTextSize(R.id.widget_countdown, TypedValue.COMPLEX_UNIT_SP, 10f * factor)
		views.setContentDescription(R.id.widget_row, "${if (row.estimated) "Estimated " else "Scheduled "}${row.time}, ${row.route}, ${row.destination}, ${row.detail}${if (options.showCountdown) ", ${row.countdown} at $at" else ""}")
		return views
	}
	private fun stableId(value: String): Long = value.fold(1125899906842597L) { hash, char -> hash * 31 + char.code }
	private data class Palette(val background: Int, val foreground: Int, val secondary: Int, val accent: Int)
	private fun palette(context: Context, theme: String): Palette {
		val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
		val selected = if (theme == "system") if (night) "night" else "nyc-ferry" else theme
		val resolved = FerryThemes.resolve(selected)
		val colors = resolved.palette
		val background = ColorMath.blend(ColorMath.WHITE, colors.background, if (resolved.dark) 0.07 else 0.45)
		return Palette(background.toInt(), colors.ink.toInt(), colors.muted.toInt(), colors.accent.toInt())
	}
}
