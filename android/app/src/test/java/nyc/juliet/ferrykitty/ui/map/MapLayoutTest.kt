package nyc.juliet.ferrykitty.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Sizes are the map screen's own content area in dp, after the shell, system bars and padding. */
class MapLayoutTest {
	@Test fun portraitStacksTheListsBelowTheChart() {
		assertNull("Phone", MapLayout.sidePanelWidth(widthDp = 411f, heightDp = 690f))
		assertNull("Tablet workspace beside the landing sidebar", MapLayout.sidePanelWidth(widthDp = 765f, heightDp = 1630f))
		assertNull("Foldable beside a rail", MapLayout.sidePanelWidth(widthDp = 620f, heightDp = 876f))
		assertNull("Square space is not landscape", MapLayout.sidePanelWidth(widthDp = 1000f, heightDp = 1000f))
	}

	@Test fun landscapeKeepsTheListsBesideOnlyWhileTheChartKeeps480Dp() {
		assertEquals("Tablet landscape workspace", 360f, MapLayout.sidePanelWidth(widthDp = 979f, heightDp = 728f))
		assertEquals("Wide panel leaving exactly 480 dp", 360f, MapLayout.sidePanelWidth(widthDp = 841f, heightDp = 600f))
		assertEquals("Narrower panel when the wide one would squeeze the chart", 300f, MapLayout.sidePanelWidth(widthDp = 840f, heightDp = 600f))
		assertEquals("Narrow panel leaving exactly 480 dp", 300f, MapLayout.sidePanelWidth(widthDp = 781f, heightDp = 600f))
		assertNull("Either panel would leave less than 480 dp", MapLayout.sidePanelWidth(widthDp = 780f, heightDp = 600f))
		assertNull("Small landscape workspace", MapLayout.sidePanelWidth(widthDp = 600f, heightDp = 576f))
	}

	@Test fun shortLandscapeKeepsTheCollapsibleListsBelow() {
		assertNull("Phone landscape beside a rail", MapLayout.sidePanelWidth(widthDp = 790f, heightDp = 387f))
		assertNull(MapLayout.sidePanelWidth(widthDp = 1200f, heightDp = 479f))
		assertEquals(360f, MapLayout.sidePanelWidth(widthDp = 1200f, heightDp = 480f))
	}

	@Test fun theThresholdHoldsInWholePixelsAsLaidOut() {
		// At 2.625x, 781 dp is 2050 px; the panel rounds to 788 px and the divider to 3 px, leaving 479.6 dp.
		assertNull(MapLayout.sidePanelWidth(widthDp = 781f, heightDp = 600f, density = 2.625f))
		assertEquals(300f, MapLayout.sidePanelWidth(widthDp = 782f, heightDp = 600f, density = 2.625f))
	}

	@Test fun aChartBesideTheListsIsAlwaysLandscapeSpaceAndAtLeast480DpWide() {
		for (density in listOf(1f, 1.5f, 2f, 2.625f, 3.5f)) for (width in 200..2400 step 3) for (height in listOf(320, 479, 480, 600, 728, 900, 1200, 1700)) {
			val panel = MapLayout.sidePanelWidth(width.toFloat(), height.toFloat(), density) ?: continue
			assertTrue("$width x $height is not landscape", width > height)
			// As a Row lays it out: whole-pixel panel and divider, and the chart keeps the remaining pixels.
			val chartPx = Math.round(width * density) - Math.round(panel * density) - Math.round(MapLayout.DIVIDER_DP * density)
			assertTrue("$width x $height at $density leaves ${chartPx / density} dp", chartPx / density >= MapLayout.MIN_CHART_BESIDE_DP)
		}
	}
}
