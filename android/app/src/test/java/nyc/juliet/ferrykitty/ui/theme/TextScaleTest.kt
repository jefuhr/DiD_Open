package nyc.juliet.ferrykitty.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TextScaleTest {
	@Test fun systemFollowsTheDevice() {
		for (scale in listOf(0.85f, 1f, 1.15f, 1.3f, 2f)) assertEquals(scale, TextScale.resolve(scale, "system"), 0f)
	}

	@Test fun compactNeverDefeatsALargerSystemFont() {
		assertEquals(0.9f, TextScale.resolve(1f, "compact"), 0f)
		assertEquals("An already small device font stays as chosen", 0.85f, TextScale.resolve(0.85f, "compact"), 0f)
		for (scale in listOf(1.1f, 1.15f, 1.3f, 1.5f, 1.8f, 2f)) assertEquals(scale, TextScale.resolve(scale, "compact"), 0f)
	}

	@Test fun largerRaisesOnlyUpToItsFloor() {
		assertEquals(1.2f, TextScale.resolve(1f, "larger"), 0f)
		assertEquals(1.2f, TextScale.resolve(0.85f, "larger"), 0f)
		assertEquals(1.3f, TextScale.resolve(1.3f, "larger"), 0f)
		assertEquals(2f, TextScale.resolve(2f, "larger"), 0f)
	}

	@Test fun unknownFutureValuesFallBackToSystem() {
		assertEquals(1.15f, TextScale.resolve(1.15f, "future-option"), 0f)
	}

	@Test fun accessibilityLayoutsStartAtLargeScales() {
		assertFalse(TextScale.isAccessibilityText(1.3f))
		assertTrue(TextScale.isAccessibilityText(1.5f))
		assertTrue(TextScale.isAccessibilityText(2f))
	}

	@Test fun everyIosThemeHasAPaletteAndTheDefaultIsFirst() {
		assertEquals(listOf("nyc-ferry", "night", "hello-kitty", "cinnamoroll", "pompompurin", "kuromi", "windows-xp", "hacker", "burger-king"),
			FerryThemes.all.map { it.id })
		assertEquals("nyc-ferry", FerryThemes.resolve("future-theme").id)
		assertEquals("night", FerryThemes.resolve("night").id)
		assertTrue(FerryThemes.resolve("night").dark)
		assertTrue(FerryThemes.resolve("kuromi").dark)
		assertTrue(FerryThemes.resolve("hacker").dark)
		assertFalse(FerryThemes.resolve("burger-king").dark)
	}

	@Test fun themeTextKeepsReadableContrast() {
		for (theme in FerryThemes.all) {
			val palette = theme.palette
			assertTrue("${theme.id} ink", contrast(palette.ink, palette.background) >= 7.0)
			assertTrue("${theme.id} muted", contrast(palette.muted, palette.card) >= 4.5)
			assertTrue("${theme.id} accent", contrast(palette.accent, palette.background) >= 4.5)
			assertTrue("${theme.id} on accent", contrast(palette.onAccent, palette.accent) >= 4.5)
			assertTrue("${theme.id} warning", contrast(palette.warning, palette.card) >= 4.5)
			assertTrue("${theme.id} positive", contrast(palette.positive, palette.card) >= 4.5)
			assertTrue("${theme.id} danger", contrast(palette.danger, palette.card) >= 4.5)
		}
	}

	private fun contrast(a: Long, b: Long): Double {
		val l1 = ColorMath.luminance(a)
		val l2 = ColorMath.luminance(b)
		return (maxOf(l1, l2) + 0.05) / (minOf(l1, l2) + 0.05)
	}
}
