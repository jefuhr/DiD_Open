// The map page, run rather than read.
//
// The other client-side contract tests assert on source text, which is enough for "does the markup
// still say what the code expects". It is not enough here: this page's whole job is to turn two
// JSON payloads into a drawing, and the failures worth catching — a projection that puts the fleet
// off the frame, a constant renamed on one line and not the next — are runtime failures that no
// amount of grepping the file finds. So map.js is executed against a fake DOM small enough to read
// and faithful enough to draw into.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const scriptPath = new URL("../public/assets/map.js", import.meta.url);
const pagePath = new URL("../public/map.html", import.meta.url);

const HARBOR = {
  bounds: { minLatitude: 40.6, maxLatitude: 40.8, minLongitude: -74.05, maxLongitude: -73.95 },
  routes: [
    { id: "ER", shortName: "ER", name: "East River", color: "#00839C", mode: "ferry", paths: [[[40.7, -74.0], [40.75, -73.97]]] },
    { id: "SB", shortName: "SB", name: "South Brooklyn", color: "#FFD100", mode: "ferry", paths: [[[40.7, -74.0], [40.64, -74.03]]] }
  ],
  landings: [
    { id: 17, name: "East 34th Street", displayName: "East 34th Street", latitude: 40.75, longitude: -73.97 },
    { id: 4, name: "Bay Ridge", displayName: "Bay Ridge", latitude: 40.64, longitude: -74.03 }
  ]
};

const BOAT = {
  id: "19", name: "Opportunity", number: "H-204", latitude: 40.72, longitude: -73.99,
  bearing: null, speedKnots: 17.5, tripId: "863", routeId: "ER", route: "ER", routeName: "East River",
  color: "#00839C", mode: "ferry", destination: "Wall St./Pier 11", status: "in-transit",
  stop: { id: "17", name: "East 34th Street", latitude: 40.75, longitude: -73.97 },
  reportedAt: "2026-09-01T21:00:00Z", ageSeconds: 12
};

// ---------------------------------------------------------------- a DOM, roughly

function classSet(node) {
  return new Set(String(node.attrs.class || node.className || "").split(/\s+/).filter(Boolean));
}

function makeNode(tag) {
  const node = {
    tag,
    attrs: {},
    dataset: {},
    style: {},
    children: [],
    parent: null,
    listeners: new Map(),
    className: "",
    type: "",
    hidden: false,
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return this.attrs[key] ?? null; },
    removeAttribute(key) { delete this.attrs[key]; },
    append(...kids) { for (const kid of kids) { kid.parent = this; this.children.push(kid); } },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    setPointerCapture() {},
    // Identity, so a client pixel is a drawing unit and a pan of sixty pixels is a pan of sixty
    // units. The real matrix is the browser's business; what is being tested is the arithmetic.
    getScreenCTM: () => ({ inverse: () => ({}) }),
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attrs.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attrs.class = [...set].join(" "); },
      toggle(name, on) { on ? this.add(name) : this.remove(name); },
      contains(name) { return classSet(node).has(name); }
    },
    descendants() {
      return this.children.flatMap((kid) => [kid, ...kid.descendants()]);
    },
    querySelectorAll(selector) {
      const wanted = selector.replace(/^[.#]/, "");
      return this.descendants().filter((kid) => (selector.startsWith("#") ? kid.attrs.id === wanted : classSet(kid).has(wanted)));
    },
    closest(selector) {
      const wanted = selector.replace(/^\./, "");
      for (let at = this; at; at = at.parent) if (classSet(at).has(wanted)) return at;
      return null;
    }
  };
  // Like the real one: reading it walks the children, and writing it replaces all of them.
  let text = "";
  Object.defineProperty(node, "textContent", {
    get() { return text + node.children.map((kid) => kid.textContent).join(" "); },
    set(value) { text = String(value); node.children = []; }
  });
  return node;
}

async function page({ boats = [BOAT], available = true, stale = false, query = "" } = {}) {
  const [source, markup] = await Promise.all([readFile(scriptPath, "utf8"), readFile(pagePath, "utf8")]);
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const registry = new Map();
  const byId = (id) => {
    if (!registry.has(id)) { const made = makeNode("div"); made.attrs.id = id; registry.set(id, made); }
    return registry.get(id);
  };
  const asked = [];
  const live = { boats };
  let poll = null;

  const context = {
    console, Promise, Intl, Math, JSON, Number, String, Object, Array, Boolean, Error, Set, Map, Date, URLSearchParams,
    // How the board hands a boat over: /map?boat=Tooth%20Ferry.
    location: { search: query },
    document: {
      getElementById: (id) => (ids.includes(id) ? byId(id) : null),
      createElement: (tag) => makeNode(tag),
      createElementNS: (_namespace, tag) => makeNode(tag)
    },
    DOMPoint: class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } },
    // Held rather than run, so a test can take the next poll when it wants one.
    setInterval: (handler) => { poll = handler; return 0; },
    async fetch(url) {
      asked.push(String(url));
      const body = String(url).startsWith("/api/map") ? HARBOR : { available, stale, fetchedAt: "2026-09-01T21:00:12Z", boats: live.boats };
      return { ok: true, json: async () => body };
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "map.js" });
  // Two fetches deep, plus the render that follows them.
  for (let tick = 0; tick < 4; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));

  const chart = byId("chart");
  return {
    asked,
    chart,
    node: byId,
    view: () => chart.getAttribute("viewBox").split(" ").map(Number),
    find: (className) => chart.querySelectorAll(`.${className}`),
    layer: (className) => chart.querySelectorAll(`.${className}`)[0],
    listText: () => byId("boats").textContent,
    fire: (id, type, event = {}) => byId(id).listeners.get(type)?.(event),
    async refresh(next) {
      live.boats = next;
      poll();
      for (let tick = 0; tick < 4; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
}

// ---------------------------------------------------------------- the drawing

test("the harbor is drawn from the feed's own shapes, and every boat lands on it", async () => {
  const view = await page();
  assert.deepEqual(view.asked, ["/api/map", "/api/boats"]);

  // One casing and one coloured line per path, so overlapping routes stay legible.
  assert.equal(view.find("route-line").length, 2);
  assert.equal(view.find("route-casing").length, 2);
  assert.deepEqual(view.find("route-line").map((line) => line.attrs.stroke), ["#00839C", "#FFD100"]);
  assert.equal(view.find("dock").length, 2);
  assert.equal(view.find("boat").length, 1);

  const [x, y, width, height] = view.view();
  assert.equal(x, 0);
  assert.equal(y, 0);
  // Taller than it is wide, which is the shape of this harbor.
  assert.ok(height > width, "the fitted view should keep the harbor's proportions");

  // The boat is inside the frame, and where its coordinates say rather than at a corner.
  const [boatX, boatY] = view.find("boat")[0].attrs.transform.match(/-?[\d.]+/g).map(Number);
  assert.ok(boatX > 0 && boatX < width, `the boat is off the frame at x=${boatX}`);
  assert.ok(boatY > 0 && boatY < height, `the boat is off the frame at y=${boatY}`);
  // 40.72 of 40.6–40.8 is three fifths of the way up, so three fifths of the way down the drawing.
  assert.ok(Math.abs(boatY / height - 0.4) < 0.05, `the projection put it at ${(boatY / height).toFixed(2)} of the way down`);
});

test("the list says what each boat is doing", async () => {
  const view = await page();
  const text = view.listText();
  assert.match(text, /Opportunity/);
  assert.match(text, /H-204/);
  assert.match(text, /Next stop East 34th Street/);
  assert.match(text, /to Wall St\.\/Pier 11/);
  assert.match(text, /17\.5 kn/);
  assert.match(text, /just now/);

  // The headsign and the stop name are two spellings of one pier, and a boat terminating at its
  // next stop should not be sent there twice in two different hands.
  const terminating = await page({ boats: [{ ...BOAT, stop: { ...BOAT.stop, name: "Wall St/Pier 11" }, destination: "Wall St./Pier 11" }] });
  assert.match(terminating.listText(), /Next stop Wall St\/Pier 11/);
  assert.doesNotMatch(terminating.listText(), / · to /);
  assert.equal(view.node("boatCount").textContent, "1 boat");
  // The board's own freshness chip, saying the board's own word for it.
  assert.equal(view.node("mapStatusText").textContent, "Live");
});

// Outside service hours there is nothing on the water, and saying so is the honest answer rather
// than a page that looks broken.
test("an empty harbor says so instead of looking broken", async () => {
  const view = await page({ boats: [] });
  assert.equal(view.find("boat").length, 0);
  assert.match(view.listText(), /No NYC Ferry vessel is reporting/);
  // The one place left that says the partners are never on here.
  assert.match(view.listText(), /partner operators never report one/);
  assert.equal(view.node("boatCount").textContent, "None out");
  // The routes are still drawn: the harbor did not go anywhere.
  assert.equal(view.find("route-line").length, 2);
});

test("a feed that is not answering is not passed off as an empty harbor", async () => {
  const view = await page({ boats: [], available: false });
  assert.match(view.node("mapMessage").textContent, /not answering/);
  assert.equal(view.node("mapMessage").hidden, false);
});

test("a cached snapshot says when it was taken", async () => {
  const view = await page({ stale: true });
  assert.match(view.node("mapMessage").textContent, /Last positions the feed gave/);
  assert.equal(view.node("mapStatusText").textContent, "Saved");
});

// ---------------------------------------------------------------- picking a boat

test("picking a boat names it, marks the dock it is working towards, and goes and finds it", async () => {
  const view = await page();
  const [, , fittedWidth] = view.view();
  assert.equal(view.find("boat-label").length, 0, "nothing is named until something is picked");
  assert.equal(view.find("is-target").length, 0);

  const row = view.node("boats").descendants().find((node) => classSet(node).has("boat-row"));
  row.listeners.get("click")();

  assert.equal(view.find("boat-label")[0].textContent, "Opportunity");
  assert.equal(view.find("boat-halo").length, 1);
  // East 34th Street is the next stop, and it is the dock that gets a name.
  const targets = view.find("is-target");
  assert.equal(targets.length, 1);
  assert.equal(targets[0].querySelectorAll(".dock-label")[0].textContent, "East 34th Street");
  // Chosen from the list, so the map goes to it.
  assert.ok(view.view()[2] < fittedWidth, "picking from the list should zoom in on the boat");

  row.listeners.get("click")();
  assert.equal(view.find("boat-label").length, 0, "picking the same boat again lets it go");
  assert.equal(view.find("is-target").length, 0);
});

test("a tap on the map picks a boat, and a drag across it does not", async () => {
  const view = await page();
  const hull = view.find("boat-hull")[0];

  view.fire("chart", "click", { target: hull });
  assert.equal(view.find("boat-halo").length, 1, "a tap on a boat picks it");

  view.fire("chart", "click", { target: hull });
  assert.equal(view.find("boat-halo").length, 0);

  // A pan that happens to finish over a boat is a pan.
  view.fire("chart", "pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
  view.fire("chart", "pointermove", { pointerId: 1, clientX: 160, clientY: 140 });
  view.fire("chart", "click", { target: view.find("boat-hull")[0] });
  assert.equal(view.find("boat-halo").length, 0, "a drag should not pick anything");
});

// ---------------------------------------------------------------- arriving from the board

// A departure on the board hands its boat over by name, because that is the only identifier that
// holds for a sailing the feed has not reached yet: the vessel predicted for it is out on the water
// right now working some other trip entirely.
test("a boat named in the query string is found, named and gone to", async () => {
  const fittedWidth = (await page()).view()[2];
  const view = await page({ query: "?boat=Opportunity" });
  assert.equal(view.find("boat-halo").length, 1, "the boat arrives selected");
  assert.equal(view.find("boat-label")[0].textContent, "Opportunity");
  assert.ok(view.view()[2] < fittedWidth, "the view is zoomed in on it rather than left at the whole harbor");
  assert.equal(view.node("mapMessage").hidden, true, "nothing to explain once it is found");

  // The hull number is the other thing the fleet is called by.
  const byNumber = await page({ query: "?boat=H-204" });
  assert.equal(byNumber.find("boat-halo").length, 1);
});

// The boat named for a sailing an hour out is a real vessel, and the usual reason it is missing is
// that this page opened a second before the feed caught up. So it keeps looking, and says what it
// is looking for meanwhile rather than opening on an unexplained empty harbor.
test("a boat that is not reporting is said so, and is still waited for", async () => {
  const view = await page({ boats: [], query: "?boat=McShane" });
  assert.match(view.node("mapMessage").textContent, /McShane is not reporting a position right now/);
  assert.equal(view.find("boat-halo").length, 0);

  await view.refresh([{ ...BOAT, id: "77", name: "McShane", number: "H-119" }]);
  assert.equal(view.find("boat-halo").length, 1, "it is picked up as soon as it appears");
  assert.equal(view.node("mapMessage").textContent, "");
});

// Once somebody has picked a boat for themselves, the page stops chasing the one in the URL.
test("picking a boat by hand calls off the search for the one in the link", async () => {
  const view = await page({ boats: [], query: "?boat=McShane" });
  await view.refresh([BOAT]);
  assert.match(view.node("mapMessage").textContent, /McShane is not reporting/);

  const row = view.node("boats").descendants().find((node) => classSet(node).has("boat-row"));
  row.listeners.get("click")();
  assert.equal(view.find("boat-label")[0].textContent, "Opportunity");

  // McShane turning up now must not yank the map off the boat that was chosen instead.
  await view.refresh([BOAT, { ...BOAT, id: "77", name: "McShane", number: "H-119" }]);
  assert.equal(view.find("boat-label")[0].textContent, "Opportunity");
  assert.equal(view.node("mapMessage").textContent, "");
});

// ---------------------------------------------------------------- heading

// The vendor publishes speed but never bearing, so the only honest way to point a boat is to point
// it the way it has just travelled — and to point it nowhere until it has actually gone somewhere.
test("a boat is pointed by where it has been, once it has been anywhere", async () => {
  const view = await page();
  assert.equal(view.find("boat-heading").length, 0, "one fix is not a heading");

  // A few metres of drift at the pier is not a course.
  await view.refresh([{ ...BOAT, latitude: BOAT.latitude + 0.00005 }]);
  assert.equal(view.find("boat-heading").length, 0, "drifting alongside is not a heading");

  // Half a kilometre due east.
  await view.refresh([{ ...BOAT, longitude: BOAT.longitude + 0.006 }]);
  const [chevron] = view.find("boat-heading");
  assert.ok(chevron, "a boat that has moved is pointed");
  const bearing = Number(chevron.attrs.transform.match(/-?[\d.]+/)[0]);
  assert.ok(Math.abs(bearing - 90) < 2, `east is 90 degrees, not ${bearing}`);

  // And south again.
  await view.refresh([{ ...BOAT, longitude: BOAT.longitude + 0.006, latitude: BOAT.latitude - 0.006 }]);
  const turned = Number(view.find("boat-heading")[0].attrs.transform.match(/-?[\d.]+/)[0]);
  assert.ok(Math.abs(turned - 180) < 2, `south is 180 degrees, not ${turned}`);
});

// ---------------------------------------------------------------- zoom

test("zoom stays inside the harbor, and dock names wait until there is room for them", async () => {
  const view = await page();
  const fitted = view.view();
  assert.equal(view.layer("docks").classList.contains("is-close"), false);

  for (let press = 0; press < 4; press += 1) view.fire("zoomIn", "click", {});
  const close = view.view();
  assert.ok(close[2] < fitted[2] / 2, "zooming in should narrow the view");
  assert.equal(view.layer("docks").classList.contains("is-close"), true, "close in, the docks are named");

  // Everything on the map is counter-scaled so a boat stays the same size on screen at any zoom.
  const scaled = view.find("scaler").map((node) => Number(node.attrs.transform.match(/[\d.]+/)[0]));
  assert.ok(scaled.every((factor) => Math.abs(factor - close[2] / fitted[2]) < 0.01));

  for (let press = 0; press < 20; press += 1) view.fire("zoomOut", "click", {});
  assert.deepEqual(view.view(), fitted, "zooming out past the whole harbor stops at the whole harbor");
});
