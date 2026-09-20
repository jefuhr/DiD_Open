const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { serve, ARTIFACTS } = require("./mobile-check-harness.cjs");
const fixture = require("./map-browser-fixture.cjs");

async function main() {
  const { buildDisplayData } = await import("../lib/schedule-builder.js");
  const { THEMES } = await import("../public/assets/preferences.js");
  const schedule = await buildDisplayData({ landingNumber: 30 });
  const { harbor, positions } = await fixture();
  positions.boats[0].name = "Spirit of New York / Long vessel name";
  let feed = positions;
  const site = await serve({ api: {
    "/api/display-data": schedule,
    "/api/landings": { landings: [{ id: 30, displayName: schedule.meta.landing.displayName }] },
    "/api/map": harbor, "/api/boats": () => feed,
    "/api/realtime": { available: false, stale: true, updates: [], vehicles: [] },
    "/api/alerts": { available: true, alerts: [] }, "/api/changelog": { entries: [] }
  } });
  let browser;
  const results = [];
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const Real = Date;
      globalThis.Date = class extends Real {
        constructor(...args) { super(...(args.length ? args : ["2026-09-20T14:00:00Z"])); }
        static now() { return +new Real("2026-09-20T14:00:00Z"); }
      };
    });
    await page.goto(site.origin);
    await page.waitForSelector(".timeline-row");
    await page.locator("#mapButton").click();
    await page.waitForSelector(".boat-row");
    await fs.mkdir(ARTIFACTS, { recursive: true });
    for (const { id: theme } of THEMES) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [320, 390, 768, 820, 821, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        let navigationBox, titleFont;
        for (const view of ["board", "map"]) {
          await page.locator("#" + view + "Button").click();
          await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
          const result = await page.evaluate(view => {
            const rect = node => {
              const b = node.getBoundingClientRect();
              return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
            };
            const visible = node => !!node.getClientRects().length;
            const title = document.querySelector(view === "board" ? "#landingName" : "#mapTitle");
            const nav = document.querySelector(".product-nav");
            const header = document.querySelector(".app-header");
            const titleBox = rect(title);
            const hit = document.elementFromPoint(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
            const navStyle = getComputedStyle(nav.querySelector("a"));
            const titleStyle = getComputedStyle(title);
            const controls = [...document.querySelectorAll(view === "map"
              ? ".route-filter-pill, .map-tools button, #boatSearch, .card-close, .card-action-btn, .sheet-handle-zone"
              : "#menuButton, #nearestButton, .filter-button, .clock-toggle")].filter(visible);
            const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const luminance = color => rgb(color).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
              .reduce((a, c, i) => a + c * [.2126, .7152, .0722][i], 0);
            const textSurfaces = [...document.querySelectorAll(".product-nav a, .app-header .status, .route-filter-pill")].filter(visible);
            return {
              nav: rect(nav), header: rect(header), title: titleBox, hit: title.contains(hit),
              overflow: document.documentElement.scrollWidth > innerWidth,
              titleFont: [titleStyle.fontFamily, titleStyle.fontSize, titleStyle.fontWeight],
              controls: controls.map(node => {
                const style = getComputedStyle(node);
                return { name: node.id || node.className, font: style.fontFamily, expected: navStyle.fontFamily, height: rect(node).height };
              }),
              textFonts: view === "map" ? [...document.querySelectorAll(".pill-name, .boat-name, .boat-doing, .fleet-description")].filter(visible)
                .map(node => ({ name: node.className, font: getComputedStyle(node).fontFamily, expected: navStyle.fontFamily })) : [],
              contrasts: textSurfaces.map(node => {
                const style = getComputedStyle(node), a = luminance(style.color), b = luminance(style.backgroundColor);
                return { name: node.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
              })
            };
          }, view);
          const label = theme + " / " + width + " / " + view;
          assert.equal(result.overflow, false, label + " overflow");
          assert.ok(result.nav.right >= width - 17 && result.nav.right <= width - 11, label + " navigation not right-aligned");
          assert.ok(result.title.right < result.nav.x, label + " title overlaps navigation");
          assert.ok(result.hit, label + " title occluded");
          assert.ok(result.title.bottom <= result.header.bottom, label + " title outside header");
          for (const control of result.controls) {
            assert.equal(control.font, control.expected, label + " mismatched font: " + control.name);
            assert.ok(control.height >= 44, label + " small target: " + control.name);
          }
          for (const text of result.textFonts) assert.equal(text.font, text.expected, label + " mismatched text font: " + text.name);
          for (const contrast of result.contrasts) assert.ok(contrast.ratio >= 4.5, label + " contrast: " + JSON.stringify(contrast));
          if (navigationBox) {
            assert.deepEqual(result.nav, navigationBox, label + " navigation shifted between views");
            assert.deepEqual(result.titleFont, titleFont, label + " title typography differs");
          } else { navigationBox = result.nav; titleFont = result.titleFont; }
          results.push({ theme, width, view, nav: result.nav });
          if ([390, 1440].includes(width)) await page.screenshot({ path: ARTIFACTS + "/polish-" + theme + "-" + width + "-" + view + ".png" });
          if (view === "map") {
            await page.locator("#mapMenuButton").click();
            const choices = await page.locator(".route-filter-pill").evaluateAll(nodes => nodes.map(node => ({
              height: node.getBoundingClientRect().height,
              font: getComputedStyle(node).fontFamily,
              nameVisible: !node.querySelector(".pill-name") || getComputedStyle(node.querySelector(".pill-name")).display !== "none"
            })));
            assert.ok(choices.length > 1, label + " routes loaded");
            for (const choice of choices) {
              assert.ok(choice.height >= 44, label + " route target too small");
              assert.equal(choice.font, result.controls[0].expected);
              assert.equal(choice.nameVisible, true, label + " full route name hidden");
            }
            await page.keyboard.press("Escape");
          }
        }
      }
    }
    // Cards, focus, and enlarged text use the same controls as the normal map.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "nyc-ferry"; });
    await page.locator(".boat-row").first().click();
    await page.waitForSelector("#vesselCard:not([hidden])");
    await page.screenshot({ path: ARTIFACTS + "/polish-selected-vessel-phone.png" });
    const title = await page.locator("#vesselCard .card-title-row").boundingBox();
    const close = await page.locator("#vesselCard .card-close").boundingBox();
    assert.ok(title.x + title.width <= close.x + close.width, "card title clearance");
    await page.locator("#vesselCard .card-action-btn").focus();
    const cardAction = await page.locator("#vesselCard .card-action-btn").evaluate(node => {
      const action = node.getBoundingClientRect();
      const card = node.closest("#vesselCard").getBoundingClientRect();
      return { reachable: action.top >= card.top && action.bottom <= card.bottom, pageScroll: window.scrollY };
    });
    assert.ok(cardAction.reachable, "long vessel card scrolls to its Board action");
    assert.equal(cardAction.pageScroll, 0, "card focus does not scroll the document");
    await page.keyboard.press("Tab");
    await page.locator("#vesselCard .card-close").focus();
    assert.equal(await page.locator("#vesselCard .card-close").evaluate(node => getComputedStyle(node).outlineStyle), "solid");
    await page.keyboard.press("Enter");
    await page.locator("#boatSearch").fill("no vessel matches this");
    await page.waitForSelector("#boats .empty");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    assert.ok(await page.locator("#mapButton").evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 26), "control text actually enlarges");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "enlarged text overflow");
    await page.screenshot({ path: ARTIFACTS + "/polish-text-200.png" });
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.locator("#boatSearch").fill("");
    feed = { available: false, stale: true, boats: [] };
    await page.locator("#boardButton").click();
    await page.locator("#mapButton").click();
    await page.waitForSelector("#boats .empty-title");
    await page.screenshot({ path: ARTIFACTS + "/polish-empty-saved.png" });
    assert.deepEqual(errors, []);
    await fs.writeFile(ARTIFACTS + "/visual-polish-checks.json", JSON.stringify(results, null, 2));
    console.log(results.length + " theme/layout/style/contrast checks passed; cards, focus, empty states, and enlarged text checked.");
  } finally { await browser?.close(); await site.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
