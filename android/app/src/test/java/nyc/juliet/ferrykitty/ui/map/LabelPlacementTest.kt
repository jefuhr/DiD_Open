package nyc.juliet.ferrykitty.ui.map

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import nyc.juliet.ferrykitty.core.Boat
import nyc.juliet.ferrykitty.core.Landing
import nyc.juliet.ferrykitty.ui.theme.FerryColors
import nyc.juliet.ferrykitty.ui.theme.FerryThemes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The chart's own label placement, with fixed text sizes: names stay clear of the map's controls and footer. */
class LabelPlacementTest {
	private val density = Density(2.625f)
	private val viewport = ViewportSize(1080f, 700f)
	private val colors = MapColors.of(FerryColors.of(FerryThemes.default))
	private val chart = ChartGeometry(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyMap(), ChartGeometry.DEFAULT_BOUNDS)
	private val fit = CameraPosition.fit(ChartGeometry.DEFAULT_BOUNDS, viewport, paddingPx = 63f)

	/** A monospaced stand-in for measured text: 22 px a character, 32 px tall. */
	private val metrics = object : LabelMetrics {
		override fun size(style: LabelStyle, text: String) = IntSize(text.length * 22, 32)
		override fun width(style: LabelStyle, text: String, fontPx: Float) = text.length * 22f
	}

	// The zoom and fit buttons at the top right; the scale bar and attribution along the bottom.
	private val controls = Rect(900f, 20f, 1060f, 150f)
	private val footer = listOf(Rect(26f, 600f, 320f, 680f), Rect(560f, 620f, 1064f, 690f))

	private val landings = listOf(
		Landing(16, "Pier 11", "Pier 11 / Wall St", 40.703161, -74.006144),
		Landing(26, "Pier 79", "Midtown West / Pier 79", 40.760323, -74.004075),
		Landing(8, "East 34th Street", "East 34th Street", 40.7443, -73.9715),
		Landing(2, "Astoria", "Astoria / 30th Av", 40.7725, -73.9358),
		Landing(9, "East 90th St", "East 90th St / Gracie Mansion", 40.7775, -73.9437),
		Landing(22, "St George", "St George / Staten Island", 40.6437, -74.0736),
		Landing(4, "Bay Ridge", "Bay Ridge / Veterans Memorial Pier", 40.6417, -74.0298),
		Landing(18, "Rockaway", "Rockaway / Beach 108th St", 40.5822, -73.8357),
		Landing(7, "DUMBO", "DUMBO / Fulton Ferry", 40.7034, -73.9945),
		Landing(20, "Soundview", "Soundview / Clason Point", 40.8047, -73.8558),
		Landing(10, "Ferry Point Park", "Ferry Point Park / Throggs Neck", 40.7999, -73.8287),
	)

	private fun landingMarks(chosen: Int? = null) = landings.map { landing ->
		val point = checkNotNull(HarborFeatures.landingPoint(landing))
		LandingMark(landing, point.x, point.y, MapLabels.isMajorLanding(landing.displayName), board = landing.id == 16, target = false,
			chosen = landing.id == chosen)
	}

	private fun vessel(id: String, name: String, x: Float, y: Float, selected: Boolean) =
		VesselMark(Boat(id, name, latitude = HarborProjection.latitude(y), longitude = HarborProjection.longitude(x)), x, y, Color.Blue, Color.White, "H1",
			stale = false, selected = selected)

	private fun place(camera: CameraPosition, scene: MapScene, keepClear: List<Rect>, close: Boolean = false): MapPainter {
		val painter = MapPainter()
		with(density) { placeLabels(scene, Screen(camera, viewport.width, viewport.height), close, metrics, painter, chart, keepClear) }
		return painter
	}

	/** A camera that shows the unit point ([x], [y]) at screen point ([screenX], [screenY]). */
	private fun cameraShowing(x: Float, y: Float, screenX: Float, screenY: Float, zoom: Float) =
		CameraPosition(x - (screenX - viewport.width / 2f) / zoom, y - (screenY - viewport.height / 2f) / zoom, zoom)

	private fun Rect.overlaps(left: Float, top: Float, right: Float, bottom: Float) = left < this.right && right > this.left && top < this.bottom && bottom > this.top

	@Test fun aPlaceNameUnderTheControlsIsLeftOutRatherThanClipped() {
		val bronx = ChartGeometry.PLACES.indexOfFirst { it.name == "THE BRONX" }
		val place = ChartGeometry.PLACES[bronx]
		val camera = cameraShowing(place.x, place.y, controls.center.x, controls.center.y, fit.zoom * 2f)
		val scene = MapScene(ChartLoad.Unavailable, colors)
		assertTrue("Without controls the name fits there", place(camera, scene, keepClear = emptyList()).places[bronx])
		assertFalse("Under the controls it is not drawn at all", place(camera, scene, keepClear = listOf(controls)).places[bronx])
	}

	@Test fun noPlacedNameEverLandsOnTheControlsOrFooter() {
		val keepClear = listOf(controls) + footer
		val scene = MapScene(ChartLoad.Unavailable, colors, landings = landingMarks())
		val harbor = ChartGeometry.DEFAULT_BOUNDS
		val gap = with(density) { 9f * this.density }
		var checked = 0
		for (factor in listOf(0.75f, 1f, 1.6f, 2.2f, 4f, 8f)) for (column in 0..6) for (row in 0..6) {
			val camera = CameraPosition(harbor.left + harbor.width * column / 6f, harbor.top + harbor.height * row / 6f, fit.zoom * factor)
			val screen = Screen(camera, viewport.width, viewport.height)
			val painter = place(camera, scene, keepClear, close = factor >= MapCamera.CLOSE_OF_FIT)
			for ((index, place) in ChartGeometry.PLACES.withIndex()) {
				if (!painter.places[index]) continue
				val size = metrics.size(LabelStyle.BOROUGH, place.name)
				val x = screen.x(place.x)
				val y = screen.y(place.y)
				for (area in keepClear) assertFalse("${place.name} at $camera", area.overlaps(x - size.width / 2f, y - size.height / 2f, x + size.width / 2f, y + size.height / 2f))
				checked++
			}
			for (slot in 0 until painter.landingCount) {
				val mark = scene.landings[painter.landings[slot]]
				val size = metrics.size(LabelStyle.LANDING, mark.landing.displayName)
				val x = screen.x(mark.x)
				val y = screen.y(mark.y)
				val start = if (painter.landingLeft[slot]) x - gap - size.width else x + gap
				for (area in keepClear) assertFalse("${mark.landing.displayName} at $camera", area.overlaps(start, y - size.height / 2f, start + size.width, y + size.height / 2f))
				checked++
			}
		}
		assertTrue("The sweep placed labels to check: $checked", checked > 200)
	}

	@Test fun anOpenLandingsNameStepsAsideFromTheControls() {
		val marks = landingMarks(chosen = 16)
		val pier11 = marks.first { it.landing.id == 16 }
		// The name would run right, under the buttons; the left side is clear.
		val camera = cameraShowing(pier11.x, pier11.y, 600f, controls.center.y, fit.zoom * 6f)
		val painter = place(camera, MapScene(ChartLoad.Unavailable, colors, landings = marks), keepClear = listOf(controls))
		val slot = (0 until painter.landingCount).first { marks[painter.landings[it]].landing.id == 16 }
		assertTrue(painter.landingLeft[slot])
		val open = place(camera, MapScene(ChartLoad.Unavailable, colors, landings = marks), keepClear = emptyList())
		assertFalse("Without controls it keeps the usual right side", open.landingLeft[(0 until open.landingCount).first { marks[open.landings[it]].landing.id == 16 }])
	}

	@Test fun theSelectedVesselsNameStepsAsideFromTheControls() {
		val center = ChartGeometry.DEFAULT_BOUNDS
		val boat = vessel("opportunity", "Opportunity", center.centerX, center.centerY, selected = true)
		val camera = cameraShowing(boat.x, boat.y, 700f, controls.center.y, fit.zoom * 6f)
		val scene = MapScene(ChartLoad.Unavailable, colors, vessels = listOf(vessel("other", "Other", center.left, center.top, selected = false), boat))
		assertEquals(true, place(camera, scene, keepClear = listOf(controls)).vesselSide(1))
		assertEquals("Without controls it keeps the usual right side", false, place(camera, scene, keepClear = emptyList()).vesselSide(1))
		assertNull("Only the selected vessel is named", place(camera, scene, keepClear = emptyList()).vesselSide(0))
	}

	@Test fun aNameWithControlsOnBothSidesIsLeftOutWhileItsMarkerStays() {
		val center = ChartGeometry.DEFAULT_BOUNDS
		val boat = vessel("opportunity", "Opportunity", center.centerX, center.centerY, selected = true)
		// Between the scale bar and the attribution, with no room on either side.
		val camera = cameraShowing(boat.x, boat.y, 440f, 650f, fit.zoom * 6f)
		val scene = MapScene(ChartLoad.Unavailable, colors, vessels = listOf(boat))
		val covered = place(camera, scene, keepClear = footer)
		assertNull(covered.vesselSide(0))
		assertTrue("The marker still claims its space", covered.placer.collides(430f, 640f, 450f, 660f))
		assertEquals(false, place(camera, scene, keepClear = emptyList()).vesselSide(0))
	}
}
