const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const os = require("os");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
// One definition of where the application server is, shared with the other checks — this script
// honoured MOBILE_TEST_ORIGIN and the other two hardcoded the port, so the variable moved one of
// the three.
const { ORIGIN } = require("./mobile-check-harness.cjs");
const root = process.cwd();
(async () => {
  const baselineRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "mobile-baseline-"),
  );
  execFileSync("git", [
    "archive",
    process.env.MOBILE_BASELINE_REF || "1a97588",
    "public",
    "-o",
    path.join(baselineRoot, "source.tar"),
  ]);
  execFileSync("tar", [
    "-xf",
    path.join(baselineRoot, "source.tar"),
    "-C",
    baselineRoot,
  ]);
  await fs.mkdir("docs/mobile-upgrade", { recursive: true });
  const fixture = new Map();
  for (const url of [
    "/api/display-data?landingId=17",
    "/api/display-data?landingId=16",
    "/api/landings",
    "/api/map",
    "/api/boats",
  ]) {
    const r = await fetch(ORIGIN + url);
    fixture.set(url, await r.text());
  }
  const vessel = {
    id: "19",
    name: "Opportunity",
    number: "H-204",
    latitude: 40.72,
    longitude: -73.99,
    status: "in-transit",
    routeId: "ER",
    route: "ER",
    color: "#00839c",
    speedKnots: 12,
    ageSeconds: 10,
  };
  fixture.set(
    "/api/boats",
    JSON.stringify({
      available: true,
      stale: false,
      fetchedAt: "2026-09-04T14:00:00Z",
      boats: [vessel],
    }),
  );
  let baseline = true;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let pathname = url.pathname;
      if (pathname.startsWith("/api/")) {
        await new Promise((r) => setTimeout(r, 500));
        res.setHeader("Content-Type", "application/json");
        let payload = fixture.get(req.url) || fixture.get(pathname);
        if (!payload)
          payload = JSON.stringify(
            pathname === "/api/realtime"
              ? { available: true, stale: false, updates: [], vehicles: [] }
              : pathname === "/api/alerts"
                ? { available: true, alerts: [] }
                : pathname === "/api/display-data"
                  ? JSON.parse(fixture.get("/api/display-data?landingId=17"))
                  : { active: false, entries: [] },
          );
        res.end(payload);
        return;
      }
      if (pathname === "/ferryTimesMobile/" || pathname === "/")
        pathname = "/index.html";
      if (pathname === "/ferryTimesMobile/map" || pathname === "/map")
        pathname = "/map.html";
      const ext = path.extname(pathname);
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".html": "text/html",
          ".css": "text/css",
          ".json": "application/json",
          ".woff2": "font/woff2",
          ".png": "image/png",
        }[ext] || "application/octet-stream",
      );
      res.end(
        await fs.readFile(
          path.join(
            baseline ? baselineRoot + "/public" : root + "/public",
            pathname,
          ),
        ),
      );
    } catch (e) {
      res.statusCode = 404;
      res.end("Missing");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const mode of ["baseline", "after"]) {
    baseline = mode === "baseline";
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const Real = Date;
      window.Date = class extends Real {
        constructor(...args) {
          super(...(args.length ? args : ["2026-09-04T14:00:00Z"]));
        }
        static now() {
          return +new Real("2026-09-04T14:00:00Z");
        }
      };
      localStorage.setItem("nyc-ferry-did-selected-landing", "17");
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    let start = performance.now();
    await page.goto(origin + "/ferryTimesMobile/");
    await page.waitForSelector(".timeline-row");
    const cold = Math.round(performance.now() - start);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `docs/mobile-upgrade/${mode}-board.png` });
    start = performance.now();
    await page.reload();
    await page.waitForSelector(".timeline-row");
    const cached = Math.round(performance.now() - start);
    await page.waitForTimeout(1000);
    const update = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll(".timeline-row")];
      let mutations = 0;
      const observer = new MutationObserver(
        (records) => (mutations += records.length),
      );
      observer.observe(document.querySelector("#departures"), {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      window.__rows = rows;
      window.__observer = observer;
      window.__mutations = () => mutations;
      return rows.length;
    });
    await page.waitForTimeout(15500);
    const refresh = await page.evaluate(() => {
      __observer.disconnect();
      return {
        cards: __rows.length,
        retained: __rows.filter((n) => n.isConnected).length,
        mutations: __mutations(),
      };
    });
    await page.locator("#departures").evaluate((e) => (e.scrollTop = 500));
    const drawerFeedbackMs = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const start = performance.now();
          document.querySelector("#menuButton").click();
          requestAnimationFrame(() =>
            resolve(Math.round(performance.now() - start)),
          );
        }),
    );
    await page.locator('[data-landing-id="16"]').click();
    await page.waitForTimeout(1200);
    await page.goto(origin + "/map");
    await page.waitForSelector(".boat");
    const cameraFrames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const gaps = [];
          let last = performance.now();
          document.querySelector("#zoomIn").click();
          function frame(now) {
            gaps.push(now - last);
            last = now;
            if (gaps.length < 24) requestAnimationFrame(frame);
            else {
              gaps.sort((a, b) => a - b);
              resolve({
                medianMs: +gaps[12].toFixed(1),
                p95Ms: +gaps[22].toFixed(1),
              });
            }
          }
          requestAnimationFrame(frame);
        }),
    );
    await page.screenshot({ path: `docs/mobile-upgrade/${mode}-map.png` });
    await ctx.tracing.stop({ path: `/tmp/mobile-${mode}-trace.zip` });
    results.push({
      mode,
      coldMs: cold,
      cachedMs: cached,
      drawerFeedbackMs,
      cameraFrames,
      refresh,
      errors,
    });
    await ctx.close();
  }
  console.log(JSON.stringify(results, null, 2));
  await fs.writeFile(
    "docs/mobile-upgrade/browser-results.json",
    JSON.stringify(results, null, 2) + "\n",
  ); // Responsive/theme matrix against the upgraded page, with no fixture changes.
  const matrix = [];
  const check = await browser.newContext({ serviceWorkers: "block" });
  const tab = await check.newPage();
  await tab.addInitScript(() => {
    localStorage.setItem("nyc-ferry-did-selected-landing", "17");
    const Real = Date;
    window.Date = class extends Real {
      constructor(...args) {
        super(...(args.length ? args : ["2026-09-04T14:00:00Z"]));
      }
      static now() {
        return +new Real("2026-09-04T14:00:00Z");
      }
    };
  });
  for (const route of ["/ferryTimesMobile/", "/map"]) {
    await tab.goto(origin + route);
    await tab.waitForSelector(route === "/map" ? ".boat" : ".timeline-row");
    for (const size of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await tab.setViewportSize(size);
      for (const theme of [
        "nyc-ferry",
        "night",
        "hello-kitty",
        "cinnamoroll",
        "pompompurin",
        "kuromi",
        "windows-xp",
        "hacker",
        "burger-king",
      ]) {
        await tab.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        const bounds = await tab.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          nav: [...document.querySelectorAll(".product-nav a")].map((a) => ({
            name: a.textContent.trim(),
            width: a.getBoundingClientRect().width,
            height: a.getBoundingClientRect().height,
          })),
          clipped: [
            ...document.querySelectorAll(
              ".tl-dest,.tl-status,.departure-last-slot",
            ),
          ].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
        }));
        matrix.push({ route, ...size, theme, ...bounds });
      }
    }
  }
  await fs.writeFile(
    "docs/mobile-upgrade/browser-matrix.json",
    JSON.stringify(matrix, null, 2) + "\n",
  );
  const failures = matrix.filter(
    (result) =>
      result.scroll > result.width ||
      result.clipped ||
      result.nav.some((link) => link.width < 44 || link.height < 44),
  );
  if (failures.length)
    throw new Error(
      `${failures.length} responsive checks failed; see browser-matrix.json`,
    );
  if (results.some((result) => result.errors.length))
    throw new Error("Browser script errors; see browser-results.json");
  console.log(`${matrix.length} responsive/theme checks passed`);
  await check.close();
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
