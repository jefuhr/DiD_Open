const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { serve, fromApp } = require("./mobile-check-harness.cjs");

async function main() {
  const [pier11, midtown, landings, harbor] = await Promise.all([
    "/api/display-data?landingId=16", "/api/display-data?landingId=26", "/api/landings", "/api/map"
  ].map(async path => JSON.parse(await fromApp(path))));
  const site = await serve({
    headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'" },
    api: {
      "/api/display-data": url => url.searchParams.get("landingId") === "26" ? midtown : pier11,
      "/api/landings": landings,
      "/api/realtime": { available: false, stale: true, updates: [], vehicles: [] },
      "/api/alerts": { available: true, stale: false, alerts: [] },
      "/api/changelog": { entries: [] },
      "/api/boats": { available: true, stale: false, boats: [] },
      "/api/map": harbor,
      "/api/connections": url => ({
        tripId: url.searchParams.get("tripId"), stale: true,
        stops: (pier11.tripSchedules[url.searchParams.get("tripId")]?.stops || []).map(stop => ({ ...stop, connections: [] }))
      })
    }
  });
  let browser;
  try {
    browser = await chromium.launch();
    for (const base of ["/", "/ferryTimesMobile/"]) {
      for (const width of [390, 768, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "allow" });
        const page = await context.newPage();
        const errors = [], notices = [];
        let navigations = 0;
        page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
        page.on("pageerror", error => errors.push(error.message));
        page.on("request", request => { if (request.url().includes("/api/override")) notices.push(request.url()); });
        await page.addInitScript(() => {
          const RealDate = Date;
          globalThis.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : ["2026-09-20T14:00:00Z"])); }
            static now() { return new RealDate("2026-09-20T14:00:00Z").getTime(); }
          };
          if (!localStorage.getItem("nyc-ferry-did-selected-landing")) localStorage.setItem("nyc-ferry-did-selected-landing", "16");
          localStorage.setItem("nyc-ferry-did-theme", "hello-kitty");
          localStorage.setItem("nyc-ferry-did-landing-rail", "hidden");
        });
        await page.goto(site.origin + base);
        await page.waitForSelector(".timeline-row");
        assert.equal(await page.locator("html").getAttribute("data-theme"), "hello-kitty");
        await page.evaluate(async () => { await navigator.serviceWorker.ready; });
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
        assert.equal(await page.evaluate(() => document.querySelector("#boardView").classList.contains("sidebar-docked")), width >= 821);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.locator(".timeline-row[data-trip-id]").first().click();
        await page.waitForSelector("#tripMenu:not([hidden])");
        await page.locator("#tripMenuClose").click();
        if (width < 821) await page.locator("#menuButton").click();
        else {
          assert.equal(await page.locator("#menuButton").isVisible(), false);
          assert.equal(await page.locator("#landingMenuClose").isVisible(), false);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#landingMenu").isVisible(), true);
        }
        await page.locator('[data-landing-id="26"]').first().click();
        await page.waitForFunction(() => document.querySelector("#landingName").textContent.includes("79"));
        const headerBox = await page.locator(".app-header .product-nav").boundingBox();
        const assertSharedHeading = async selector => {
          const title = page.locator(selector);
          const box = await title.boundingBox();
          const bar = await page.locator(".app-header").boundingBox();
          assert.ok(box.x + box.width <= headerBox.x, "navigation stays to the right of the title");
          assert.ok(box.y >= bar.y && box.y + box.height <= bar.y + bar.height, "title belongs to the same header bar");
          assert.ok(await title.evaluate(node => {
            const box = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }), "title must not be covered by the shared header background");
        };
        await assertSharedHeading("#landingName");
        await page.locator("#dateNext").click();
        await page.waitForFunction(() => document.querySelector("#dateCurrent").textContent === "Tomorrow");
        const retainedDate = await page.locator("#dateCurrent").textContent();
        const scroll = await page.locator("#departures").evaluate(node => { node.scrollTop = 250; return node.scrollTop; });
        const documentsBefore = navigations;
        await page.locator("#mapButton").click();
        await page.waitForSelector("#chart path");
        assert.deepEqual(await page.locator(".app-header .product-nav").boundingBox(), headerBox);
        assert.equal(await page.locator(".map-heading h1").textContent(), "Map");
        assert.equal(await page.locator(".map-heading .eyebrow").count(), 0);
        await assertSharedHeading(".map-heading h1");
        await page.locator("#boatSearch").fill("retained search");
        // Use reduced motion for deterministic camera assertions; the dedicated drag suite tests easing.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.locator("#zoomIn").click();
        await page.waitForTimeout(40);
        const camera = await page.locator("#chart").getAttribute("viewBox");
        await page.evaluate(() => { window.retainedGeometry = document.querySelector("#chart").firstChild; });
        await page.locator("#boardButton").click();
        assert.equal(await page.locator("#dateCurrent").textContent(), retainedDate);
        assert.equal(await page.locator("#departures").evaluate(node => node.scrollTop), scroll);
        assert.deepEqual(await page.locator(".app-header .product-nav").boundingBox(), headerBox);
        const durations = await page.evaluate(() => {
          const durations = [];
          for (let i = 0; i < 6; i++) {
            const view = i % 2 === 0 ? "map" : "board";
            const start = performance.now();
            document.querySelector("#" + view + "Button").click();
            const root = document.querySelector("#" + view + "View");
            if (root.hidden || root.inert || getComputedStyle(root).display === "none") throw new Error("Switch waited for asynchronous work");
            durations.push(performance.now() - start);
          }
          return durations;
        });
        assert.ok(Math.max(...durations) < 100, "warmed switches exceed 100ms: " + durations);
        await page.locator("#mapButton").click();
        assert.equal(await page.locator("#boatSearch").inputValue(), "retained search");
        assert.equal(await page.locator("#chart").getAttribute("viewBox"), camera);
        assert.ok(await page.evaluate(() => window.retainedGeometry === document.querySelector("#chart").firstChild));
        await page.goBack();
        await page.waitForSelector("#boardView:not([hidden])");
        await page.goForward();
        await page.waitForSelector("#mapView:not([hidden])");
        assert.equal(navigations, documentsBefore, "switches must not navigate the document");

        // A map-to-board explicit link overrides the retained landing without resetting the shell.
        await page.evaluate(base => {
          const link = document.createElement("a");
          link.href = base + "?landing=16";
          document.querySelector("#mapView").append(link);
          link.click();
          link.remove();
        }, base);
        await page.waitForFunction(() => document.querySelector("#landingName").textContent.includes("11"));
        assert.equal(navigations, documentsBefore);
        // Resizing down always closes the drawer; resizing up always restores the permanent rail.
        await page.setViewportSize({ width: 821, height: 900 });
        await page.waitForFunction(() => document.querySelector("#boardView").classList.contains("sidebar-docked"));
        assert.equal(await page.locator("#menuButton").isVisible(), false);
        assert.equal(await page.locator("#landingMenu").isVisible(), true);
        await page.setViewportSize({ width: 820, height: 900 });
        await page.waitForFunction(() => !document.querySelector("#boardView").classList.contains("sidebar-docked"));
        await page.waitForFunction(() => document.querySelector("#landingMenu").hidden);
        assert.equal(await page.locator("#menuButton").isVisible(), true);
        await page.locator("#menuButton").click();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("#landingMenu").hidden);
        assert.equal(await page.evaluate(() => document.activeElement.id), "menuButton");
        await page.setViewportSize({ width, height: 900 });

        await context.setOffline(true);
        await page.locator("#mapButton").click();
        await page.waitForSelector("#chart path");
        await page.locator("#boardButton").click();
        await page.waitForSelector(".timeline-row");
        await page.reload();
        await page.waitForSelector(".timeline-row");
        assert.ok((await page.locator("#landingName").textContent()).includes("11"));
        await page.goto(site.origin + base + "map.html?boat=Missing");
        await page.waitForSelector("#chart path");
        assert.equal(await page.locator("#mapButton").getAttribute("aria-current"), "page");
        console.log("  warmed switch max: " + Math.max(...durations).toFixed(1) + "ms");
        assert.deepEqual(errors, []);
        assert.deepEqual(notices, []);
        await context.close();
        console.log(`staff app: ${base} at ${width}px, CSP and offline modules ok`);
      }
    }
  } finally {
    await browser?.close();
    await site.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
