// The map page.
//
// Reads /api/map once for the harbor and /api/boats every fifteen seconds for what is on it, and
// draws both: an SVG of the route shapes, the docks and the fleet, over raster tiles from
// OpenStreetMap with OpenSeaMap's seamark layer on top.
//
// The tiles are the only thing on this page that comes from anywhere but this server, and the only
// reason its Content-Security-Policy names a host other than 'self' — for images, and nothing else.
// Everything drawn over them is this server's own data, which is what makes the page degrade
// rather than break: with no signal the backdrop is missing and the harbor is still there.
//
// Modernized with:
// - Inertial kinetic momentum and smooth camera easing (flyTo)
// - Full-bleed viewport with an interactive draggable bottom sheet (peek/half/full)
// - Floating vessel and landing detail cards
// - Quick route filter pills and real-time boat search
// - Dead-reckoning vessel animation between 15s refresh cycles
// - Full theme support across all 9 design themes
//
// Everything is written through textContent and createElementNS rather than innerHTML, strictly
// keeping the zero-innerHTML XSS contract.

const REFRESH_MS = 15_000;
const SVG = "http://www.w3.org/2000/svg";
const RADIANS = Math.PI / 180;
const METRES_PER_DEGREE = 111_320;
const DRAWING_WIDTH = 340;
const FIT_PADDING = 0.04;
const MAX_ZOOM = 16;
const LABEL_ZOOM = 2.2;
const STALE_FIX_SECONDS = 180;

const number = new Intl.NumberFormat("en-US");
const timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

const chart = document.getElementById("chart");
const mapMessage = document.getElementById("mapMessage");
const statusText = document.getElementById("mapStatusText");
const boatSearchInput = document.getElementById("boatSearch");
const routeFilterBar = document.getElementById("routeFilterBar");
const vesselCard = document.getElementById("vesselCard");
const dockCard = document.getElementById("dockCard");
const bridgeCard = document.getElementById("bridgeCard");
const seamarkCard = document.getElementById("seamarkCard");
const bottomSheet = document.getElementById("bottomSheet");
const sheetHandle = document.getElementById("sheetHandle");

const hasRaf = typeof requestAnimationFrame === "function";

let harbor = null;
let boats = [];
let selectedId = null;
let selectedDock = null;
let activeRouteFilter = null;
let searchQuery = "";
let projection = null;
let base = null;
let view = null;
let dockLayer = null;
let fleetLayer = null;
let tileLayer = null;
let chartBackdrop = null;
let tilesDrawnFor = "";
let fleetIsClose = false;

const previousFix = new Map();
const heading = new Map();
let wanted = new URLSearchParams(location.search).get("boat") || null;

// Camera animation state
let cameraAnimation = null;
let inertiaVelocity = null;

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

function worldX(longitude) {
  return (longitude + 180) / 360;
}
function worldY(latitude) {
  const sine = Math.sin(latitude * RADIANS);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}

function makeProjection(bounds) {
  const left = worldX(bounds.minLongitude);
  const top = worldY(bounds.maxLatitude);
  const scale = DRAWING_WIDTH / (worldX(bounds.maxLongitude) - left);
  const padding = DRAWING_WIDTH * FIT_PADDING;
  return {
    scale,
    padding,
    left,
    top,
    width: DRAWING_WIDTH + padding * 2,
    height: (worldY(bounds.minLatitude) - top) * scale + padding * 2,
    point(latitude, longitude) {
      return [
        (worldX(longitude) - left) * scale + padding,
        (worldY(latitude) - top) * scale + padding
      ];
    },
    tile(x, y, span) {
      return [(x * span - left) * scale + padding, (y * span - top) * scale + padding, span * scale];
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

// ---------------------------------------------------------------- the chart underneath

const TILE_LAYERS = [
  { name: "base", url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  { name: "seamark", url: (z, x, y) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png` }
];
const TILE_PIXELS = 256;
const MIN_TILE_ZOOM = 9;
const MAX_TILE_ZOOM = 16;
const MAX_TILES = 40;

function tileZoomFor() {
  const box = chart.getBoundingClientRect();
  if (!box.width || !view) return MIN_TILE_ZOOM;
  const unitsPerPixel = view.width / box.width;
  const worldPerPixel = unitsPerPixel / projection.scale;
  const zoom = Math.log2(1 / (worldPerPixel * TILE_PIXELS));
  return Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, Math.round(zoom)));
}

function drawTiles() {
  if (!tileLayer || !view || !projection) return;
  const toWorldX = (x) => (x - projection.padding) / projection.scale + projection.left;
  const toWorldY = (y) => (y - projection.padding) / projection.scale + projection.top;
  const west = toWorldX(view.x);
  const east = toWorldX(view.x + view.width);
  const north = toWorldY(view.y);
  const south = toWorldY(view.y + view.height);

  let zoom = tileZoomFor();
  let count, span, fromX, toX, fromY, toY;
  for (;;) {
    count = 2 ** zoom;
    span = 1 / count;
    const first = (value) => Math.max(0, Math.floor(value * count) - 1);
    const last = (value) => Math.min(count - 1, Math.floor(value * count) + 1);
    [fromX, toX, fromY, toY] = [first(west), last(east), first(north), last(south)];
    if (zoom <= MIN_TILE_ZOOM) break;
    if ((toX - fromX + 1) * (toY - fromY + 1) <= MAX_TILES) break;
    zoom -= 1;
  }

  const signature = `${zoom}|${fromX}|${toX}|${fromY}|${toY}`;
  if (signature === tilesDrawnFor) return;
  tilesDrawnFor = signature;

  tileLayer.textContent = "";
  for (const layer of TILE_LAYERS) {
    const group = svgNode("g", { class: `tiles-${layer.name}` });
    for (let x = fromX; x <= toX; x += 1) {
      for (let y = fromY; y <= toY; y += 1) {
        const [left, top, size] = projection.tile(x, y, span);
        group.append(svgNode("image", {
          href: layer.url(zoom, x, y),
          x: left.toFixed(2),
          y: top.toFixed(2),
          width: (size + 0.5).toFixed(2),
          height: (size + 0.5).toFixed(2)
        }));
      }
    }
    tileLayer.append(group);
  }
}

function marker(className, latitude, longitude) {
  const [x, y] = projection.point(latitude, longitude);
  const outer = svgNode("g", { class: className, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
  const inner = svgNode("g", { class: "scaler" });
  outer.append(inner);
  return { outer, inner };
}

function drawChartBackdrop(chartData) {
  if (!chartData || !projection) return null;
  const backdrop = svgNode("g", { class: "chart-backdrop" });

  // 1. Water body
  const waterGroup = svgNode("g", { class: "chart-water" });
  const pad = projection.padding * 15;
  const waterRect = svgNode("rect", {
    class: "map-water",
    x: (-pad).toFixed(1),
    y: (-pad).toFixed(1),
    width: (projection.width + pad * 2).toFixed(1),
    height: (projection.height + pad * 2).toFixed(1)
  });
  waterGroup.append(waterRect);
  backdrop.append(waterGroup);

  // 2. Landmass polygons
  if (chartData.landmass) {
    const landGroup = svgNode("g", { class: "chart-land" });
    for (const land of chartData.landmass) {
      if (!land.points || land.points.length < 3) continue;
      const d = pathData(land.points) + " Z";
      const path = svgNode("path", {
        class: `map-landmass land-${land.id}`,
        d,
        "vector-effect": "non-scaling-stroke"
      });
      path.dataset.landId = land.id;
      landGroup.append(path);
    }
    backdrop.append(landGroup);
  }

  // 3. Navigation Channels / Fairways
  if (chartData.channels) {
    const channelGroup = svgNode("g", { class: "chart-channels" });
    for (const channel of chartData.channels) {
      if (!channel.points || channel.points.length < 2) continue;
      const d = pathData(channel.points);
      const path = svgNode("path", {
        class: "map-channel",
        d,
        "vector-effect": "non-scaling-stroke"
      });
      channelGroup.append(path);
    }
    backdrop.append(channelGroup);
  }

  // 4. Major Streets (arterials and expressways only, no side streets)
  if (chartData.streets) {
    const streetGroup = svgNode("g", { class: "chart-streets" });
    for (const street of chartData.streets) {
      if (!street.points || street.points.length < 2) continue;
      const d = pathData(street.points);
      const casing = svgNode("path", {
        class: `map-street-casing street-${street.type}`,
        d,
        "vector-effect": "non-scaling-stroke"
      });
      const line = svgNode("path", {
        class: `map-street street-${street.type}`,
        d,
        "vector-effect": "non-scaling-stroke"
      });
      streetGroup.append(casing, line);
    }
    backdrop.append(streetGroup);
  }

  // 5. Bridges across waterways (with clearances)
  if (chartData.bridges) {
    const bridgeGroup = svgNode("g", { class: "chart-bridges" });
    for (const bridge of chartData.bridges) {
      if (!bridge.points || bridge.points.length < 2) continue;
      const [p1, p2] = bridge.points;
      const [x1, y1] = projection.point(p1[0], p1[1]);
      const [x2, y2] = projection.point(p2[0], p2[1]);
      const mx = ((x1 + x2) / 2).toFixed(1);
      const my = ((y1 + y2) / 2).toFixed(1);

      const group = svgNode("g", { class: "bridge-group" });
      group.dataset.bridgeId = bridge.id;
      group.dataset.clearanceFeet = bridge.clearanceFeet;
      group.dataset.name = bridge.name;

      const casing = svgNode("line", {
        class: "bridge-casing",
        x1: x1.toFixed(1),
        y1: y1.toFixed(1),
        x2: x2.toFixed(1),
        y2: y2.toFixed(1),
        "vector-effect": "non-scaling-stroke"
      });
      const deck = svgNode("line", {
        class: "bridge-deck",
        x1: x1.toFixed(1),
        y1: y1.toFixed(1),
        x2: x2.toFixed(1),
        y2: y2.toFixed(1),
        "vector-effect": "non-scaling-stroke"
      });
      const inner = svgNode("g", { class: "scaler", transform: `translate(${mx},${my})` });
      const badge = svgNode("text", { class: "bridge-clearance-badge", x: 0, y: -3 });
      badge.textContent = `${bridge.clearanceFeet}'`;
      inner.append(badge);

      group.append(casing, deck, inner);
      bridgeGroup.append(group);
    }
    backdrop.append(bridgeGroup);
  }

  // 6. Naval Markings (Seamarks: Lights & Buoys)
  if (chartData.seamarks) {
    const seamarkGroup = svgNode("g", { class: "chart-seamarks" });
    for (const seamark of chartData.seamarks) {
      const { outer, inner } = marker(
        `seamark seamark-${seamark.type} seamark-${seamark.color}`,
        seamark.latitude,
        seamark.longitude
      );
      outer.dataset.seamarkId = seamark.id;
      outer.dataset.name = seamark.name;

      if (seamark.type === "light") {
        const halo = svgNode("circle", { class: "seamark-halo", r: 6 });
        const core = svgNode("circle", { class: "seamark-light-core", r: 2.6 });
        const label = svgNode("text", { class: "seamark-label", x: 6, y: 0.5 });
        label.textContent = seamark.name.split(" ")[0];
        inner.append(halo, core, label);
      } else {
        const buoy = svgNode("polygon", {
          class: `seamark-buoy-icon seamark-buoy-${seamark.color}`,
          points: seamark.shape === "nun" ? "-2,2.5 0,-2.8 2,2.5" : "-2.2,2 2.2,2 2.2,-2 -2.2,-2"
        });
        const label = svgNode("text", { class: "seamark-label", x: 5, y: 0.5 });
        label.textContent = seamark.name.replace(/^.*\bBuoy\s+/, "");
        inner.append(buoy, label);
      }
      seamarkGroup.append(outer);
    }
    backdrop.append(seamarkGroup);
  }

  return backdrop;
}

function drawHarbor() {
  chart.textContent = "";
  projection = makeProjection(harbor.bounds);
  base = { x: 0, y: 0, width: projection.width, height: projection.height };
  view = { ...base };

  const title = svgNode("title", { id: "chartTitle" });
  title.textContent = "NYC Ferry routes, landings and the boats currently running them, on a chart of the harbor.";
  chart.append(title);

  tileLayer = svgNode("g", { class: "tiles" });
  tilesDrawnFor = "";
  chart.append(tileLayer);

  if (harbor.chart) {
    chartBackdrop = drawChartBackdrop(harbor.chart);
    if (chartBackdrop) chart.append(chartBackdrop);
  } else {
    chartBackdrop = null;
  }

  const casings = svgNode("g", { class: "casings" });
  const lines = svgNode("g", { class: "lines" });
  for (const route of harbor.routes) {
    for (const points of route.paths) {
      const d = pathData(points);
      casings.append(svgNode("path", { class: "route-casing", d, "vector-effect": "non-scaling-stroke" }));
      const line = svgNode("path", { class: "route-line", d, stroke: route.color, "vector-effect": "non-scaling-stroke" });
      line.dataset.route = route.id;
      lines.append(line);
    }
  }
  chart.append(casings, lines);

  dockLayer = svgNode("g", { class: "docks" });
  fleetLayer = svgNode("g", { class: "fleet" });
  for (const landing of harbor.landings) {
    const { outer, inner } = marker("dock", landing.latitude, landing.longitude);
    outer.dataset.dockId = landing.id;
    outer.dataset.latitude = landing.latitude;
    outer.dataset.longitude = landing.longitude;
    inner.append(svgNode("circle", { class: "dock-mark", r: 4 }));
    const label = svgNode("text", { class: "dock-label", x: 7, y: 3.5 });
    label.textContent = landing.displayName || landing.name;
    inner.append(label);
    dockLayer.append(outer);
  }
  chart.append(dockLayer, fleetLayer);

  renderRouteFilters();
  legend();
  applyView();
}

// ---------------------------------------------------------------- filters & legend

function renderRouteFilters() {
  if (!routeFilterBar || !harbor?.routes) return;
  routeFilterBar.textContent = "";

  const allPill = element("button", `route-filter-pill${!activeRouteFilter ? " is-active" : ""}`, "All routes");
  allPill.type = "button";
  allPill.addEventListener("click", () => setRouteFilter(null));
  routeFilterBar.append(allPill);

  for (const route of harbor.routes) {
    const pill = element("button", `route-filter-pill${activeRouteFilter === route.id ? " is-active" : ""}`);
    pill.type = "button";
    const dot = element("span", "pill-dot");
    dot.style.background = route.color;
    pill.append(dot, element("span", null, route.shortName));
    pill.addEventListener("click", () => setRouteFilter(activeRouteFilter === route.id ? null : route.id));
    routeFilterBar.append(pill);
  }
}

function setRouteFilter(routeId) {
  activeRouteFilter = routeId;
  renderRouteFilters();
  updateRouteLineStyles();
  drawFleet();
  renderList();
}

function updateRouteLineStyles() {
  for (const line of chart.querySelectorAll(".route-line")) {
    const match = !activeRouteFilter || line.dataset.route === activeRouteFilter;
    line.classList.toggle("is-dimmed", !match);
  }
}

function legend() {
  const host = document.getElementById("legend");
  if (!host || !harbor?.routes) return;
  host.textContent = "";
  for (const route of harbor.routes) {
    const key = element("span", "key");
    const swatch = element("span", "swatch");
    swatch.style.background = route.color;
    key.append(swatch, element("span", null, route.shortName));
    key.addEventListener("click", () => setRouteFilter(activeRouteFilter === route.id ? null : route.id));
    host.append(key);
  }
}

function hullDigits(number) {
  return /^H-?\d+$/i.test(String(number || "")) ? String(number).replace(/^H-?/i, "") : null;
}

// ---------------------------------------------------------------- the fleet

function drawFleet() {
  if (!fleetLayer) return;
  fleetLayer.textContent = "";
  const hull = fleetIsClose ? 10.5 : 6;
  const halo = fleetIsClose ? 16 : 11;
  const bow = fleetIsClose ? "M0,-17 L4.4,-9.8 L-4.4,-9.8 Z" : "M0,-12 L3.6,-5.6 L-3.6,-5.6 Z";

  for (const boat of boats) {
    const matchesFilter = !activeRouteFilter || boat.routeId === activeRouteFilter;
    const { outer, inner } = marker("boat", boat.latitude, boat.longitude);
    outer.dataset.boat = boat.id;
    if ((boat.ageSeconds ?? 0) > STALE_FIX_SECONDS) outer.classList.add("is-stale");
    if (!matchesFilter) outer.classList.add("is-dimmed");

    if (boat.status !== "stopped") {
      inner.append(svgNode("circle", { class: "boat-wake", r: hull, fill: boat.color || "#8fd3f4" }));
    }
    if (boat.id === selectedId) inner.append(svgNode("circle", { class: "boat-halo", r: halo }));
    const disc = svgNode("circle", { class: "boat-hull", r: hull });
    if (boat.color) disc.setAttribute("fill", boat.color);
    inner.append(disc);

    const bearing = boat.bearing ?? heading.get(boat.id);
    if (bearing != null) {
      inner.append(svgNode("path", { class: "boat-heading", d: bow, transform: `rotate(${bearing})` }));
    }
    const digits = fleetIsClose ? hullDigits(boat.number) : null;
    if (digits) {
      const number = svgNode("text", { class: "boat-number", "text-anchor": "middle", y: 3.2 });
      if (boat.color) number.setAttribute("fill", readableOn(boat.color));
      number.textContent = digits;
      inner.append(number);
    }
    if (boat.id === selectedId) {
      const label = svgNode("text", { class: "boat-label", x: halo + 2, y: 4 });
      label.textContent = boat.name || boat.number || "Boat";
      inner.append(label);
    }
    fleetLayer.append(outer);
  }
  markTargetDock();
  updateVesselCard();
  applyView();
}

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

// ---------------------------------------------------------------- pan, zoom & camera easing

function applyView() {
  chart.setAttribute("viewBox", `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.width.toFixed(1)} ${view.height.toFixed(1)}`);
  drawTiles();
  const scale = (view.width / base.width).toFixed(3);
  for (const scaler of chart.querySelectorAll(".scaler")) scaler.setAttribute("transform", `scale(${scale})`);
  const close = base.width / view.width >= LABEL_ZOOM;
  if (dockLayer) dockLayer.classList.toggle("is-close", close);
  if (chartBackdrop) chartBackdrop.classList.toggle("is-close", close);
  if (fleetLayer && close !== fleetIsClose) {
    fleetIsClose = close;
    drawFleet();
  }
}

function clampView(next) {
  const width = Math.min(base.width, Math.max(base.width / MAX_ZOOM, next.width));
  const height = width * (base.height / base.width);
  return {
    x: Math.min(Math.max(next.x, 0), base.width - width),
    y: Math.min(Math.max(next.y, 0), base.height - height),
    width,
    height
  };
}

function setView(next) {
  if (!base) return;
  cancelCameraAnimation();
  view = clampView(next);
  applyView();
}

function cancelCameraAnimation() {
  if (cameraAnimation) {
    if (hasRaf) cancelAnimationFrame(cameraAnimation);
    cameraAnimation = null;
  }
}

function animateTo(target, duration = 320) {
  if (!view || !base) return;
  const clamped = clampView(target);
  if (!hasRaf) {
    setView(clamped);
    return;
  }
  cancelCameraAnimation();
  const start = { ...view };
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Smooth cubic ease out
    const ease = 1 - Math.pow(1 - progress, 3);
    view = {
      x: start.x + (clamped.x - start.x) * ease,
      y: start.y + (clamped.y - start.y) * ease,
      width: start.width + (clamped.width - start.width) * ease,
      height: start.height + (clamped.height - start.height) * ease
    };
    applyView();
    if (progress < 1) {
      cameraAnimation = requestAnimationFrame(step);
    } else {
      cameraAnimation = null;
    }
  }
  cameraAnimation = requestAnimationFrame(step);
}

function toDrawing(clientX, clientY) {
  const matrix = chart.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function zoomBy(factor, clientX, clientY, { animate = false } = {}) {
  if (!view || !base) return;
  const anchor = clientX == null ? null : toDrawing(clientX, clientY);
  const centre = anchor || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const next = {
    x: centre.x - (centre.x - view.x) * factor,
    y: centre.y - (centre.y - view.y) * factor,
    width: view.width * factor
  };
  if (animate && hasRaf) animateTo(next, 280);
  else setView(next);
}

const pointers = new Map();
let grabbed = null;
let pinchDistance = 0;
let dragged = false;
let pointerHistory = [];

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
  cancelCameraAnimation();
  chart.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY });
  pointerHistory = [{ x: event.clientX, y: event.clientY, time: Date.now() }];
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
  const origin = pointers.get(event.pointerId);
  if (Math.hypot(event.clientX - origin.originX, event.clientY - origin.originY) > 4) dragged = true;
  pointers.set(event.pointerId, { ...origin, x: event.clientX, y: event.clientY });

  const now = Date.now();
  pointerHistory.push({ x: event.clientX, y: event.clientY, time: now });
  if (pointerHistory.length > 5) pointerHistory.shift();

  if (pointers.size === 1 && grabbed) {
    const drawingPos = toDrawing(event.clientX, event.clientY);
    if (drawingPos) setView({ x: view.x - (drawingPos.x - grabbed.x), y: view.y - (drawingPos.y - grabbed.y), width: view.width });
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
    if (pointers.size === 0) {
      // Kinetic inertia glide if flicked
      if (dragged && hasRaf && pointerHistory.length >= 2) {
        const last = pointerHistory.at(-1);
        const prev = pointerHistory[0];
        const dt = Math.max(1, last.time - prev.time);
        if (dt < 180) {
          const ctm = chart.getScreenCTM();
          if (ctm) {
            const scale = view.width / chart.getBoundingClientRect().width;
            let vx = ((last.x - prev.x) / dt) * scale;
            let vy = ((last.y - prev.y) / dt) * scale;
            if (Math.hypot(vx, vy) > 0.08) {
              const glide = () => {
                vx *= 0.92;
                vy *= 0.92;
                if (Math.hypot(vx, vy) > 0.005 && view && base) {
                  view = clampView({ x: view.x - vx * 16, y: view.y - vy * 16, width: view.width });
                  applyView();
                  cameraAnimation = requestAnimationFrame(glide);
                } else {
                  cameraAnimation = null;
                }
              };
              cameraAnimation = requestAnimationFrame(glide);
            }
          }
        }
      }
      grabbed = null;
      chart.classList.remove("is-dragging");
    }
  });
}

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

chart.addEventListener("click", (event) => {
  if (dragged) return;
  const pickedBoat = event.target.closest?.(".boat");
  if (pickedBoat) {
    hideDockCard();
    hideBridgeCard();
    hideSeamarkCard();
    select(pickedBoat.dataset.boat, { recentre: false });
    return;
  }
  const pickedDock = event.target.closest?.(".dock");
  if (pickedDock) {
    hideBridgeCard();
    hideSeamarkCard();
    const dockId = Number(pickedDock.dataset.dockId);
    const dock = harbor?.landings?.find((l) => l.id === dockId);
    if (dock) showDockCard(dock);
    return;
  }
  const pickedBridge = event.target.closest?.(".bridge-group");
  if (pickedBridge) {
    hideDockCard();
    hideSeamarkCard();
    const bridgeId = pickedBridge.dataset.bridgeId;
    const bridge = harbor?.chart?.bridges?.find((b) => b.id === bridgeId);
    if (bridge) showBridgeCard(bridge);
    return;
  }
  const pickedSeamark = event.target.closest?.(".seamark");
  if (pickedSeamark) {
    hideDockCard();
    hideBridgeCard();
    const seamarkId = pickedSeamark.dataset.seamarkId;
    const seamark = harbor?.chart?.seamarks?.find((s) => s.id === seamarkId);
    if (seamark) showSeamarkCard(seamark);
    return;
  }
  hideDockCard();
  hideBridgeCard();
  hideSeamarkCard();
});

document.getElementById("zoomIn").addEventListener("click", () => zoomBy(1 / 1.4, null, null, { animate: true }));
document.getElementById("zoomOut").addEventListener("click", () => zoomBy(1.4, null, null, { animate: true }));
document.getElementById("zoomFit").addEventListener("click", () => {
  if (base) {
    if (hasRaf) animateTo({ ...base });
    else setView({ ...base });
  }
});

// ---------------------------------------------------------------- detail cards

function updateVesselCard() {
  if (!vesselCard) return;
  const boat = boats.find((b) => b.id === selectedId);
  if (!boat) {
    vesselCard.hidden = true;
    vesselCard.textContent = "";
    return;
  }
  vesselCard.textContent = "";
  vesselCard.hidden = false;

  const closeBtn = element("button", "card-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close vessel card");
  closeBtn.addEventListener("click", () => select(boat.id));

  const titleRow = element("div", "card-title-row");
  const chip = element("span", "card-route-chip", boat.route || "Ferry");
  if (boat.color) {
    chip.style.background = boat.color;
    chip.style.color = readableOn(boat.color);
  }
  const name = element("span", "card-vessel-name", boat.name || boat.number || "Ferry");
  if (boat.number && boat.name && boat.number !== boat.name) {
    name.append(element("span", "card-hull-number", ` (${boat.number})`));
  }
  titleRow.append(chip, name);

  const status = element("div", "card-status-line", boat.destination && !samePlace(boat.destination, boat.stop?.name)
    ? `${statusLine(boat)} · to ${boat.destination}`
    : statusLine(boat));

  const metaRow = element("div", "card-meta-row");
  const speed = element("span", "card-speed-badge", boat.speedKnots == null ? "Docked" : `⚡ ${boat.speedKnots.toFixed(1)} kn`);
  const age = element("span", null, ageLabel(boat.ageSeconds));
  metaRow.append(speed, age);

  const actionBtn = element("a", "card-action-btn", "Open Departure Board");
  actionBtn.href = boat.stop ? `./?landing=${boat.stop.id}` : ".";

  vesselCard.append(closeBtn, titleRow, status, metaRow, actionBtn);
}

function showDockCard(dock) {
  if (!dockCard) return;
  dockCard.textContent = "";
  dockCard.hidden = false;
  if (vesselCard) vesselCard.hidden = true;
  if (bridgeCard) bridgeCard.hidden = true;
  if (seamarkCard) seamarkCard.hidden = true;

  const closeBtn = element("button", "card-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close dock card");
  closeBtn.addEventListener("click", hideDockCard);

  const titleRow = element("div", "card-title-row");
  const name = element("span", "card-vessel-name", dock.displayName || dock.name);
  titleRow.append(name);

  const routesAtDock = (harbor?.routes || []).filter((r) =>
    r.paths?.some((path) => path.some((pt) => metresBetween({ latitude: pt[0], longitude: pt[1] }, dock) < 200)));

  const routesRow = element("div", "card-status-line", routesAtDock.length
    ? `Routes: ${routesAtDock.map((r) => r.shortName).join(", ")}`
    : "NYC Ferry Landing");

  const actionBtn = element("a", "card-action-btn", "View Landing Departures");
  actionBtn.href = `./?landing=${dock.id}`;

  dockCard.append(closeBtn, titleRow, routesRow, actionBtn);
}

function hideDockCard() {
  if (!dockCard) return;
  dockCard.hidden = true;
  dockCard.textContent = "";
}

function showBridgeCard(bridge) {
  if (!bridgeCard) return;
  bridgeCard.textContent = "";
  bridgeCard.hidden = false;
  if (vesselCard) vesselCard.hidden = true;
  if (dockCard) dockCard.hidden = true;
  if (seamarkCard) seamarkCard.hidden = true;

  const closeBtn = element("button", "card-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close bridge card");
  closeBtn.addEventListener("click", hideBridgeCard);

  const titleRow = element("div", "card-title-row");
  const name = element("span", "card-vessel-name", bridge.name);
  titleRow.append(name);

  const typeLine = element("div", "card-status-line", `${bridge.type} · ${bridge.waterway}`);

  const clearanceBox = element("div", "card-clearance-box");
  const heading = element("div", "card-clearance-label", "Vertical Navigational Clearance");
  const value = element("div", "card-clearance-val", `${bridge.clearanceFeet} ft (${bridge.clearanceMeters} m)`);
  const statusBadge = element("span", "card-clearance-badge", "✓ CLEAR FOR ALL FERRIES");
  const margin = Math.max(0, bridge.clearanceFeet - 32);
  const note = element("div", "card-clearance-note",
    `NYC Ferry vessels have an air draft of 26–32 ft (safe margin: ${margin} ft). ${bridge.clearanceNote}`);
  clearanceBox.append(heading, value, statusBadge, note);

  bridgeCard.append(closeBtn, titleRow, typeLine, clearanceBox);
}

function hideBridgeCard() {
  if (!bridgeCard) return;
  bridgeCard.hidden = true;
  bridgeCard.textContent = "";
}

function showSeamarkCard(seamark) {
  if (!seamarkCard) return;
  seamarkCard.textContent = "";
  seamarkCard.hidden = false;
  if (vesselCard) vesselCard.hidden = true;
  if (dockCard) dockCard.hidden = true;
  if (bridgeCard) bridgeCard.hidden = true;

  const closeBtn = element("button", "card-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close seamark card");
  closeBtn.addEventListener("click", hideSeamarkCard);

  const titleRow = element("div", "card-title-row");
  const name = element("span", "card-vessel-name", seamark.name);
  titleRow.append(name);

  const status = element("div", "card-status-line",
    seamark.type === "light"
      ? `Light: ${seamark.characteristic || "Fixed"} · Nominal Range: ${seamark.rangeNm || "—"} NM`
      : `Buoy: ${seamark.subtype || seamark.shape || "Marker"} (${seamark.color})`);

  const desc = element("div", "card-seamark-desc", seamark.description || "Harbor navigational mark.");

  seamarkCard.append(closeBtn, titleRow, status, desc);
}

function hideSeamarkCard() {
  if (!seamarkCard) return;
  seamarkCard.hidden = true;
  seamarkCard.textContent = "";
}

// ---------------------------------------------------------------- bottom sheet & search

if (sheetHandle && bottomSheet) {
  sheetHandle.addEventListener("click", () => {
    const states = ["peek", "half", "full"];
    const current = bottomSheet.dataset.state || "half";
    const next = states[(states.indexOf(current) + 1) % states.length];
    bottomSheet.dataset.state = next;
  });
}

if (boatSearchInput) {
  boatSearchInput.addEventListener("input", (event) => {
    searchQuery = String(event.target.value || "").trim().toLowerCase();
    renderList();
  });
}

// ---------------------------------------------------------------- the list

function statusLine(boat) {
  const where = boat.stop?.name;
  if (!where) return boat.status === "stopped" ? "Alongside" : "Under way";
  if (boat.status === "stopped") return `Alongside at ${where}`;
  if (boat.status === "incoming") return `Arriving at ${where}`;
  return `Next stop ${where}`;
}

function samePlace(left, right) {
  const flatten = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(left) && flatten(left) === flatten(right);
}

function ageLabel(seconds) {
  if (seconds == null) return "";
  if (seconds < 45) return "just now";
  return `${Math.round(seconds / 60)} min ago`;
}

function recentreOn(boat) {
  if (!boat || !view || !base) return;
  const [x, y] = projection.point(boat.latitude, boat.longitude);
  const width = Math.min(view.width, base.width / 5);
  const target = { x: x - width / 2, y: y - (width * (base.height / base.width)) / 2, width };
  if (hasRaf) animateTo(target, 360);
  else setView(target);
}

function select(id, { recentre = true } = {}) {
  wanted = null;
  selectedId = selectedId === id ? null : id;
  hideDockCard();
  hideBridgeCard();
  hideSeamarkCard();
  drawFleet();
  renderList();
  if (recentre) {
    const picked = boats.find((item) => item.id === selectedId);
    if (picked) {
      recentreOn(picked);
      if (bottomSheet && bottomSheet.dataset.state === "full") {
        bottomSheet.dataset.state = "half";
      }
    }
  }
}

function renderList() {
  const list = document.getElementById("boats");
  if (!list) return;
  list.textContent = "";

  const filtered = boats.filter((boat) => {
    if (activeRouteFilter && boat.routeId !== activeRouteFilter) return false;
    if (searchQuery) {
      const matchName = String(boat.name || "").toLowerCase().includes(searchQuery);
      const matchNum = String(boat.number || "").toLowerCase().includes(searchQuery);
      const matchDest = String(boat.destination || "").toLowerCase().includes(searchQuery);
      const matchStop = String(boat.stop?.name || "").toLowerCase().includes(searchQuery);
      return matchName || matchNum || matchDest || matchStop;
    }
    return true;
  });

  const countElem = document.getElementById("boatCount");
  if (countElem) {
    countElem.textContent = boats.length
      ? `${number.format(boats.length)} ${boats.length === 1 ? "boat" : "boats"}`
      : "None out";
  }

  if (!boats.length) {
    list.append(element("li", "empty", "No NYC Ferry vessel is reporting a position right now. Outside service hours that is what an empty harbor looks like — and the partner operators never report one."));
    return;
  }

  if (!filtered.length && searchQuery) {
    list.append(element("li", "empty", `No boats match "${searchQuery}".`));
    return;
  }

  for (const boat of filtered) {
    const item = element("li");
    const row = element("button", "boat-row");
    row.type = "button";
    row.setAttribute("aria-pressed", String(boat.id === selectedId));

    const chip = element("span", "route-chip", boat.route || "—");
    if (boat.color) {
      chip.style.background = boat.color;
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

function readableOn(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.45 ? "#3b2b33" : "#fff";
}

// ---------------------------------------------------------------- load & sync

function updateHeadings(next) {
  for (const boat of next) {
    const before = previousFix.get(boat.id);
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
  if (!mapMessage) return;
  mapMessage.textContent = text || "";
  mapMessage.hidden = !text;
}

function findWanted() {
  const flatten = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const asked = flatten(wanted);
  return boats.find((boat) => flatten(boat.name) === asked || flatten(boat.number) === asked) || null;
}

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
    if (selectedId && !boats.some((boat) => boat.id === selectedId)) selectedId = null;
    const following = followWanted();
    drawFleet();
    renderList();

    const at = payload.fetchedAt ? new Date(payload.fetchedAt) : null;
    if (statusText) {
      statusText.textContent = !payload.available ? "No feed" : payload.stale ? "Saved" : "Live";
    }
    message(!payload.available
      ? "The vessel feed is not answering. Nothing here is current."
      : following || (payload.stale ? `Last positions the feed gave${at ? `, at ${timeLabel.format(at)}` : ""}.` : ""));
  } catch {
    if (statusText) statusText.textContent = "Offline";
    message("Could not reach the server.");
  }
}

load();
setInterval(load, REFRESH_MS);

