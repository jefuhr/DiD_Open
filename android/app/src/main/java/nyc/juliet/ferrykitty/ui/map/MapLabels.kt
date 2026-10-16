package nyc.juliet.ferrykitty.ui.map

/**
 * Greedy, collision-free label placement in screen pixels, reused frame to frame without allocating. Labels placed
 * earlier win, every label stays inside the viewport and a named label (a street) is drawn once. Areas kept clear for
 * the map's own controls refuse every label.
 */
class LabelPlacer {
	private var boxes = FloatArray(256)
	private var count = 0
	private var clear = FloatArray(16)
	private var clearCount = 0
	private val names = HashSet<String>()
	private var width = 0f
	private var height = 0f

	val placed: Int get() = count

	fun reset(width: Float, height: Float) {
		this.width = width
		this.height = height
		count = 0
		clearCount = 0
		names.clear()
	}

	/** Keeps every later label out of an area the map's controls cover, until the next [reset]. */
	fun keepClear(left: Float, top: Float, right: Float, bottom: Float) {
		if (clearCount * 4 + 4 > clear.size) clear = clear.copyOf(clear.size * 2)
		clear[clearCount * 4] = left
		clear[clearCount * 4 + 1] = top
		clear[clearCount * 4 + 2] = right
		clear[clearCount * 4 + 3] = bottom
		clearCount++
		reserve(left, top, right, bottom)
	}

	/** True when the box overlaps an area kept clear for the map's controls; other labels do not count. */
	fun obstructed(left: Float, top: Float, right: Float, bottom: Float): Boolean {
		for (index in 0 until clearCount) {
			val offset = index * 4
			if (left < clear[offset + 2] && right > clear[offset] && top < clear[offset + 3] && bottom > clear[offset + 1]) return true
		}
		return false
	}

	/**
	 * The side for a name beside its marker at ([x], [y]): the right unless it would run past the viewport's right edge,
	 * as [MapLabels.flipsLeft], but the other side when only that one is clear of the controls and inside the viewport.
	 */
	fun flipsLeft(x: Float, y: Float, gap: Float, labelWidth: Float, labelHeight: Float): Boolean {
		val usual = MapLabels.flipsLeft(x, gap, labelWidth, width)
		val top = y - labelHeight / 2f
		val bottom = y + labelHeight / 2f
		val right = x + gap
		val left = x - gap - labelWidth
		val usualStart = if (usual) left else right
		val otherStart = if (usual) right else left
		val switch = obstructed(usualStart, top, usualStart + labelWidth, bottom) &&
			!obstructed(otherStart, top, otherStart + labelWidth, bottom) && otherStart >= 0f && otherStart + labelWidth <= width
		return if (switch) !usual else usual
	}

	/** Claims space without testing it, for labels that always show, such as the selected vessel's name. */
	fun reserve(left: Float, top: Float, right: Float, bottom: Float) {
		if (count * 4 + 4 > boxes.size) boxes = boxes.copyOf(boxes.size * 2)
		boxes[count * 4] = left
		boxes[count * 4 + 1] = top
		boxes[count * 4 + 2] = right
		boxes[count * 4 + 3] = bottom
		count++
	}

	/** Places a label fully inside the viewport and clear of every earlier label; a [name] already used is refused. */
	fun place(left: Float, top: Float, right: Float, bottom: Float, name: String? = null): Boolean {
		if (left < 0f || top < 0f || right > width || bottom > height) return false
		if (name != null && name in names) return false
		if (collides(left, top, right, bottom)) return false
		reserve(left, top, right, bottom)
		if (name != null) names += name
		return true
	}

	fun collides(left: Float, top: Float, right: Float, bottom: Float): Boolean {
		for (index in 0 until count) {
			val offset = index * 4
			if (left < boxes[offset + 2] && right > boxes[offset] && top < boxes[offset + 3] && bottom > boxes[offset + 1]) return true
		}
		return false
	}
}

/** Which labels the chart shows, ported from the web map's label rules. */
object MapLabels {
	private val major = Regex("Wall|34th|Rockaway|St\\.? George|Bay Ridge|Astoria|90th", RegexOption.IGNORE_CASE)
	private val buoyPrefix = Regex("^.*\\bBuoy\\s+")

	/** Major landings are named at every zoom; the rest wait for close zoom. */
	fun isMajorLanding(name: String): Boolean = major.containsMatchIn(name)

	/** Priority streets and highways are labeled at every zoom; side streets only up close. */
	fun showsStreet(priority: Boolean, highway: Boolean, close: Boolean): Boolean = close || priority || highway

	/** A landing name flips to the left of its marker when it would run past the right edge. */
	fun flipsLeft(x: Float, gap: Float, labelWidth: Float, viewportWidth: Float): Boolean = x + gap + labelWidth > viewportWidth

	/** Lights show their first word ("Robbins"); buoys their number ("Ambrose Buoy 1" is "1"). */
	fun seamarkLabel(name: String, kind: SeamarkKind): String = when (kind) {
		SeamarkKind.LIGHT -> name.trim().substringBefore(' ')
		else -> name.replace(buoyPrefix, "").trim().ifEmpty { name.trim() }
	}

	/** A slightly generous width for collision tests before a label's text is measured. */
	fun estimateWidth(text: String, fontPx: Float): Float = text.length * fontPx * 0.62f + fontPx * 0.5f
}
