const { chromium } = require(process.cwd() + "/node_modules/playwright");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const assert = require("assert");
(async () => {
  const root = process.cwd();
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname.startsWith("/api/")) {
        const r = await fetch("http://localhost:8094" + req.url);
        res.setHeader("Content-Type", "application/json");
        res.end(await r.text());
        return;
      }
      let p = u.pathname === "/ferryTimesMobile/" ? "/index.html" : u.pathname;
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".woff2": "font/woff2",
          ".png": "image/png",
        }[path.extname(p)] || "application/json",
      );
      res.end(await fs.readFile(path.join(root, "public", p)));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = await chromium.launch();
  const p = await b.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem("nyc-ferry-did-theme", "pompompurin");
    localStorage.setItem("nyc-ferry-did-selected-landing", "16");
    localStorage.setItem("nyc-ferry-did-sort", "route");
    const Real = Date;
    window.Date = class extends Real {
      constructor(...a) {
        super(...(a.length ? a : ["2026-09-04T14:00:00Z"]));
      }
      static now() {
        return +new Real("2026-09-04T14:00:00Z");
      }
    };
  });
  await p.goto(`http://127.0.0.1:${server.address().port}/ferryTimesMobile/`);
  await p.waitForSelector("[data-view=routes] .departure");
  await p.screenshot({
    path: root + "/docs/mobile-upgrade/route-cards-fixed.png",
  });
  const checks = [];
  for (const size of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await p.setViewportSize(size);
    for (const font of [16, 20, 24]) {
      await p.evaluate(
        (n) => (document.documentElement.style.fontSize = n + "px"),
        font,
      );
      await p.waitForTimeout(50);
      const values = await p.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        bottom: document.querySelector("#serviceAlerts").getBoundingClientRect()
          .bottom,
        viewport: visualViewport.height,
        clipped: [
          ...document.querySelectorAll("[data-view=routes] > .departure"),
        ].filter((card) => card.scrollHeight > card.clientHeight + 2).length,
        cards: document.querySelectorAll("[data-view=routes] > .departure")
          .length,
        nav: [...document.querySelectorAll(".product-nav a")].map(
          (a) => a.getBoundingClientRect().height,
        ),
      }));
      assert(values.cards > 5);
      assert.equal(values.clipped, 0, "Route cards must fit all their content");
      assert(values.scroll <= values.width);
      assert(
        Math.abs(values.bottom - values.viewport) < 2,
        JSON.stringify(values),
      );
      assert(values.nav.every((h) => h >= 44));
      checks.push({ ...size, font, ...values });
    }
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => (document.documentElement.style.fontSize = "16px"));
  await p.click("#menuButton");
  await p.waitForTimeout(300);
  const drawer = await p.evaluate(() => {
    const panel = document.querySelector("#landingMenuPanel"),
      sort = panel.querySelector(".sort-toggle"),
      list = panel.querySelector(".landing-list");
    return {
      bottom: panel.getBoundingClientRect().bottom,
      sortBottom: sort.getBoundingClientRect().bottom,
      listBottom: list.getBoundingClientRect().bottom,
      sortTop: sort.getBoundingClientRect().top,
      footerSort: !!document.querySelector(".board-footer .sort-toggle"),
    };
  });
  assert(Math.abs(drawer.bottom - drawer.sortBottom) < 2);
  assert(drawer.listBottom <= drawer.sortTop + 2);
  assert(!drawer.footerSort);
  await p.screenshot({
    path: root + "/docs/mobile-upgrade/drawer-sort-bottom.png",
  });
  assert.equal(errors.length, 0, errors.join());
  console.log(JSON.stringify(checks));
  await fs.writeFile(
    root + "/docs/mobile-upgrade/route-layout-checks.json",
    JSON.stringify(checks, null, 2) + "\n",
  );
  await b.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
