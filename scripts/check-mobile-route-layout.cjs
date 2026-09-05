// Route cards, across every viewport and text size a phone can be set to.
//
// A scrolling flex column will happily shrink its children to fit, which clips the bottom off a
// route card without overflowing anything — so the page looks fine and the last departure is gone.
// This measures scrollHeight against clientHeight on every card at fifteen combinations of size
// and Dynamic Type, and checks the board still ends exactly at the visible viewport.
//
// Needs Chromium and an application server. See docs/mobile-upgrade/README.md.
const assert = require("assert");
const { main } = require("./mobile-check-harness.cjs");

const SIZES = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 }
];
const TEXT_SIZES = [16, 20, 24];
const FROZEN_NOW = "2026-09-04T14:00:00Z";

main("route layout", {}, async ({ page, site, save, shot }) => {
  await page.addInitScript((now) => {
    localStorage.setItem("nyc-ferry-did-theme", "pompompurin");
    localStorage.setItem("nyc-ferry-did-selected-landing", "16");
    localStorage.setItem("nyc-ferry-did-sort", "route");
    // A fixed clock, so a card that fits at ten past does not fail the run at quarter past.
    const Real = Date;
    globalThis.Date = class extends Real {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return +new Real(now); }
    };
  }, FROZEN_NOW);

  await page.goto(`${site.origin}/ferryTimesMobile/`);
  await page.waitForSelector("[data-view=routes] .departure");
  await shot("route-cards-fixed.png");

  const checks = [];
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const font of TEXT_SIZES) {
      await page.evaluate((px) => { document.documentElement.style.fontSize = `${px}px`; }, font);
      await page.waitForTimeout(50);
      const values = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        bottom: document.querySelector("#serviceAlerts").getBoundingClientRect().bottom,
        viewport: visualViewport.height,
        clipped: [...document.querySelectorAll("[data-view=routes] > .departure")]
          .filter((card) => card.scrollHeight > card.clientHeight + 2).length,
        cards: document.querySelectorAll("[data-view=routes] > .departure").length,
        nav: [...document.querySelectorAll(".product-nav a")].map((link) => link.getBoundingClientRect().height)
      }));
      const where = `${size.width}x${size.height} at ${font}px`;
      assert(values.cards > 5, `${where}: expected a full board, got ${values.cards} cards`);
      assert.equal(values.clipped, 0, `${where}: ${values.clipped} route cards are clipped`);
      assert(values.scroll <= values.width, `${where}: the page scrolls sideways`);
      assert(Math.abs(values.bottom - values.viewport) < 2, `${where}: the board does not end at the viewport`);
      assert(values.nav.every((height) => height >= 44), `${where}: nav targets are under 44px`);
      checks.push({ ...size, font, ...values });
    }
  }

  // Sorting belongs at the bottom of the landing drawer, and nowhere in the board footer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
  await page.click("#menuButton");
  await page.waitForTimeout(300);
  const drawer = await page.evaluate(() => {
    const panel = document.querySelector("#landingMenuPanel");
    const sort = panel.querySelector(".sort-toggle").getBoundingClientRect();
    const list = panel.querySelector(".landing-list").getBoundingClientRect();
    return {
      bottom: panel.getBoundingClientRect().bottom,
      sortBottom: sort.bottom,
      sortTop: sort.top,
      listBottom: list.bottom,
      footerSort: Boolean(document.querySelector(".board-footer .sort-toggle"))
    };
  });
  assert(Math.abs(drawer.bottom - drawer.sortBottom) < 2, "sorting is pinned to the drawer bottom");
  assert(drawer.listBottom <= drawer.sortTop + 2, "the landing list stops above the sort toggle");
  assert(!drawer.footerSort, "sorting has left the board footer");
  await shot("drawer-sort-bottom.png");

  await save("route-layout-checks.json", checks);
});
