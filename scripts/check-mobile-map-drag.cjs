// The map's pan gesture, in a real browser.
//
// A drag reads its camera transform once when the gesture starts. Reading it per move fed the
// rendered SVG's position back into the next delta and made the camera stutter and jump, which no
// DOM test catches because jsdom has no layout. This drives eight real mouse moves and asserts the
// camera travels one way, evenly.
//
// Needs Chromium; uses bundled cartography. See docs/mobile-upgrade/README.md.
const assert = require("assert");
const { main } = require("./mobile-check-harness.cjs");

// One boat, standing still, so the deltas measured below are the camera's and not the fleet's.
const BOAT = {
  id: "19",
  name: "Opportunity",
  number: "H-204",
  latitude: 40.72,
  longitude: -73.99,
  status: "in-transit",
  speedKnots: 12,
  ageSeconds: 10
};

main("map drag", {
  api: {
    "/api/map": async () => (await require("./map-browser-fixture.cjs")()).harbor,
    "/api/boats": { available: true, boats: [BOAT] }
  }
}, async ({ page, site, save, shot }) => {
  await page.goto(`${site.origin}/map?boat=Opportunity`);
  await page.waitForSelector(".boat");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  // Arriving from a departure link opens straight onto the boat, so the sheet has to start
  // collapsed and the vessel must not be underneath its own card.
  const visibility = await page.evaluate(() => {
    const vessel = document.querySelector(".boat").getBoundingClientRect();
    const card = document.querySelector("#vesselCard").getBoundingClientRect();
    return {
      collapsed: document.querySelector("#bottomSheet").dataset.state === "peek",
      vesselBottom: vessel.bottom,
      cardTop: card.top
    };
  });
  assert(visibility.collapsed, "a departure link opens with the vessel list collapsed");
  assert(visibility.vesselBottom < visibility.cardTop, "the boat sits above its card");
  await shot("map-departure-link.png");

  const box = await page.locator("#chart").boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  const views = [];
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.move(box.x + 110 + step * 5, box.y + 100);
    await page.waitForTimeout(20);
    views.push(Number((await page.locator("#chart").getAttribute("viewBox")).split(" ")[0]));
  }
  // Long enough that the release is not read as a flick, so inertia cannot add movement of its own.
  await page.waitForTimeout(150);
  await page.mouse.up();

  const deltas = views.slice(1).map((value, index) => value - views[index]);
  assert(deltas.every((delta) => delta < 0), `dragging right must move the camera left: ${deltas}`);
  assert(Math.max(...deltas) - Math.min(...deltas) < 0.3, `camera steps must be even: ${deltas}`);
  await save("map-drag-checks.json", { visibility, views, deltas });
});
