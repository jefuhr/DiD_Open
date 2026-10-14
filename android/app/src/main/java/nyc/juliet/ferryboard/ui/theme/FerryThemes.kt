package nyc.juliet.ferryboard.ui.theme

import kotlin.math.pow

/** Colors are ARGB longs so the palettes stay plain data that widgets and JVM tests can share. */
data class FerryPalette(
	val accent: Long,
	val onAccent: Long,
	val background: Long,
	val card: Long,
	val sunken: Long,
	val ink: Long,
	val muted: Long,
	val line: Long,
	val heading: Long,
	val positive: Long,
	val warning: Long,
	val danger: Long,
)

/** The harbor chart's colors, ported from the web map's per-theme variables in public/assets/map.css. */
data class MapPalette(
	val water: Long,
	val land: Long,
	val landStroke: Long,
	val street: Long,
	val streetCasing: Long,
	val bridge: Long,
	val bridgeCasing: Long,
	val bridgeLabel: Long,
	val buoyGreen: Long,
	val buoyRed: Long,
	val light: Long,
	val channel: Long,
)

data class FerryTheme(
	val id: String,
	val name: String,
	val dark: Boolean,
	val palette: FerryPalette,
	val map: MapPalette,
)

/**
 * The nine iOS themes. Accent, background and dark/light come from ios/FerryBoard/Theme.swift; surfaces and text come
 * from the web board's palettes, adjusted where needed so text meets WCAG AA on every surface it is drawn on.
 */
object FerryThemes {
	private const val LIGHT_POSITIVE = 0xFF17693A
	private const val LIGHT_WARNING = 0xFF924B00
	private const val LIGHT_DANGER = 0xFFA8231C

	val all: List<FerryTheme> = listOf(
		theme("nyc-ferry", "NYC Ferry", false,
			accent = 0xFF0076A6, background = 0xFFF0F5F9, card = 0xFFFFFFFF, sunken = 0xFFE9F2F7, ink = 0xFF102F47, muted = 0xFF4F6A7B,
			line = 0xFFBFD8E4, heading = 0xFF001D41,
			map = MapPalette(water = 0xFFE3F0F7, land = 0xFFFFFFFF, landStroke = 0xFFBFD8E4, street = 0xFFCFE0EB, streetCasing = 0xFFEEF5F9,
				bridge = 0xFF004E72, bridgeCasing = 0xFFFFFFFF, bridgeLabel = 0xFF001D41, buoyGreen = 0xFF0FA958, buoyRed = 0xFFE03131,
				light = 0xFFF59F00, channel = 0x38004E72)),
		theme("night", "Night", true,
			accent = 0xFF7BCEFF, background = 0xFF0D1B26, card = 0xFF14242F, sunken = 0xFF1D3341, ink = 0xFFDBE7EF, muted = 0xFF8BA3B4,
			line = 0xFF2A4050, heading = 0xFF7FD4FF, positive = 0xFF5BD68A, warning = 0xFFF2B65C, danger = 0xFFFF7B7B,
			map = MapPalette(water = 0xFF0B1522, land = 0xFF152232, landStroke = 0xFF25394F, street = 0xFF283E57, streetCasing = 0xFF101C2B,
				bridge = 0xFF4DA3FF, bridgeCasing = 0xFF101C2B, bridgeLabel = 0xFF8EC3FF, buoyGreen = 0xFF00E676, buoyRed = 0xFFFF3366,
				light = 0xFFFFD54F, channel = 0x404DA3FF)),
		theme("hello-kitty", "Hello Kitty", false,
			accent = 0xFFB82068, background = 0xFFFFF0F5, card = 0xFFFFFFFF, sunken = 0xFFFFE3EC, ink = 0xFF3B2B33, muted = 0xFF755D67,
			line = 0xFFFFC9DB, heading = 0xFF8C1038,
			map = MapPalette(water = 0xFFEEF3FF, land = 0xFFFFF3F6, landStroke = 0xFFFFCCD8, street = 0xFFFDDDE5, streetCasing = 0xFFFFFFFF,
				bridge = 0xFFD6336C, bridgeCasing = 0xFFFFFFFF, bridgeLabel = 0xFFA61E4D, buoyGreen = 0xFF20C997, buoyRed = 0xFFFF6B8B,
				light = 0xFFFFD43B, channel = 0x38D6336C)),
		theme("cinnamoroll", "Cinnamoroll", false,
			accent = 0xFF146A91, background = 0xFFEDF9FF, card = 0xFFFFFFFF, sunken = 0xFFE3F2FD, ink = 0xFF2F4356, muted = 0xFF566B7F,
			line = 0xFFCFE8FA, heading = 0xFF2B5F8F,
			map = MapPalette(water = 0xFFE3F5FC, land = 0xFFFFFFFF, landStroke = 0xFFBDE4F7, street = 0xFFE0F2FB, streetCasing = 0xFFFFFFFF,
				bridge = 0xFF339AF0, bridgeCasing = 0xFFFFFFFF, bridgeLabel = 0xFF1C7ED6, buoyGreen = 0xFF38D9A9, buoyRed = 0xFFFF8787,
				light = 0xFFFFE066, channel = 0x40339AF0)),
		theme("pompompurin", "Pompompurin", false,
			accent = 0xFF795315, background = 0xFFFFF8DB, card = 0xFFFFFFFF, sunken = 0xFFFFF2CC, ink = 0xFF4A3517, muted = 0xFF705A3D,
			line = 0xFFF3D98A, heading = 0xFF7A4A12,
			map = MapPalette(water = 0xFFE2F6F8, land = 0xFFFFFBEE, landStroke = 0xFFFAE498, street = 0xFFFCF1CB, streetCasing = 0xFFFFFFFF,
				bridge = 0xFFB45309, bridgeCasing = 0xFFFFFFFF, bridgeLabel = 0xFF78350F, buoyGreen = 0xFF10B981, buoyRed = 0xFFEF4444,
				light = 0xFFF59E0B, channel = 0x40B45309)),
		theme("kuromi", "Kuromi", true,
			accent = 0xFFF2A5ED, background = 0xFF241332, card = 0xFF2E1B40, sunken = 0xFF3A2650, ink = 0xFFF3E8FA, muted = 0xFFBBA8CB,
			line = 0xFF4A3561, heading = 0xFFF2A5ED, positive = 0xFF6EE7B7, warning = 0xFFFFC56B, danger = 0xFFFF8A9A,
			map = MapPalette(water = 0xFF130F1C, land = 0xFF201A2D, landStroke = 0xFF45375E, street = 0xFF2F2543, streetCasing = 0xFF161122,
				bridge = 0xFFD946EF, bridgeCasing = 0xFF161122, bridgeLabel = 0xFFF0ABFC, buoyGreen = 0xFF2DD4BF, buoyRed = 0xFFF43F5E,
				light = 0xFFEC4899, channel = 0x40D946EF)),
		theme("windows-xp", "Windows XP", false,
			accent = 0xFF0058EE, background = 0xFFECE9D8, card = 0xFFFFFFFF, sunken = 0xFFD4D0C8, ink = 0xFF000000, muted = 0xFF4D4D4D,
			line = 0xFFACA899, heading = 0xFF0A246A,
			map = MapPalette(water = 0xFFBFE1F8, land = 0xFFF4F7EA, landStroke = 0xFF8FB678, street = 0xFFD6E2CB, streetCasing = 0xFFF8FAF2,
				bridge = 0xFF275294, bridgeCasing = 0xFFFFFFFF, bridgeLabel = 0xFF275294, buoyGreen = 0xFF2E7D32, buoyRed = 0xFFC62828,
				light = 0xFFFFB300, channel = 0x40275294)),
		theme("hacker", "Hacker", true,
			accent = 0xFF5AF078, background = 0xFF000000, card = 0xFF050D05, sunken = 0xFF0A2410, ink = 0xFF2BE82B, muted = 0xFF1F9C33,
			line = 0xFF0F3D0F, heading = 0xFF00FF41, positive = 0xFF5AF078, warning = 0xFFFFD54F, danger = 0xFFFF4D6D,
			map = MapPalette(water = 0xFF010A04, land = 0xFF041A09, landStroke = 0xFF00FF66, street = 0xFF0A3D16, streetCasing = 0xFF020B04,
				bridge = 0xFF00FF66, bridgeCasing = 0xFF000000, bridgeLabel = 0xFF00FF66, buoyGreen = 0xFF00FF66, buoyRed = 0xFFFF1144,
				light = 0xFF00FF66, channel = 0x4D00FF66)),
		theme("burger-king", "Burger King", false,
			accent = 0xFFB51D00, background = 0xFFFAEBD7, card = 0xFFFFFDF8, sunken = 0xFFF7E4CC, ink = 0xFF3B1B0F, muted = 0xFF77583F,
			line = 0xFFE7D3B8, heading = 0xFF502314, positive = 0xFF2B6E3F,
			map = MapPalette(water = 0xFFF3EDE2, land = 0xFFFFF8EE, landStroke = 0xFFE5D4BE, street = 0xFFECD7BF, streetCasing = 0xFFFFFFFF,
				bridge = 0xFF502314, bridgeCasing = 0xFFFFFFFF, bridgeLabel = 0xFF502314, buoyGreen = 0xFF2B6E3F, buoyRed = 0xFFD62300,
				light = 0xFFFCA311, channel = 0x40502314)),
	)

	val default: FerryTheme get() = all.first()

	/** Unknown or future theme names fall back to the default rather than failing. */
	fun resolve(id: String?): FerryTheme = all.firstOrNull { it.id == id } ?: default

	private fun theme(
		id: String, name: String, dark: Boolean, accent: Long, background: Long, card: Long, sunken: Long, ink: Long, muted: Long,
		line: Long, heading: Long, map: MapPalette, positive: Long = LIGHT_POSITIVE, warning: Long = LIGHT_WARNING, danger: Long = LIGHT_DANGER,
	) = FerryTheme(id, name, dark, FerryPalette(accent, ColorMath.readableOn(accent), background, card, sunken, ink, muted, line, heading,
		positive, warning, danger), map)
}

object ColorMath {
	const val WHITE = 0xFFFFFFFF
	const val NEAR_BLACK = 0xFF111418

	/** WCAG relative luminance of an ARGB color, ignoring alpha. */
	fun luminance(argb: Long): Double {
		fun channel(shift: Int): Double {
			val value = ((argb shr shift) and 0xFF) / 255.0
			return if (value <= 0.04045) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
		}
		return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
	}

	fun contrast(a: Long, b: Long): Double {
		val first = luminance(a)
		val second = luminance(b)
		return (maxOf(first, second) + 0.05) / (minOf(first, second) + 0.05)
	}

	/** White or near-black, whichever reads better on the color. */
	fun readableOn(argb: Long): Long = if (contrast(WHITE, argb) >= contrast(NEAR_BLACK, argb)) WHITE else NEAR_BLACK

	/** Parses #RRGGBB or RRGGBB route colors from the feed. */
	fun parseHex(hex: String?): Long? {
		val cleaned = hex?.trim()?.removePrefix("#") ?: return null
		if (cleaned.length != 6) return null
		return cleaned.toLongOrNull(16)?.let { 0xFF000000 or it }
	}

	/** Mixes [amount] of [top] over [bottom], both opaque. */
	fun blend(top: Long, bottom: Long, amount: Double): Long {
		fun channel(shift: Int): Long {
			val a = (top shr shift) and 0xFF
			val b = (bottom shr shift) and 0xFF
			return Math.round(a * amount + b * (1 - amount)).coerceIn(0, 255)
		}
		return 0xFF000000 or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
	}
}
