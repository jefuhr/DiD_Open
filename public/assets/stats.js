// The stats page.
//
// Reads /api/stats and draws it. The charts are SVG built by hand — a charting library would be
// the largest thing this server serves, to draw two lines on a page nobody keeps open.
//
// Everything is written through textContent and createElementNS rather than innerHTML. The counter
// keys are fixed by lib/counters.js and the landing names come from config/landings.json, so none
// of it is user input today — but a page whose whole job is rendering a JSON payload should not be
// one edit away from being an injection, and its own Content-Security-Policy is the wrong last line
// of defence.

const REFRESH_MS = 60_000;
const SVG = "http://www.w3.org/2000/svg";

const ROUTE_LABELS = {
  "/api/display-data": "Board data",
  "/api/realtime": "Live arrivals",
  "/api/boats": "Boat positions",
  "/api/map": "Map outline",
  "/map": "Map page",
  "/api/alerts": "Service alerts",
  "/api/override": "Posted notices",
  "/api/landings": "Landing list",
  "/api/health": "Health checks",
  "/healthz": "Health checks",
  "/api/stats": "This page",
  "/stats": "This page",
  static: "Files served",
  other: "Not found"
};

const FEED_LABELS = {
  "realtime-ok": "Fresh from the feed",
  "realtime-stale": "Served from cache",
  "realtime-unavailable": "Nothing to serve"
};

const number = new Intl.NumberFormat("en-US");
const hourLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "America/New_York" });
const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag, attributes) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function sum(counts) {
  return Object.values(counts || {}).reduce((total, value) => total + value, 0);
}

// ---------------------------------------------------------------- charts

// One path per series across a shared scale, so two lines on the same chart mean the same thing at
// the same height.
function lineChart(target, series, { area = false } = {}) {
  const host = document.getElementById(target);
  host.textContent = "";

  const width = 720;
  const height = 120;
  const padding = { top: 10, right: 6, bottom: 18, left: 30 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const points = series[0].points;
  if (!points?.length) {
    host.append(element("p", "empty", "No history yet — the first hour is still being counted."));
    return;
  }

  const peak = Math.max(1, ...series.flatMap((line) => line.points.map((point) => point.count)));
  const x = (index) => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (count) => padding.top + plotHeight - (count / peak) * plotHeight;

  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", preserveAspectRatio: "none" });

  // Two gridlines and their labels: none at all makes a sparkline unreadable, more turns it into a
  // spreadsheet.
  for (const fraction of [0, 0.5, 1]) {
    const value = Math.round(peak * fraction);
    const lineY = y(value);
    svg.append(svgNode("line", { class: "gridline", x1: padding.left, x2: width - padding.right, y1: lineY, y2: lineY }));
    const label = svgNode("text", { class: "axis", x: 0, y: lineY + 3 });
    label.textContent = number.format(value);
    svg.append(label);
  }

  for (const line of series) {
    const path = line.points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.count).toFixed(1)}`).join(" ");
    if (area) {
      svg.append(svgNode("path", {
        class: "area",
        d: `${path} L${x(line.points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
      }));
    }
    svg.append(svgNode("path", { class: `line ${line.className || ""}`.trim(), d: path }));
  }

  // Hours along the bottom, every sixth one, in New York time — the buckets are stored in UTC so
  // an hour means one thing across a daylight-saving change.
  for (let index = 0; index < points.length; index += 6) {
    const label = svgNode("text", { class: "axis", x: x(index), y: height - 5, "text-anchor": "middle" });
    const at = new Date(points[index].hour);
    label.textContent = at.getUTCHours() === 4 || index === 0 ? dayLabel.format(at) : hourLabel.format(at).replace(" ", "");
    svg.append(label);
  }

  // The busiest hour, marked. It is the one point on a traffic chart anybody actually looks for.
  if (series.length === 1) {
    const peakIndex = points.reduce((best, point, index) => (point.count > points[best].count ? index : best), 0);
    if (points[peakIndex].count > 0) {
      svg.append(svgNode("circle", { class: "peak", cx: x(peakIndex), cy: y(points[peakIndex].count), r: 3.5 }));
    }
  }

  const title = svgNode("title", {});
  title.textContent = `${series.map((line) => line.label).join(", ")} — peak ${number.format(peak)} per hour`;
  svg.append(title);
  host.append(svg);

  if (series.length > 1) {
    const legend = element("p", "legend");
    for (const line of series) {
      const key = element("span", "key");
      key.append(element("span", `swatch ${line.className || ""}`.trim()), element("span", null, line.label));
      legend.append(key);
    }
    host.append(legend);
  }
}

// ---------------------------------------------------------------- panels

function tiles(stats) {
  const host = document.getElementById("tiles");
  host.textContent = "";

  const boardsToday = (stats.series?.boards || []).slice(-24).reduce((total, point) => total + point.count, 0);
  const feedTotal = sum(stats.events) || 0;
  const fresh = stats.events?.["realtime-ok"] || 0;
  const health = feedTotal ? Math.round((fresh / feedTotal) * 100) : null;

  const items = [
    { value: number.format(sum(stats.landings)), label: "Boards opened" },
    { value: number.format(boardsToday), label: "Opened, last 24h" },
    { value: number.format(sum(stats.routes)), label: "Requests served" },
    { value: health === null ? "—" : `${health}%`, label: "Feed answered fresh" }
  ];
  for (const item of items) {
    const tile = element("div", "tile");
    tile.append(element("div", "value", item.value), element("div", "label", item.label));
    host.append(tile);
  }
}

function rows(target, counts, labels) {
  const list = document.getElementById(target);
  list.textContent = "";
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    list.append(element("dt", "empty", "Nothing yet."), element("dd"));
    return 0;
  }
  for (const [key, count] of entries) {
    list.append(element("dt", null, labels?.[key] || key), element("dd", null, number.format(count)));
  }
  return entries.length;
}

function bars(counts, names) {
  const list = document.getElementById("landings");
  list.textContent = "";
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (!entries.length) {
    list.append(element("li", "empty", "No boards opened yet."));
    return;
  }
  const most = entries[0][1];
  for (const [id, count] of entries) {
    const item = element("li");
    const label = element("div", "label");
    label.append(element("span", null, names?.[id] || `Landing ${id}`), element("span", null, number.format(count)));
    const track = element("div", "track");
    const fill = element("span", "fill");
    // Widths are relative to the busiest dock, so the shape of the list survives the totals
    // growing by an order of magnitude.
    fill.style.width = `${Math.max(2, Math.round((count / most) * 100))}%`;
    track.append(fill);
    item.append(label, track);
    list.append(item);
  }
}

function timings(latency) {
  const body = document.getElementById("latency");
  body.textContent = "";
  const entries = Object.entries(latency || {}).sort((a, b) => b[1].count - a[1].count);
  if (!entries.length) {
    const row = element("tr");
    const cell = element("td", "empty", "No timings yet.");
    cell.setAttribute("colspan", "4");
    row.append(cell);
    body.append(row);
    return;
  }
  for (const [route, timing] of entries) {
    const row = element("tr");
    row.append(
      element("td", null, ROUTE_LABELS[route] || route),
      element("td", null, number.format(timing.count)),
      element("td", null, `${number.format(timing.p50)} ms`),
      element("td", null, `${number.format(timing.p95)} ms`)
    );
    body.append(row);
  }
}

// ---------------------------------------------------------------- load

async function load() {
  const since = document.getElementById("since");
  try {
    // Relative, so the page works at /stats on a kiosk and under /ferryTimesMobile/ on juliet.nyc
    // without knowing which it is. The proxy forwards /api/ either way.
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const stats = await response.json();

    since.textContent = stats.since
      ? `counting since ${new Date(stats.since).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
      : "counting since this server last started";

    tiles(stats);
    lineChart("boardsChart", [{ label: "Boards opened", points: stats.series?.boards || [] }], { area: true });
    lineChart("feedChart", [
      { label: "Fresh", className: "ok", points: stats.feed?.ok || [] },
      { label: "From cache", className: "stale", points: stats.feed?.stale || [] },
      { label: "Unavailable", className: "bad", points: stats.feed?.unavailable || [] }
    ]);
    bars(stats.landings, stats.landingNames);
    rows("feed", stats.events, FEED_LABELS);
    rows("routes", stats.routes, ROUTE_LABELS);
    rows("statuses", stats.statuses);
    timings(stats.latency);

    document.getElementById("refreshed").textContent =
      `Updated ${new Date(stats.generatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
  } catch {
    since.textContent = "stats are unavailable right now";
  }
}

load();
// A minute is far more often than lifetime totals change and far less often than anybody reloads
// by hand. The page is one small JSON fetch, so this costs the box nothing worth measuring.
setInterval(load, REFRESH_MS);
