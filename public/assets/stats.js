// The stats page. Reads /api/stats once and renders it — no polling, because these are lifetime
// totals that move slowly and nobody leaves this page open.
//
// Everything is written through textContent rather than innerHTML. The counter keys are fixed by
// lib/counters.js and the landing names come from config/landings.json, so none of it is user
// input today — but a page that renders a JSON payload should not be one edit away from being an
// injection, and the page's own Content-Security-Policy is the wrong last line of defence.

const ROUTE_LABELS = {
  "/api/display-data": "Board data",
  "/api/realtime": "Live arrivals",
  "/api/alerts": "Service alerts",
  "/api/override": "Posted notices",
  "/api/landings": "Landing list",
  "/api/health": "Health checks",
  "/healthz": "Health checks",
  "/api/stats": "This page",
  static: "Files served",
  other: "Not found"
};

const EVENT_LABELS = {
  "realtime-stale": "Served from cache",
  "realtime-unavailable": "Feed unavailable"
};

const number = new Intl.NumberFormat("en-US");

function rows(target, counts, labels) {
  const list = document.getElementById(target);
  list.textContent = "";
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    const empty = document.createElement("dt");
    empty.className = "empty";
    empty.textContent = "Nothing yet.";
    list.append(empty, document.createElement("dd"));
    return entries.length;
  }
  for (const [key, count] of entries) {
    const term = document.createElement("dt");
    term.textContent = labels?.[key] || key;
    const value = document.createElement("dd");
    value.textContent = number.format(count);
    list.append(term, value);
  }
  return entries.length;
}

function bars(counts, names) {
  const list = document.getElementById("landings");
  list.textContent = "";
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No boards opened yet.";
    list.append(empty);
    return;
  }
  const most = entries[0][1];
  for (const [id, count] of entries) {
    const item = document.createElement("li");
    const label = document.createElement("div");
    label.className = "label";
    const name = document.createElement("span");
    name.textContent = names?.[id] || `Landing ${id}`;
    const value = document.createElement("span");
    value.textContent = number.format(count);
    label.append(name, value);

    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("span");
    fill.className = "fill";
    // Widths are relative to the busiest dock, so the shape of the list survives the totals
    // growing by an order of magnitude.
    fill.style.width = `${Math.max(2, Math.round((count / most) * 100))}%`;
    track.append(fill);

    item.append(label, track);
    list.append(item);
  }
}

async function load() {
  const since = document.getElementById("since");
  try {
    // Relative, so the page works at /stats on a kiosk and under /ferryTimesMobile/ on juliet.nyc
    // without knowing which it is. The proxy forwards /api/ either way.
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const stats = await response.json();

    since.textContent = stats.since
      ? `Since ${new Date(stats.since).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
      : "Counting since this server last started.";

    bars(stats.landings || {}, stats.landingNames);
    rows("routes", stats.routes || {}, ROUTE_LABELS);
    rows("statuses", stats.statuses || {});
    document.getElementById("eventsSection").hidden = !rows("events", stats.events || {}, EVENT_LABELS);
  } catch {
    since.textContent = "Stats are unavailable right now.";
  }
}

load();
