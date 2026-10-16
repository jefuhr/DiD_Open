package nyc.juliet.ferrykitty.platform

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import nyc.juliet.ferrykitty.contract.*
import nyc.juliet.ferrykitty.core.*

/** Failure modes: unknown preference enums, cross-widget writes, revoked grants and untrusted links. */
class PlatformPoliciesTest {
	@Test fun existingWidgetStorageRetainsDefaultsOverridesLocationAndExpiry() {
		val storage = MemoryFerrySettings()
		storage.write("widget-defaults", """{"automaticLanding":false,"landingID":16,"theme":"hello-kitty","twelveHour":true}""")
		storage.write("widget-10", """{"useAppDefaults":false,"options":{"automaticLanding":false,"landingID":26,"hiddenRoutes":["ER"],"showCountdown":false}}""")
		storage.write("widget-last-landing", """{"id":16,"name":"Pier 11","atEpochMillis":1788526200000}""")
		storage.write("widget-expiry-10", "1788526500000")
		val widgets = WidgetSettingsStore(storage)
		assertEquals(16, widgets.defaults().landingId)
		assertEquals("hello-kitty", widgets.defaults().theme)
		assertTrue(widgets.defaults().twelveHour)
		assertEquals(26, widgets.options(10).landingId)
		assertEquals(setOf("ER"), widgets.options(10).hiddenRoutes)
		assertFalse(widgets.options(10).showCountdown)
		assertEquals(LastWidgetLanding(16, "Pier 11", 1788526200000), widgets.lastLanding())
		assertEquals(Instant.ofEpochMilli(1788526500000), WidgetExpiryStore(storage).read(10))
		widgets.save(10, widgets.read(10))
		assertEquals(26, WidgetSettingsStore(storage).options(10).landingId)
		assertNotNull(storage.read("widget-10"))
	}

	@Test fun resizingOrRemovingOtherWidgetCannotCancelAutomaticExpiry() {
		val storage = MemoryFerrySettings(); val policy = WidgetExpiryStore(storage)
		val first = Instant.parse("2026-09-04T12:55:00Z"); val second = first.plusSeconds(60)
		policy.record(10, first); policy.record(20, null)
		assertEquals(first, policy.next(intArrayOf(10, 20)))
		policy.record(20, second); assertEquals(first, policy.next(intArrayOf(10, 20)))
		WidgetSettingsStore(storage).remove(20)
		assertEquals(first, WidgetExpiryStore(storage).next(intArrayOf(10)))
		WidgetSettingsStore(storage).remove(10); assertNull(policy.next(intArrayOf()))
	}
	@Test fun canonicalWidgetLandingSurvivesNormalizationAndPersistence() {
		val storage = WidgetSettingsStore(MemoryFerrySettings())
		val option = WidgetOptions(automaticLanding = false, landingId = 26, landingName = "Wall Street")
		assertEquals(26, PreferenceCodec.normalize(option).landingId)
		assertEquals(26, PreferenceCodec.widget("""{"landingID":26,"landingId":16}""").landingId)
		storage.saveDefaults(option); assertEquals(26, storage.defaults().landingId)
		storage.save(5, WidgetSettings(false, option)); assertEquals(26, storage.read(5).options.landingId)
	}
	@Test fun unknownEnumsPreserveIndependentFavoritesAndSettings() {
		val prefs = PreferenceCodec.decode("""{"favorites":[16,26],"hiddenOperators":["NY Waterway"],"hiddenNYCMovements":["crewShuttle","future"],"lastTab":"FUTURE","textSize":"future","launchLanding":"future","twelveHour":true,"theme":"hello-kitty","departuresPerRoute":99}""")
		assertEquals(setOf(16, 26), prefs.favorites)
		assertEquals(setOf("NY Waterway"), prefs.hiddenOperators)
		assertEquals(setOf(NYCFerryMovement.CREW_SHUTTLE), prefs.hiddenNYCMovements)
		assertEquals(FerryTab.DEPARTURES, prefs.lastTab)
		assertEquals("system", prefs.textSize); assertEquals("lastUsed", prefs.launchLanding)
		assertTrue(prefs.twelveHour); assertEquals("hello-kitty", prefs.theme)
		assertEquals(0, prefs.departuresPerRoute)
	}

	@Test fun malformedFieldDoesNotDiscardOtherPreferences() {
		val prefs = PreferenceCodec.decode("""{"favorites":[16],"twelveHour":"broken","keepScreenAwake":true,"hiddenRoutes":["ER"],"departureWindowMinutes":60}""")
		assertEquals(setOf(16), prefs.favorites); assertTrue(prefs.keepScreenAwake)
		assertFalse(prefs.twelveHour); assertEquals(setOf("ER"), prefs.hiddenRoutes)
		assertEquals(60, prefs.departureWindowMinutes)
	}

	@Test fun widgetInstancesAreIndependentAndCopyIsASnapshot() {
		val settings = MemoryFerrySettings(); val widgets = WidgetSettingsStore(settings)
		val defaults = WidgetOptions().copy(twelveHour = true)
		widgets.saveDefaults(defaults)
		widgets.save(10, WidgetSettings(false, WidgetOptions().copy(automaticLanding = false, landingId = 16)))
		widgets.save(20, WidgetSettings(false, WidgetOptions().copy(automaticLanding = false, landingId = 26)))
		widgets.saveDefaults(defaults.copy(twelveHour = false))
		assertEquals(16, widgets.options(10).landingId); assertEquals(26, widgets.options(20).landingId)
		assertFalse(widgets.options(10).twelveHour)
		val copied = copyMainSettings(WidgetOptions(), AppPreferences(landingId = 26, twelveHour = true, hiddenRoutes = setOf("ER")), null)
		widgets.save(10, WidgetSettings(false, copied))
		widgets.saveDefaults(WidgetOptions())
		assertTrue(widgets.options(10).twelveHour); assertEquals(setOf("ER"), widgets.options(10).hiddenRoutes)
		assertEquals(26, widgets.options(20).landingId)
	}

	@Test fun fixedWidgetNeverNeedsLocationAndRevocationInvalidatesAutomaticSelection() {
		val now = Instant.parse("2026-09-04T12:50:00Z")
		val last = LastWidgetLanding(16, "Wall Street", now.toEpochMilli())
		assertEquals(WidgetLocationDecision.Fixed(26), widgetLocationDecision(WidgetOptions().copy(automaticLanding = false, landingId = 26), false, last, now))
		assertEquals(WidgetLocationDecision.PermissionRequired, widgetLocationDecision(WidgetOptions(), false, last, now))
		assertEquals(WidgetLocationDecision.LastLocation(last), widgetLocationDecision(WidgetOptions(), true, last, now.plusSeconds(21_600)))
		assertEquals(WidgetLocationDecision.Unavailable, widgetLocationDecision(WidgetOptions(), true, last, now.plusSeconds(21_601)))
		assertEquals(WidgetLocationDecision.Unavailable, widgetLocationDecision(WidgetOptions(), true, last, now.minusSeconds(1)))
	}

	@Test fun linksRejectAmbiguousOrMalformedPaths() {
		assertEquals(FerryWidgetLink.Nearby, FerryLinks.parse("ferryboard://nearby"))
		assertEquals(FerryWidgetLink.Landing(26), FerryLinks.parse("ferryboard://landing/26"))
		listOf("https://landing/26", "ferryboard://landing/-1", "ferryboard://landing/26/extra", "ferryboard://landing/26?x=1", "ferryboard://nearby/extra", "ferryboard://person@landing/26", "ferryboard://landing:88/26", "ferryboard://landing/%32%36").forEach { assertNull(it, FerryLinks.parse(it)) }
	}

	@Test fun testLaunchRequiresDebugAndExplicitFlagAndNeverResetsOnRotation() {
		assertFalse(TestLaunchPolicy.resolve(false, true, true, true, false).fixtures)
		assertFalse(TestLaunchPolicy.resolve(true, false, true, true, false).reset)
		assertTrue(TestLaunchPolicy.resolve(true, true, true, false, false).reset)
		assertFalse(TestLaunchPolicy.resolve(true, true, true, false, true).reset)
	}
}
