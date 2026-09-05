const { chromium } = require(process.cwd() + "/node_modules/playwright");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const assert = require("assert");
(async () => {
  const root = process.cwd();
  const map = await fetch("http://localhost:8094/api/map").then((r) =>
    r.text(),
  );
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname === "/api/map") {
        res.setHeader("Content-Type", "application/json");
        res.end(map);
        return;
      }
      if (u.pathname === "/api/boats") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            available: true,
            boats: [
              {
                id: "19",
                name: "Opportunity",
                number: "H-204",
                latitude: 40.72,
                longitude: -73.99,
                status: "in-transit",
                speedKnots: 12,
                ageSeconds: 10,
              },
            ],
          }),
        );
        return;
      }
      let p = u.pathname === "/map" ? "/map.html" : u.pathname;
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
  await p.goto(
    `http://127.0.0.1:${server.address().port}/map?boat=Opportunity`,
  );
  await p.waitForSelector(".boat");
  await p.waitForTimeout(700);
  const visibility = await p.evaluate(() => {
    const vessel = document.querySelector(".boat").getBoundingClientRect(),
      card = document.querySelector("#vesselCard").getBoundingClientRect();
    return {
      collapsed:
        document.querySelector("#bottomSheet").dataset.state === "peek",
      vesselBottom: vessel.bottom,
      cardTop: card.top,
    };
  });
  assert(visibility.collapsed);
  assert(visibility.vesselBottom < visibility.cardTop);
  await p.screenshot({
    path: root + "/docs/mobile-upgrade/map-departure-link.png",
  });
  const box = await p.locator("#chart").boundingBox();
  await p.mouse.move(box.x + 100, box.y + 100);
  await p.mouse.down();
  const views = [];
  for (let i = 0; i < 8; i++) {
    await p.mouse.move(box.x + 110 + i * 5, box.y + 100);
    await p.waitForTimeout(20);
    views.push(
      (await p.locator("#chart").getAttribute("viewBox"))
        .split(" ")
        .map(Number)[0],
    );
  }
  await p.waitForTimeout(150);
  await p.mouse.up();
  const deltas = views.slice(1).map((x, i) => x - views[i]);
  assert(deltas.every((x) => x < 0));
  assert(Math.max(...deltas) - Math.min(...deltas) < 0.3);
  assert.equal(errors.length, 0, errors.join());
  const result = { visibility, views, deltas, errors };
  await fs.writeFile(
    root + "/docs/mobile-upgrade/map-drag-checks.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(result);
  await b.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
