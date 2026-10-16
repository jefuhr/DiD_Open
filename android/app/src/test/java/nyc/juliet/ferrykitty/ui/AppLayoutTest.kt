package nyc.juliet.ferrykitty.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AppLayoutTest {
	@Test fun phonesUseBottomNavigation() {
		assertEquals(AppLayout.PHONE, AppLayout.of(widthDp = 360f, heightDp = 780f))
		assertEquals(AppLayout.PHONE, AppLayout.of(widthDp = 599f, heightDp = 900f))
	}

	@Test fun landscapePhonesAndMediumWindowsUseARail() {
		assertEquals("Phone landscape", AppLayout.RAIL, AppLayout.of(widthDp = 891f, heightDp = 411f))
		assertEquals("Foldable or small tablet", AppLayout.RAIL, AppLayout.of(widthDp = 700f, heightDp = 900f))
		assertEquals("Narrow landscape keeps the rail", AppLayout.RAIL, AppLayout.of(widthDp = 600f, heightDp = 360f))
	}

	@Test fun tabletsGetTheLandingSidebar() {
		assertEquals("The coordinator's 1600x2560 at 240 dpi tablet", AppLayout.WORKSPACE, AppLayout.of(widthDp = 1066f, heightDp = 1706f))
		assertEquals("Tablet landscape", AppLayout.WORKSPACE, AppLayout.of(widthDp = 1280f, heightDp = 800f))
		assertEquals(AppLayout.WORKSPACE, AppLayout.of(widthDp = 840f, heightDp = 480f))
	}
}
