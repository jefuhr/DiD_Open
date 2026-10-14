package nyc.juliet.ferryboard.ui.theme

import androidx.activity.compose.LocalActivity
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.LifecycleResumeEffect

/** Theme colors that Material's scheme has no slot for: statuses, headings and the harbor chart. */
@Immutable
data class FerryColors(
	val theme: FerryTheme,
	val accent: Color,
	val onAccent: Color,
	val background: Color,
	val card: Color,
	val sunken: Color,
	val ink: Color,
	val muted: Color,
	val line: Color,
	val heading: Color,
	val positive: Color,
	val warning: Color,
	val danger: Color,
) {
	val dark: Boolean get() = theme.dark

	companion object {
		fun of(theme: FerryTheme): FerryColors {
			val p = theme.palette
			return FerryColors(theme, Color(p.accent), Color(p.onAccent), Color(p.background), Color(p.card), Color(p.sunken), Color(p.ink),
				Color(p.muted), Color(p.line), Color(p.heading), Color(p.positive), Color(p.warning), Color(p.danger))
		}
	}
}

val LocalFerryColors = staticCompositionLocalOf { FerryColors.of(FerryThemes.default) }

/** Times line up down the board with tabular figures. */
object FerryText {
	val clock = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 20.sp, fontFeatureSettings = "tnum")
	val clockLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 18.sp, lineHeight = 22.sp, fontFeatureSettings = "tnum")
	val countdown = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp, fontFeatureSettings = "tnum")
	val pill = TextStyle(fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.2.sp)
	val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
	val captionStrong = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp)
	val overline = TextStyle(fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.6.sp)
}

private fun scheme(colors: FerryColors): ColorScheme {
	val p = colors.theme.palette
	fun mix(top: Long, bottom: Long, amount: Double) = Color(ColorMath.blend(top, bottom, amount))
	val selected = mix(p.accent, p.card, if (colors.dark) 0.28 else 0.16)
	val tertiaryContainer = mix(p.warning, p.card, 0.18)
	return if (colors.dark) darkColorScheme(
		primary = colors.accent, onPrimary = colors.onAccent, primaryContainer = selected, onPrimaryContainer = colors.ink,
		inversePrimary = colors.heading, secondary = colors.heading, onSecondary = Color(ColorMath.readableOn(p.heading)),
		secondaryContainer = selected, onSecondaryContainer = colors.ink, tertiary = colors.warning, onTertiary = Color(ColorMath.readableOn(p.warning)),
		tertiaryContainer = tertiaryContainer, onTertiaryContainer = colors.ink, background = colors.background, onBackground = colors.ink,
		surface = colors.background, onSurface = colors.ink, surfaceVariant = colors.sunken, onSurfaceVariant = colors.muted,
		surfaceTint = colors.accent, inverseSurface = colors.ink, inverseOnSurface = colors.background, error = colors.danger,
		onError = Color(ColorMath.readableOn(p.danger)), errorContainer = mix(p.danger, p.card, 0.2), onErrorContainer = colors.ink,
		outline = colors.muted, outlineVariant = colors.line, scrim = Color.Black, surfaceBright = colors.sunken, surfaceDim = colors.background,
		surfaceContainerLowest = colors.background, surfaceContainerLow = colors.card, surfaceContainer = colors.card,
		surfaceContainerHigh = mix(p.sunken, p.card, 0.5), surfaceContainerHighest = colors.sunken,
	) else lightColorScheme(
		primary = colors.accent, onPrimary = colors.onAccent, primaryContainer = selected, onPrimaryContainer = colors.heading,
		inversePrimary = mix(p.accent, 0xFFFFFFFF, 0.6), secondary = colors.heading, onSecondary = Color(ColorMath.readableOn(p.heading)),
		secondaryContainer = selected, onSecondaryContainer = colors.heading, tertiary = colors.warning, onTertiary = Color(ColorMath.readableOn(p.warning)),
		tertiaryContainer = tertiaryContainer, onTertiaryContainer = colors.ink, background = colors.background, onBackground = colors.ink,
		surface = colors.background, onSurface = colors.ink, surfaceVariant = colors.sunken, onSurfaceVariant = colors.muted,
		surfaceTint = colors.accent, inverseSurface = colors.ink, inverseOnSurface = colors.card, error = colors.danger,
		onError = Color(ColorMath.readableOn(p.danger)), errorContainer = mix(p.danger, p.card, 0.14), onErrorContainer = colors.ink,
		outline = colors.muted, outlineVariant = colors.line, scrim = Color.Black, surfaceBright = colors.card, surfaceDim = colors.sunken,
		surfaceContainerLowest = colors.card, surfaceContainerLow = colors.card, surfaceContainer = mix(p.card, p.background, 0.5),
		surfaceContainerHigh = mix(p.sunken, p.card, 0.5), surfaceContainerHighest = colors.sunken,
	)
}

/**
 * Applies a Ferry Board theme and text size. The preference changes the font scale only when it differs from the
 * device's, so Android's non-linear scaling of very large text is kept whenever the device setting wins.
 */
@Composable
fun FerryTheme(themeId: String, textSize: String, content: @Composable () -> Unit) {
	val theme = FerryThemes.resolve(themeId)
	val colors = remember(theme) { FerryColors.of(theme) }
	val scheme = remember(colors) { scheme(colors) }
	val density = LocalDensity.current
	val resolved = TextScale.resolve(density.fontScale, textSize)
	val adjusted = if (resolved == density.fontScale) density else Density(density.density, resolved)
	SystemBarAppearance(dark = theme.dark)
	CompositionLocalProvider(LocalFerryColors provides colors, LocalDensity provides adjusted) {
		MaterialTheme(colorScheme = scheme, typography = Typography(), content = content)
	}
}

/** Status and navigation bar icons follow the theme rather than the device's light or dark setting. */
@Composable
private fun SystemBarAppearance(dark: Boolean) {
	val activity = LocalActivity.current ?: return
	val view = LocalView.current
	SideEffect {
		val controller = WindowCompat.getInsetsController(activity.window, view)
		controller.isAppearanceLightStatusBars = !dark
		controller.isAppearanceLightNavigationBars = !dark
	}
}

/**
 * Keeps the display on while Ferry Board is resumed and the preference is set. The activity also clears its flag on
 * pause, so the setting is restored from preferences on every resume and released on pause or disposal.
 */
@Composable
fun KeepScreenOn(enabled: Boolean) {
	val view = LocalView.current
	LifecycleResumeEffect(view, enabled) {
		view.keepScreenOn = enabled
		onPauseOrDispose { view.keepScreenOn = false }
	}
}

/** The current theme's colors, for statuses and headings that Material's scheme has no slot for. */
val ferryColors: FerryColors
	@Composable get() = LocalFerryColors.current
