// The map page.
//
// Reads /api/map once for the harbor and /api/boats every fifteen seconds for what is on it. The
// picture is an SVG built by hand from GTFS shapes: there are no tiles and there is no map library,
// because this server's Content-Security-Policy is default-src 'self' and because the geography
// that matters here — where the routes run and where the docks are — is already in the feed.
//
// Everything is written through textContent and createElementNS rather than innerHTML, the same
// rule the stats page keeps. Most of what lands on this page is the operator's own static feed, but
// a vessel name can fall through to whatever string the realtime feed put in vehicle.label, and
// that is third-party text going straight onto a page.

const REFRESH_MS = 15_000;
const SVG = "http://www.w3.org/2000/svg";
const RADIANS = Math.PI / 180;
const METRES_PER_DEGREE = 111_320;
// The fitted map is drawn this many units across, whatever the harbor's real size, and everything on
// it — a dock, a boat, a name — is sized in those same units. On a phone the map is about this many
// CSS pixels wide, which is what makes a radius of 6 below read as "about six pixels" rather than as
// a fraction of a coordinate space nobody can picture.
const DRAWING_WIDTH = 340;
// Breathing room around the network, so a boat off the end of a route is not drawn on the frame.
const FIT_PADDING = 0.04;
const MAX_ZOOM = 16;
// Past this the dock names have room to be readable rather than a hedge over the water.
const LABEL_ZOOM = 2.2;
// A fix this old is drawn faded. The server has already dropped anything genuinely abandoned; this
// is about the difference between a boat reporting now and one that last reported four minutes ago.
const STALE_FIX_SECONDS = 180;

const number = new Intl.NumberFormat("en-US");
const timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

const chart = document.getElementById("chart");
const mapMessage = document.getElementById("mapMessage");
// The board's own freshness chip, saying the same three things it says: Live, Saved, or nothing to
// serve. Reused rather than reinvented so the two pages report the feed in one vocabulary.
const statusText = document.getElementById("mapStatusText");

let harbor = null;
let boats = [];
let selectedId = null;
let projection = null;
let base = null;
let view = null;
// The two layers that are redrawn, held rather than looked up: they are made here, so asking the
// document to find them again is a round trip to answer a question this file already knows.
let dockLayer = null;
let fleetLayer = null;
// Where each boat was the last time this page looked. The feed publishes speed but never a heading,
// so the only honest way to point a boat is to point it the way it has actually just travelled.
const previousFix = new Map();
const heading = new Map();
// A vessel named in the query string, which is how a departure on the board sends someone here:
// "map?boat=Tooth Ferry". Held until it is found, because the boat the board is predicting for a
// sailing an hour out may not be reporting yet — and dropped the moment somebody picks a different
// boat themselves, since following them around after that would be the page arguing with them.
let wanted = new URLSearchParams(location.search).get("boat") || null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

// ---------------------------------------------------------------- the drawing

// Equirectangular, with longitude squeezed by the latitude it is being drawn at. Over a harbour
// thirty kilometres across the error against a proper projection is under a boat length, and the
// alternative is shipping a projection library to draw nine ferry routes.
function makeProjection(bounds) {
  const midLatitude = (bounds.minLatitude + bounds.maxLatitude) / 2;
  const squeeze = Math.cos(midLatitude * RADIANS);
  const spanX = (bounds.maxLongitude - bounds.minLongitude) * squeeze;
  const spanY = bounds.maxLatitude - bounds.minLatitude;
  const scale = DRAWING_WIDTH / spanX;
  const padding = DRAWING_WIDTH * FIT_PADDING;
  return {
    width: DRAWING_WIDTH + padding * 2,
    height: spanY * scale + padding * 2,
    point(latitude, longitude) {
      return [
        (longitude - bounds.minLongitude) * squeeze * scale + padding,
        (bounds.maxLatitude - latitude) * scale + padding
      ];
    }
  };
}

function pathData(points) {
  return points
    .map((point, index) => {
      const [x, y] = projection.point(point[0], point[1]);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// A translate for the thing's place on the water and a nested scale for how big it should look at
// this zoom. Splitting them is what lets the position ease between refreshes while the zoom does
// not, and it means a view change only ever rewrites the inner half.
function marker(className, latitude, longitude) {
  const [x, y] = projection.point(latitude, longitude);
  const outer = svgNode("g", { class: className, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
  const inner = svgNode("g", { class: "scaler" });
  outer.append(inner);
  return { outer, inner };
}

function drawHarbor() {
  chart.textContent = "";
  projection = makeProjection(harbor.bounds);
  base = { x: 0, y: 0, width: projection.width, height: projection.height };
  view = { ...base };

  const title = svgNode("title", { id: "chartTitle" });
  title.textContent = "NYC Ferry routes, landings and the boats currently running them.";
  chart.append(title);

  const casings = svgNode("g", { class: "casings" });
  const lines = svgNode("g", { class: "lines" });
  for (const route of harbor.routes) {
    for (const points of route.paths) {
      const d = pathData(points);
      casings.append(svgNode("path", { class: "route-casing", d, "vector-effect": "non-scaling-stroke" }));
      lines.append(svgNode("path", { class: "route-line", d, stroke: route.color, "vector-effect": "non-scaling-stroke" }));
    }
  }
  chart.append(casings, lines);

  dockLayer = svgNode("g", { class: "docks" });
  fleetLayer = svgNode("g", { class: "fleet" });
  for (const landing of harbor.landings) {
    const { outer, inner } = marker("dock", landing.latitude, landing.longitude);
    outer.dataset.latitude = landing.latitude;
    outer.dataset.longitude = landing.longitude;
    inner.append(svgNode("circle", { class: "dock-mark", r: 4 }));
    const label = svgNode("text", { class: "dock-label", x: 7, y: 3.5 });
    label.textContent = landing.name;
    inner.append(label);
    dockLayer.append(outer);
  }
  chart.append(dockLayer, fleetLayer);

  legend();
  applyView();
}

function legend() {
  const host = document.getElementById("legend");
  host.textContent = "";
  for (const route of harbor.routes) {
    const key = element("span", "key");
    const swatch = element("span", "swatch");
    swatch.style.background = route.color;
    key.append(swatch, element("span", null, route.name));
    host.append(key);
  }
}

// The one place the boats are drawn. Rebuilt on every refresh rather than diffed: there are never
// more than about twenty of them, and a fleet that is rebuilt cannot drift out of step with a feed
// that has dropped one.
function drawFleet() {
  if (!fleetLayer) return;
  fleetLayer.textContent = "";
  for (const boat of boats) {
    const { outer, inner } = marker("boat", boat.latitude, boat.longitude);
    outer.dataset.boat = boat.id;
    if ((boat.ageSeconds ?? 0) > STALE_FIX_SECONDS) outer.classList.add("is-stale");

    if (boat.status !== "stopped") {
      inner.append(svgNode("circle", { class: "boat-wake", r: 6, fill: boat.color || "#8fd3f4" }));
    }
    if (boat.id === selectedId) inner.append(svgNode("circle", { class: "boat-halo", r: 11 }));
    inner.append(svgNode("circle", { class: "boat-hull", r: 6, fill: boat.color || "#715c66" }));

    const bearing = boat.bearing ?? heading.get(boat.id);
    if (bearing != null) {
      // A chevron on the bow, pointing the way the boat is going. Rotated inside the marker so it
      // turns with the heading and not with the map.
      inner.append(svgNode("path", { class: "boat-heading", d: "M0,-12 L3.6,-5.6 L-3.6,-5.6 Z", transform: `rotate(${bearing})` }));
    }
    if (boat.id === selectedId) {
      const label = svgNode("text", { class: "boat-label", x: 13, y: 4 });
      label.textContent = boat.name || boat.number || "Boat";
      inner.append(label);
    }
    fleetLayer.append(outer);
  }
  markTargetDock();
  applyView();
}

// The dock the selected boat is working towards, named on the map even when the rest are not.
//
// Matched by position rather than by name. The feed's stop names and the board's landing names are
// different spellings of the same piers — "Atlantic Ave/BBP Pier 6" against "Atlantic Avenue" — and
// no amount of string comparison makes those two the same word, whereas they are unmistakably the
// same hundred metres of waterfront.
function markTargetDock() {
  const target = boats.find((boat) => boat.id === selectedId)?.stop;
  for (const dock of chart.querySelectorAll(".dock")) {
    const distance = target?.latitude == null ? Infinity : metresBetween(target, {
      latitude: Number(dock.dataset.latitude),
      longitude: Number(dock.dataset.longitude)
    });
    dock.classList.toggle("is-target", distance < 300);
  }
}

function metresBetween(from, to) {
  const easting = (to.longitude - from.longitude) * Math.cos(from.latitude * RADIANS);
  const northing = to.latitude - from.latitude;
  return Math.hypot(easting, northing) * METRES_PER_DEGREE;
}

// ---------------------------------------------------------------- pan and zoom

function applyView() {
  chart.setAttribute("viewBox", `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.width.toFixed(1)} ${view.height.toFixed(1)}`);
  // Everything inside a marker is sized in fitted-view units, so it has to shrink by exactly as
  // much as the view has been magnified to keep its size on screen.
  const scale = (view.width / base.width).toFixed(3);
  for (const scaler of chart.querySelectorAll(".scaler")) scaler.setAttribute("transform", `scale(${scale})`);
  if (dockLayer) dockLayer.classList.toggle("is-close", base.width / view.width >= LABEL_ZOOM);
}

// The view never leaves the map. Zoom is clamped between the whole harbor and MAX_ZOOM of it, the
// aspect is held so a pinch cannot stretch anything, and both corners are pushed back inside — so
// zooming all the way out lands exactly on the fitted view rather than half off the side of it.
function setView(next) {
  const width = Math.min(base.width, Math.max(base.width / MAX_ZOOM, next.width));
  const height = width * (base.height / base.width);
  view = {
    x: Math.min(Math.max(next.x, 0), base.width - width),
    y: Math.min(Math.max(next.y, 0), base.height - height),
    width,
    height
  };
  applyView();
}

// Screen pixels to drawing units, through the SVG's own matrix so that preserveAspectRatio's
// letterboxing is accounted for rather than guessed at.
function toDrawing(clientX, clientY) {
  const matrix = chart.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function zoomBy(factor, clientX, clientY) {
  if (!view) return;
  const anchor = clientX == null ? null : toDrawing(clientX, clientY);
  const centre = anchor || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  setView({
    x: centre.x - (centre.x - view.x) * factor,
    y: centre.y - (centre.y - view.y) * factor,
    width: view.width * factor
  });
}

const pointers = new Map();
let grabbed = null;
let pinchDistance = 0;
// A tap on a boat picks it; a drag that happens to end on one does not. Anything past a few pixels
// was a gesture, not a choice.
let dragged = false;

function pinchSpan() {
  const [first, second] = [...pointers.values()];
  return {
    distance: Math.hypot(first.x - second.x, first.y - second.y),
    clientX: (first.x + second.x) / 2,
    clientY: (first.y + second.y) / 2
  };
}

chart.addEventListener("pointerdown", (event) => {
  if (!view) return;
  chart.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY });
  if (pointers.size === 1) {
    grabbed = toDrawing(event.clientX, event.clientY);
    dragged = false;
    chart.classList.add("is-dragging");
  } else if (pointers.size === 2) {
    grabbed = null;
    pinchDistance = pinchSpan().distance;
  }
});

chart.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId) || !view) return;
  // Measured from where the finger went down rather than from the last move, so a slow drag adds up
  // to a drag instead of arriving as a run of taps.
  const origin = pointers.get(event.pointerId);
  if (Math.hypot(event.clientX - origin.originX, event.clientY - origin.originY) > 4) dragged = true;
  pointers.set(event.pointerId, { ...origin, x: event.clientX, y: event.clientY });
  if (pointers.size === 1 && grabbed) {
    // The point the finger went down on stays under the finger: whatever the same screen position
    // maps to now is measured against it, and the view moves by the difference.
    const now = toDrawing(event.clientX, event.clientY);
    if (now) setView({ x: view.x - (now.x - grabbed.x), y: view.y - (now.y - grabbed.y), width: view.width });
  } else if (pointers.size === 2 && pinchDistance > 0) {
    const span = pinchSpan();
    if (span.distance > 0) {
      zoomBy(pinchDistance / span.distance, span.clientX, span.clientY);
      pinchDistance = span.distance;
    }
  }
});

for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  chart.addEventListener(name, (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) { grabbed = null; chart.classList.remove("is-dragging"); }
  });
}

// Only with a modifier — which is what a trackpad pinch sends anyway. A map that swallows the wheel
// is a map you cannot scroll past, and this one is most of the height of the screen.
chart.addEventListener("wheel", (event) => {
  if (!view || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  zoomBy(event.deltaY > 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
}, { passive: false });

chart.addEventListener("keydown", (event) => {
  if (!view) return;
  const step = view.width / 8;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[event.key]) {
    event.preventDefault();
    setView({ x: view.x + moves[event.key][0], y: view.y + moves[event.key][1], width: view.width });
  } else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1 / 1.4); }
  else if (event.key === "-") { event.preventDefault(); zoomBy(1.4); }
});

// A boat is a target on the map as well as a row in the list. The drag test is what keeps a pan
// that happens to finish over a boat from picking it.
chart.addEventListener("click", (event) => {
  if (dragged) return;
  const picked = event.target.closest?.(".boat");
  if (picked) select(picked.dataset.boat, { recentre: false });
});

document.getElementById("zoomIn").addEventListener("click", () => zoomBy(1 / 1.4));
document.getElementById("zoomOut").addEventListener("click", () => zoomBy(1.4));
document.getElementById("zoomFit").addEventListener("click", () => { if (base) setView({ ...base }); });

// ---------------------------------------------------------------- the list

function statusLine(boat) {
  const where = boat.stop?.name;
  if (!where) return boat.status === "stopped" ? "Alongside" : "Under way";
  if (boat.status === "stopped") return `Alongside at ${where}`;
  if (boat.status === "incoming") return `Arriving at ${where}`;
  return `Next stop ${where}`;
}

// A trip's headsign and its last stop's name are two spellings of the same pier — "Wall St./Pier 11"
// against "Wall St/Pier 11" — so a boat whose next stop is where it terminates would otherwise be
// told to go there twice, in two different hands.
function samePlace(left, right) {
  const flatten = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(left) && flatten(left) === flatten(right);
}

function ageLabel(seconds) {
  if (seconds == null) return "";
  if (seconds < 45) return "just now";
  return `${Math.round(seconds / 60)} min ago`;
}

// Go and find it, at a zoom close enough to see which pier it is off.
function recentreOn(boat) {
  if (!boat || !view) return;
  const [x, y] = projection.point(boat.latitude, boat.longitude);
  const width = Math.min(view.width, base.width / 5);
  setView({ x: x - width / 2, y: y - (width * (base.height / base.width)) / 2, width });
}

function select(id, { recentre = true } = {}) {
  // Somebody has made their own choice, so the boat the query string was still looking for stops
  // being looked for.
  wanted = null;
  selectedId = selectedId === id ? null : id;
  drawFleet();
  renderList();
  // Only when the choice was a boat rather than the same boat again, and only from the list: one
  // tapped on the map is already where the eye is, and moving it there would be rude.
  if (recentre) recentreOn(boats.find((item) => item.id === selectedId));
}

function renderList() {
  const list = document.getElementById("boats");
  list.textContent = "";
  document.getElementById("boatCount").textContent = boats.length
    ? `${number.format(boats.length)} ${boats.length === 1 ? "boat" : "boats"}`
    : "None out";

  if (!boats.length) {
    // The one place the page still spells out what it can and cannot see, because this is the only
    // state where the absence of boats could be mistaken for the map being broken.
    list.append(element("li", "empty", "No NYC Ferry vessel is reporting a position right now. Outside service hours that is what an empty harbor looks like — and the partner operators never report one."));
    return;
  }

  for (const boat of boats) {
    const item = element("li");
    const row = element("button", "boat-row");
    row.type = "button";
    row.setAttribute("aria-pressed", String(boat.id === selectedId));

    const chip = element("span", "route-chip", boat.route || "—");
    if (boat.color) {
      chip.style.background = boat.color;
      // Two of the nine routes are yellow, and white on Rockaway Rocket's orange is not far behind.
      chip.style.color = readableOn(boat.color);
    }

    const name = element("span", "boat-name", boat.name || boat.number || "Unnamed vessel");
    if (boat.number && boat.name && boat.number !== boat.name) name.append(element("span", "boat-number", boat.number));

    const doing = element("span", "boat-doing", boat.destination && !samePlace(boat.destination, boat.stop?.name)
      ? `${statusLine(boat)} · to ${boat.destination}`
      : statusLine(boat));

    const figures = element("span", "boat-figures");
    figures.append(
      element("b", null, boat.speedKnots == null ? "—" : `${boat.speedKnots.toFixed(1)} kn`),
      element("span", null, ageLabel(boat.ageSeconds))
    );

    row.append(chip, name, doing, figures);
    row.addEventListener("click", () => select(boat.id));
    item.append(row);
    list.append(item);
  }
}

// Relative luminance, so a chip's text is whichever of black or white can actually be read on the
// operator's own route colour.
function readableOn(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.45 ? "#3b2b33" : "#fff";
}

// ---------------------------------------------------------------- load

// The way a boat is pointing, from where it was last time. The feed leaves bearing unset, and a
// heading measured off two real fixes is the difference between a fleet of dots and a fleet of
// boats — but only when it has actually gone somewhere: a boat rocking against a pier would
// otherwise spin on the spot.
function updateHeadings(next) {
  for (const boat of next) {
    const before = previousFix.get(boat.id);
    // The reference fix is only replaced once the boat has actually left it, so a boat moving
    // slowly still earns a heading eventually instead of never clearing the threshold.
    if (!before || metresBetween(before, boat) > 25) {
      if (before) {
        const easting = (boat.longitude - before.longitude) * Math.cos(boat.latitude * RADIANS);
        heading.set(boat.id, (Math.atan2(easting, boat.latitude - before.latitude) / RADIANS + 360) % 360);
      }
      previousFix.set(boat.id, { latitude: boat.latitude, longitude: boat.longitude });
    }
  }
  const afloat = new Set(next.map((boat) => boat.id));
  for (const id of [...previousFix.keys()]) if (!afloat.has(id)) { previousFix.delete(id); heading.delete(id); }
}

function message(text) {
  mapMessage.textContent = text || "";
  mapMessage.hidden = !text;
}

// The boat the board sent someone here to look at.
//
// Matched on the name, which is what a departure row can honestly offer: a sailing an hour out has
// no vehicle of its own, and the vessel the board names for it is one that is out on the water
// right now working some other trip entirely. Its number is accepted too, since that is the other
// thing the fleet is called by.
function findWanted() {
  const flatten = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const asked = flatten(wanted);
  return boats.find((boat) => flatten(boat.name) === asked || flatten(boat.number) === asked) || null;
}

// Tried again on every refresh until it turns up. A predicted boat is a real vessel that really is
// out there, so the usual reason it is missing is that this page opened a second before the feed
// caught up — and a page that gave up on the first poll would be wrong about that. Returns what to
// say about it: nothing once it is found, and null when nobody asked for a boat at all.
function followWanted() {
  if (!wanted) return null;
  const found = findWanted();
  if (!found) return `${wanted} is not reporting a position right now.`;
  wanted = null;
  selectedId = found.id;
  recentreOn(found);
  return "";
}

async function load() {
  try {
    if (!harbor) {
      // Relative, so the page works at /map on a kiosk and under /ferryTimesMobile/ on juliet.nyc
      // without knowing which it is. The proxy forwards /api/ either way.
      const chartResponse = await fetch("/api/map");
      if (!chartResponse.ok) throw new Error(String(chartResponse.status));
      harbor = await chartResponse.json();
      drawHarbor();
    }

    const response = await fetch("/api/boats", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok && !payload.boats) throw new Error(String(response.status));

    boats = payload.boats || [];
    updateHeadings(boats);
    // A boat that has left the feed cannot stay selected, or the map keeps a halo on water.
    if (selectedId && !boats.some((boat) => boat.id === selectedId)) selectedId = null;
    const following = followWanted();
    drawFleet();
    renderList();

    const at = payload.fetchedAt ? new Date(payload.fetchedAt) : null;
    // The board's three words, in the board's chip.
    statusText.textContent = !payload.available ? "No feed" : payload.stale ? "Saved" : "Live";
    // A boat that was asked for and cannot be found is the most specific thing this page can say, so
    // it outranks the general note about the feed being stale. A feed that is not answering at all
    // outranks both, because it explains them.
    message(!payload.available
      ? "The vessel feed is not answering. Nothing here is current."
      : following || (payload.stale ? `Last positions the feed gave${at ? `, at ${timeLabel.format(at)}` : ""}.` : ""));
  } catch {
    statusText.textContent = "Offline";
    message("Could not reach the server.");
  }
}

load();
// The server refreshes its own snapshot on a fifteen-second cache, so asking more often than this
// only ever returns the same boats in the same place.
setInterval(load, REFRESH_MS);
