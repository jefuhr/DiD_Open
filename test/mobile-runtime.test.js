import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const runtime = await readFile(
  new URL("../public/assets/mobile-runtime.js", import.meta.url),
  "utf8",
);
const app = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);
const mapScript = await readFile(
  new URL("../public/assets/map.js", import.meta.url),
  "utf8",
);
const schedule = (id) => ({
  meta: {
    timezone: "America/New_York",
    landingNumber: id,
    landing: { displayName: `Landing ${id}`, stopIds: ["1"] },
    departuresShown: 4,
    departureWindowMinutes: 180,
  },
  routes: {
    ER: {
      shortName: "ER",
      name: "East River",
      color: "#00839c",
      textColor: "#fff",
      operator: "NYC Ferry",
    },
  },
  calendars: [
    {
      serviceId: "daily",
      weekdays: Array(7).fill(true),
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
  ],
  exceptions: [],
  departures: Array.from({ length: 30 }, (_, i) => ({
    tripId: `trip-${i}`,
    routeId: "ER",
    serviceId: "daily",
    stopId: "1",
    directionId: "0",
    destination: "A long destination with intermediate operational details",
    seconds: 36000 + i * 60,
    departureTime: `10:${String(i).padStart(2, "0")}:00`,
    boatAssignment: 1,
  })),
  tripSchedules: {
    "trip-0": {
      stops: [
        { stopId: "1", sequence: 1, departureSeconds: 36000 },
        { stopId: "2", sequence: 2, arrivalSeconds: 36600 },
      ],
    },
  },
});
const harbor = {
  bounds: {
    minLatitude: 40.6,
    maxLatitude: 40.8,
    minLongitude: -74.05,
    maxLongitude: -73.95,
  },
  routes: [],
  landings: [],
};
const boat = {
  id: "19",
  name: "Opportunity",
  number: "H-204",
  latitude: 40.72,
  longitude: -73.99,
  status: "in-transit",
  speedKnots: 12,
  ageSeconds: 10,
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

async function page(
  t,
  { map = false, stored = {}, handler, brokenStorage = false, query = "" } = {},
) {
  const markup = await readFile(
    new URL(
      map ? "../public/map.html" : "../public/index.html",
      import.meta.url,
    ),
    "utf8",
  );
  const dom = new JSDOM(markup, {
    url: `https://ferry.test/ferryTimesMobile/${map ? "map" : ""}${query}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window,
    context = dom.getInternalVMContext();
  const intervals = new Map(),
    frames = [],
    requests = [];
  let hidden = false,
    nextTimer = 0;
  Object.defineProperty(w.document, "hidden", { get: () => hidden });
  w.document.documentElement.dataset.surface = "app";
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.CSS = { escape: (value) => String(value) };
  w.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  w.cancelAnimationFrame = () => {};
  w.setInterval = (callback) => {
    intervals.set(++nextTimer, callback);
    return nextTimer;
  };
  w.clearInterval = (id) => intervals.delete(id);
  const RealDate = Date;
  w.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-09-04T14:00:00Z"]));
    }
    static now() {
      return +new RealDate("2026-09-04T14:00:00Z");
    }
  };
  for (const [key, value] of Object.entries(stored))
    w.localStorage.setItem(key, value);
  if (brokenStorage)
    Object.defineProperty(w, "localStorage", {
      get() {
        throw new Error("storage denied");
      },
    });
  w.fetch = async (url, options) => {
    requests.push(url);
    let payload = await handler?.(url, options);
    if (payload === undefined)
      payload = url.startsWith("/api/display-data")
        ? schedule(
            Number(new URL(url, w.location).searchParams.get("landingId")) || 1,
          )
        : url === "/api/map"
          ? harbor
          : url === "/api/boats"
            ? { available: true, boats: [boat] }
            : url === "/api/landings"
              ? {
                  landings: [
                    { id: 1, displayName: "Landing 1" },
                    { id: 2, displayName: "Landing 2" },
                  ],
                }
              : url === "/api/alerts"
                ? { alerts: [], available: true }
                : url.startsWith("/api/realtime")
                  ? { updates: [], vehicles: [], available: true, stale: false }
                  : { active: false, entries: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  w.SVGElement.prototype.getBoundingClientRect = () => ({
    width: 390,
    height: 500,
  });
  vm.runInContext(runtime, context);
  vm.runInContext(map ? mapScript : app, context);
  const flush = async () => {
    for (let n = 0; n < 12; n++) {
      await new Promise((resolve) => setImmediate(resolve));
      let limit = 0;
      while (frames.length && limit++ < 20) frames.shift()(performance.now());
    }
  };
  await flush();
  return {
    w,
    run: (source) => vm.runInContext(source, context),
    flush,
    requests,
    intervals,
    node: (selector) => w.document.querySelector(selector),
    hide(value) {
      hidden = value;
      w.document.dispatchEvent(new w.Event("visibilitychange"));
    },
  };
}

test("board reconciliation preserves row identity, focused sailing, scroll and unchanged descendants in both sorts", async (t) => {
  const p = await page(t);
  for (const sort of ["time", "route"]) {
    p.run(`selectSort('${sort}')`);
    await p.flush();
    const row = p.node("[data-trip-id]"),
      time = row.querySelector("time");
    row.focus();
    p.node("#departures").scrollTop = 180;
    p.run("render()");
    await p.flush();
    assert.equal(p.node("[data-trip-id]"), row);
    assert.equal(row.querySelector("time"), time);
    assert.equal(p.w.document.activeElement, row);
    assert.equal(p.node("#departures").scrollTop, 180);
  }
});

test("saved board appears before schedule network completion and survives unavailable storage", async (t) => {
  const network = deferred();
  const p = await page(t, {
    stored: {
      "nyc-ferry-did-selected-landing": "1",
      "nyc-ferry-did-data-v6-landing-1": JSON.stringify(schedule(1)),
    },
    handler: (url) =>
      url.startsWith("/api/display-data") ? network.promise : undefined,
  });
  assert.ok(p.node(".timeline-row"));
  assert.match(p.node("#dataStatus").textContent, /Saved/);
  network.resolve(schedule(1));
  await p.flush();
  assert.equal(p.node("#landingName").textContent, "Landing 1");
  const denied = await page(t, { brokenStorage: true });
  assert.ok(denied.node(".timeline-row"));
});

test("corrupt saved JSON falls back to the network without aborting startup", async (t) => {
  const p = await page(t, {
    stored: {
      "nyc-ferry-did-landings": "{broken",
      "nyc-ferry-did-data-v6-alerts": "{broken",
    },
  });
  assert.ok(p.node(".timeline-row"));
});

test("obsolete schedules and notices never overwrite a newer landing", async (t) => {
  const slow = deferred(),
    oldNotice = deferred();
  let deferNotice = false;
  const p = await page(t, {
    handler: (url) =>
      url === "/api/display-data?landingId=2"
        ? slow.promise
        : deferNotice && url === "/api/override?landingId=1"
          ? oldNotice.promise
          : undefined,
  });
  deferNotice = true;
  p.run("loadManualOverride()");
  p.run("selectLanding(2)");
  await p.flush();
  p.run("selectLanding(3)");
  await p.flush();
  slow.resolve(schedule(2));
  oldNotice.resolve({ active: true, message: "Obsolete closure" });
  await p.flush();
  assert.equal(p.node("#landingName").textContent, "Landing 3");
  assert.equal(p.node("#manualOverride").hidden, true);
});

test("same-landing refresh preserves browsed date and open trip", async (t) => {
  const p = await page(t);
  p.run('viewDate = "2026-09-05"; openTripView("trip-0", "1", 36000)');
  await p.run("load(1)");
  await p.flush();
  assert.equal(p.run("viewDate"), "2026-09-05");
  assert.equal(p.run("tripView.tripId"), "trip-0");
  assert.equal(p.node("#tripMenu").hidden, false);
});

test("hidden pages remove polling timers and refresh immediately on return", async (t) => {
  for (const map of [false, true]) {
    const p = await page(t, { map });
    assert.ok(p.intervals.size);
    p.hide(true);
    const count = p.requests.length;
    await p.flush();
    assert.equal(p.intervals.size, 0);
    assert.equal(p.requests.length, count);
    p.hide(false);
    await p.flush();
    assert.ok(p.requests.length > count);
  }
});

test("map retains markers, roster focus, camera, search, selection and collapsed sheet across updates", async (t) => {
  const p = await page(t, { map: true });
  p.run('select("19", { recentre: false }); searchQuery = "opp"; renderList()');
  const marker = p.node(".boat"),
    row = p.node(".boat-row");
  row.focus();
  p.node("#sheetHandle").click();
  const camera = p.node("#chart").getAttribute("viewBox");
  await p.run("load()");
  await p.flush();
  assert.equal(p.node(".boat"), marker);
  assert.equal(p.node(".boat-row"), row);
  assert.equal(p.w.document.activeElement, row);
  assert.equal(p.node("#chart").getAttribute("viewBox"), camera);
  assert.equal(p.run("selectedId"), "19");
  assert.equal(p.run("searchQuery"), "opp");
  assert.equal(p.node("#bottomSheet").dataset.state, "peek");
});

test("map saved geometry and positions render before concurrent requests finish", async (t) => {
  const network = deferred();
  const p = await page(t, {
    map: true,
    stored: {
      "nyc-ferry-map-geometry": JSON.stringify(harbor),
      "nyc-ferry-map-positions": JSON.stringify({ boats: [boat] }),
    },
    handler: (url) => (url === "/api/boats" ? network.promise : undefined),
  });
  assert.ok(p.node(".boat"));
  assert.equal(p.node("#mapStatusText").textContent, "Saved");
  network.resolve({ available: true, boats: [boat] });
  await p.flush();
});

test("interrupted sheet closing cannot hide a reopened modal; focus is trapped and background inert", async (t) => {
  const p = await page(t);
  const animations = [];
  p.w.Element.prototype.animate = function () {
    const a = {
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(a);
    return a;
  };
  p.node("#themeButton").focus();
  p.run("setThemeOpen(true)");
  assert.equal(p.node(".content").inert, true);
  p.run("setThemeOpen(false)");
  const closing = animations.at(-1);
  p.run("setThemeOpen(true)");
  closing.onfinish();
  assert.equal(p.node("#themeMenu").hidden, false);
  assert.equal(closing.cancelled, true);
  const last = [...p.node("#themeMenu").querySelectorAll("button")].at(-1);
  last.focus();
  last.dispatchEvent(
    new p.w.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(p.w.document.activeElement, p.node("#themeMenuClose"));
  p.run("setThemeOpen(false)");
  animations.at(-1).onfinish();
  assert.equal(p.node(".content").inert, false);
  assert.equal(p.w.document.activeElement, p.node("#themeButton"));
});

test("keyed insertion and reordering preserve focused nodes and patch only changed fields", async (t) => {
  const p = await page(t);
  const host = p.w.document.createElement("div");
  p.w.document.body.append(host);
  const { html } = p.w.MobileRuntime;
  html(host, '<button data-key="a">A</button><button data-key="b">B</button>');
  const a = host.firstChild,
    b = host.lastChild;
  b.focus();
  html(
    host,
    '<button data-key="b">B updated</button><button data-key="c">C</button><button data-key="a">A</button>',
  );
  assert.equal(host.firstChild, b);
  assert.equal(host.lastChild, a);
  assert.equal(p.w.document.activeElement, b);
  assert.equal(b.textContent, "B updated");
  const mutations = [];
  const observer = new p.w.MutationObserver((records) =>
    mutations.push(...records),
  );
  observer.observe(host, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  html(
    host,
    '<button data-key="b">B updated</button><button data-key="c">C</button><button data-key="a">A</button>',
  );
  await p.flush();
  observer.disconnect();
  assert.equal(mutations.length, 0);
});

test("requests are deduplicated and aborted at the ten-second deadline", async (t) => {
  const p = await page(t);
  const deadlines = [];
  p.w.setTimeout = (callback, ms) => {
    deadlines.push({ callback, ms });
    return 1;
  };
  p.w.clearTimeout = () => {};
  let attempts = 0;
  p.w.fetch = (_url, { signal }) => {
    attempts++;
    return new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("timeout"))),
    );
  };
  const one = p.w.MobileRuntime.request("/slow"),
    two = p.w.MobileRuntime.request("/slow");
  assert.equal(one, two);
  assert.equal(attempts, 1);
  assert.equal(deadlines[0].ms, 10000);
  const failed = assert.rejects(one, /timeout/);
  deadlines[0].callback();
  await failed;
});

test("ordinary clock ticks do not render or announce the departure list", async (t) => {
  const p = await page(t);
  const mutations = [];
  const observer = new p.w.MutationObserver((records) =>
    mutations.push(...records),
  );
  observer.observe(p.node("#departures"), {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  p.run("updateClock()");
  await p.flush();
  observer.disconnect();
  assert.equal(mutations.length, 0);
  assert.equal(p.node("#boardAnnouncement").textContent, "");
});

test("reduced motion closes panels immediately and docked navigation remains nonmodal", async (t) => {
  const p = await page(t);
  p.w.matchMedia = () => ({ matches: true });
  let animations = 0;
  p.w.Element.prototype.animate = () => {
    animations++;
  };
  p.run("setThemeOpen(true); setThemeOpen(false)");
  assert.equal(animations, 0);
  assert.equal(p.node("#themeMenu").hidden, true);
  p.w.MobileRuntime.panel(p.node("#landingMenu"), true, false);
  assert.equal(p.node(".content").inert, false);
  assert.equal(p.node("#landingMenuPanel").hasAttribute("aria-modal"), false);
});

test("quota failures keep new preferences usable for the current session", async (t) => {
  const p = await page(t, { stored: { preference: "old" } });
  p.w.Storage.prototype.setItem = () => {
    throw new Error("quota exceeded");
  };
  p.w.Storage.prototype.removeItem = () => {
    throw new Error("storage denied");
  };
  const { storage } = p.w.MobileRuntime;
  storage.setItem("preference", "new");
  assert.equal(storage.getItem("preference"), "new");
  storage.removeItem("preference");
  assert.equal(storage.getItem("preference"), null);
});

test("service-worker snapshots cannot be presented as fresh realtime data", async (t) => {
  const p = await page(t);
  p.w.fetch = async () => ({
    ok: true,
    headers: { get: () => "1" },
    text: async () => '{"available":true,"stale":false,"boats":[]}',
  });
  const response = await p.w.MobileRuntime.request("/saved");
  assert.equal(response.saved, true);
  assert.equal((await response.json()).stale, true);
});

test("a marine detail card remains selected across vessel updates", async (t) => {
  const p = await page(t, { map: true });
  p.run(
    'select("19", { recentre: false }); showSeamarkCard({ name: "Harbor light", type: "light" })',
  );
  await p.run("load()");
  await p.flush();
  assert.equal(p.run("detailKind"), "seamark");
  assert.equal(p.node("#seamarkCard").hidden, false);
  assert.equal(p.node("#vesselCard").hidden, true);
});

test("unchanged service notices do not repeatedly announce their text", async (t) => {
  const p = await page(t);
  p.run(
    'manualOverride = { active: true, message: "Use the alternate pier", updatedAt: "2026-09-04T13:00:00Z" }; renderManualOverride()',
  );
  const records = [];
  const observer = new p.w.MutationObserver((changes) =>
    records.push(...changes),
  );
  observer.observe(p.node("#manualOverride"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  p.run("renderManualOverride()");
  await p.flush();
  observer.disconnect();
  assert.equal(records.length, 0);
});

test('the app follows visible viewport changes and leaves pinch zoom alone', async t => {
  const p = await page(t);
  const viewport = new p.w.EventTarget();
  Object.assign(viewport, { height: 780, offsetTop: 0, scale: 1 });
  Object.defineProperty(p.w, 'visualViewport', { value: viewport, configurable: true });
  p.w.dispatchEvent(new p.w.Event('resize'));
  const style = p.w.document.documentElement.style;
  assert.equal(style.getPropertyValue('--app-viewport-height'), '780px');
  Object.assign(viewport, { height: 400, offsetTop: 20 });
  p.w.dispatchEvent(new p.w.Event('resize'));
  assert.equal(style.getPropertyValue('--app-viewport-height'), '400px');
  assert.equal(style.getPropertyValue('--app-viewport-top'), '20px');
  Object.assign(viewport, { height: 200, scale: 2 });
  p.w.dispatchEvent(new p.w.Event('resize'));
  assert.equal(style.getPropertyValue('--app-viewport-height'), '400px');
});

test('installed board and map ignore short iOS viewport metrics until the keyboard opens', async t => {
  for (const map of [false, true]) {
    const p = await page(t, { map });
    const root = p.w.document.documentElement;
    // Root-mounted maps are still app surfaces; the root departure board is a kiosk.
    if (map) root.dataset.surface = 'kiosk';
    Object.defineProperty(p.w.navigator, 'standalone', { value: true });
    Object.defineProperty(p.w, 'innerHeight', { value: 797, configurable: true });
    let fullHeight = 844;
    p.w.HTMLElement.prototype.getBoundingClientRect = function () {
      return { height: this.style.height === '100vh' ? fullHeight : 0 };
    };
    const viewport = new p.w.EventTarget();
    Object.assign(viewport, { height: 797, offsetTop: 47, scale: 1 });
    Object.defineProperty(p.w, 'visualViewport', { value: viewport });
    const resize = (values) => {
      Object.assign(viewport, values);
      p.w.dispatchEvent(new p.w.Event('resize'));
    };
    resize({});
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '100vh');
    assert.equal(root.style.getPropertyValue('--app-viewport-top'), '0px');
    // Both safe areas omitted, and a focused search with a hardware keyboard: still full height.
    p.node(map ? '#boatSearch' : '#landingSearch').focus();
    resize({ height: 763 });
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '100vh');
    assert.equal(root.dataset.keyboard, 'closed');
    resize({ height: 400, offsetTop: 20 });
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '400px');
    assert.equal(root.style.getPropertyValue('--app-viewport-top'), '20px');
    assert.equal(root.dataset.keyboard, 'open');
    p.w.document.activeElement.blur();
    resize({});
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '400px');
    resize({ height: 797, offsetTop: 0 });
    assert.equal(root.dataset.keyboard, 'closed');
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '100vh');
    resize({ height: 400, scale: 2 });
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '100vh');
    // Rotation changes CSS vh directly; a stale portrait reading must not get frozen in pixels.
    fullHeight = 390;
    resize({ height: 369, scale: 1 });
    assert.equal(root.dataset.keyboard, 'closed');
    assert.equal(root.style.getPropertyValue('--app-viewport-height'), '100vh');
  }
});

test('installed display media queries work without navigator.standalone and leave the kiosk alone', async t => {
  const p = await page(t);
  p.w.matchMedia = query => ({ matches: query.includes('display-mode: fullscreen') });
  p.w.dispatchEvent(new p.w.Event('resize'));
  const root = p.w.document.documentElement;
  assert.equal(root.style.getPropertyValue('--app-viewport-height'), '100vh');
  root.dataset.surface = 'kiosk';
  root.style.removeProperty('--app-viewport-height');
  p.w.dispatchEvent(new p.w.Event('resize'));
  assert.equal(root.style.getPropertyValue('--app-viewport-height'), '');
});

test('a departure boat link starts with the vessel sheet collapsed', async t => {
  const p = await page(t, { map: true, query: '?boat=Opportunity' });
  assert.equal(p.node('#bottomSheet').dataset.state, 'peek');
  assert.equal(p.node('#sheetHandle').getAttribute('aria-expanded'), 'false');
  assert.equal(p.run('selectedId'), '19');
});

test('pan deltas remain stable across queued frames and cancellation never starts inertia', async t => {
  const p = await page(t, { map: true });
  const chart = p.node('#chart');
  p.w.DOMPoint = class {
    constructor(x,y) { this.x=x; this.y=y; }
    matrixTransform(matrix) { return matrix.transform(this); }
  };
  chart.getScreenCTM = () => {
    const [x,y,width] = chart.getAttribute('viewBox').split(' ').map(Number);
    return { inverse: () => ({ transform: point => ({ x:x+point.x*width/390, y:y+point.y*width/390 }) }) };
  };
  chart.setPointerCapture = () => {};
  p.run('setView({x:base.width/3,y:base.height/3,width:base.width/3})'); await p.flush();
  const start = p.run('view.x');
  const unit = Number(chart.getAttribute('viewBox').split(' ')[2])/390;
  const fire = (type,x) => { const e = new p.w.Event(type); Object.assign(e,{pointerId:1,clientX:x,clientY:150}); chart.dispatchEvent(e); };
  fire('pointerdown',100);
  fire('pointermove',110); fire('pointermove',120);
  assert.ok(Math.abs(p.run('view.x')-(start-20*unit))<.01);
  await p.flush(); fire('pointermove',130);
  assert.ok(Math.abs(p.run('view.x')-(start-30*unit))<.01);
  fire('pointercancel',130); fire('lostpointercapture',130);
  assert.equal(p.run('cameraAnimation'),null);
});
