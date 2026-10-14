package nyc.juliet.ferryboard.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ChartParserTest {
	/** Unit tests run from the module directory; the bundled chart lives in the repository's content folder. */
	private fun bundledChart(): String {
		var directory: File? = File("").absoluteFile
		while (directory != null) {
			val candidate = File(directory, "content/harbor-chart.json")
			if (candidate.isFile) return candidate.readText()
			directory = directory.parentFile
		}
		error("content/harbor-chart.json not found above ${File("").absolutePath}")
	}

	@Test fun bundledChartParsesEveryLayer() {
		val chart = ChartParser.parse(bundledChart())
		assertEquals(160, chart.land.size)
		assertTrue("Holes stay with their polygon", chart.land.first().rings.size > 1)
		assertEquals(1, chart.parks.size)
		assertEquals(5, chart.channels.size)
		assertEquals(787, chart.streets.size)
		assertEquals(652, chart.streets.count { it.priority })
		assertEquals(24, chart.bridges.size)
		assertEquals(31, chart.seamarks.size)
		assertEquals("brooklyn-bridge", chart.bridges.first().id)
		assertEquals(127.0, chart.bridges.first().clearanceFeet ?: 0.0, 0.0)
		assertTrue(chart.attribution.contains("OpenStreetMap"))
	}

	@Test fun bundledChartKeepsSeamarkColorsForTheApiCopy() {
		val chart = ChartParser.parse(bundledChart())
		val robbins = chart.seamarkStyles["robbins-reef-light"]
		assertNotNull(robbins)
		assertEquals(SeamarkKind.LIGHT, robbins?.kind)
		assertTrue(chart.seamarkStyles.values.any { it.kind == SeamarkKind.BUOY_GREEN })
		assertTrue(chart.seamarkStyles.values.any { it.kind == SeamarkKind.BUOY_RED })
	}

	@Test fun boundsCoverTheHarborInDrawingUnits() {
		val chart = ChartParser.parse(bundledChart())
		assertEquals(HarborProjection.x(-74.23), chart.bounds.left, 0.5f)
		assertEquals(HarborProjection.x(-73.7), chart.bounds.right, 0.5f)
		assertEquals(HarborProjection.y(40.92), chart.bounds.top, 0.5f)
		assertEquals(HarborProjection.y(40.501743), chart.bounds.bottom, 0.5f)
	}

	@Test fun streetLabelsSitUprightOnTheirMiddleSegment() {
		val chart = ChartParser.parse(bundledChart())
		for (street in chart.streets) {
			assertTrue(street.name, street.angle in -90f..90f)
			assertFalse(street.label.isBlank())
		}
		val canal = chart.streets.first { it.name == "Canal Street" }
		assertEquals("Canal St", canal.label)
		assertEquals("Priority labels stay level", 0f, canal.angle, 0f)
	}

	@Test fun malformedFeaturesAreSkippedRatherThanFailingTheChart() {
		val text = """
			{"landmass":[{"id":"ok","points":[[40.7,-74.0],[40.71,-74.0],[40.71,-73.99]],"holes":[[[1]]]},
				{"id":"short","points":[[40.7,-74.0],[40.71,-74.0]]},{"id":"junk","points":"nope"}],
			 "streets":[{"id":"s","name":"Main","type":"arterial","points":[[40.7,-74.0],["x",-74.0],[40.72,-74.01]]},{"name":"Lonely","points":[[40.7,-74.0]]}],
			 "bridges":[{"id":"b","name":"Bridge","points":[[40.7,-74.0],[40.71,-74.0]]},{"name":"No id"}],
			 "seamarks":[{"id":"m","name":"Mark","latitude":40.7,"longitude":-74.0,"type":"buoy","color":"red"},{"id":"bad"}]}
		""".trimIndent()
		val chart = ChartParser.parse(text)
		assertEquals(1, chart.land.size)
		assertEquals("A hole without three points is dropped", 1, chart.land.first().rings.size)
		assertEquals(1, chart.streets.size)
		assertEquals("Only valid points are kept", 4, chart.streets.first().points.size)
		assertEquals(1, chart.bridges.size)
		assertEquals(1, chart.seamarks.size)
		assertEquals(SeamarkKind.BUOY_RED, chart.seamarkStyles["m"]?.kind)
		assertTrue(chart.channels.isEmpty())
	}

	@Test fun emptyOrBrokenTextGivesAnEmptyChart() {
		assertTrue(ChartParser.parse("{}").isEmpty)
		assertTrue(ChartParser.parse("not json").isEmpty)
	}
}
