const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { serve, ARTIFACTS } = require("./mobile-check-harness.cjs");
const fixture = require("./map-browser-fixture.cjs");
const fs = require("node:fs/promises");

(async () => {
  const { harbor, positions } = await fixture();
  const { buildDisplayData } = await import("../lib/schedule-builder.js");
  const schedule = await buildDisplayData({ landingNumber: 16 });
  const site = await serve({ api: {
    "/api/map": harbor, "/api/boats": positions, "/api/display-data": schedule,
    "/api/landings": { landings: [] }, "/api/alerts": { available: true, alerts: [] },
    "/api/realtime": { stale: true, updates: [], vehicles: [] }, "/api/changelog": { entries: [] }
  } });
  const browser = await chromium.launch();
  try {
    await fs.mkdir(ARTIFACTS, { recursive: true });
    for (const width of [320, 390, 820, 821, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: width === 1440 ? "no-preference" : "reduce", serviceWorkers: "allow" });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(site.origin + "/map");
      await page.waitForSelector("#chart .boat");
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const camera = await page.locator("#chart").getAttribute("viewBox");
      const closed = () => page.waitForSelector("#mapRouteMenu", { state: "hidden" });
      const open = async () => {
        await page.locator("#mapMenuButton").click();
        assert.equal(await page.locator("#mapRouteMenu").isVisible(), true);
        assert.equal(await page.locator(".app-header").evaluate(n => n.inert), true);
        assert.equal(await page.locator("#mapFrame").evaluate(n => n.inert), true);
      };
      await open();
      assert.ok(await page.locator("#routeFilterBar").evaluate(n => n.contains(document.activeElement)));
      await page.locator("#mapRouteClose").focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.locator(".route-filter-pill").last().evaluate(n => n === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#mapRouteClose").evaluate(n => n === document.activeElement), true);
      const choice = page.locator(".route-filter-pill").nth(1);
      const name = await choice.locator(".pill-name").innerText();
      await choice.click();
      await closed();
      assert.equal(await page.locator("#mapRouteMenu").isVisible(), false);
      assert.equal(await page.locator("#mapScope").innerText(), name);
      assert.equal(await page.locator("#mapMenuButton").evaluate(n => n === document.activeElement), true);
      assert.equal(await page.locator("#chart").getAttribute("viewBox"), camera);
      await open();
      await page.keyboard.press("Escape");
      await closed();
      assert.equal(await page.locator(".app-header").evaluate(n => n.inert), false);
      await open();
      await page.locator("#mapRouteScrim").click({ position: { x: width - 2, y: 100 } });
      await closed();
      assert.equal(await page.locator("#mapRouteMenu").isVisible(), false);
      await open();
      // Programmatic history navigation must release the modal without focusing the hidden trigger.
      await page.evaluate(() => { history.pushState(null, "", "/"); dispatchEvent(new PopStateEvent("popstate")); });
      await page.waitForSelector("#boardView:not([hidden])");
      assert.equal(await page.locator(".app-header").evaluate(n => n.inert), false);
      await page.locator("#mapButton").click();
      assert.equal(await page.locator("#mapRouteMenu").isVisible(), false);
      assert.equal(await page.locator("#mapScope").innerText(), name);
      await context.setOffline(true);
      await open();
      await page.locator('.route-filter-pill[aria-pressed="true"]').click();
      await closed();
      assert.equal(await page.locator("#mapScope").innerText(), "The whole harbor");
      await open();
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: ARTIFACTS + "/map-drawer-" + width + ".png" });
      await page.locator("#mapRouteClose").click();
      await closed();
      assert.deepEqual(errors, []);
      await context.close();
      console.log("Map drawer " + width + ": keyboard, filters, navigation and offline ok");
    }
  } finally { await browser.close(); await site.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
