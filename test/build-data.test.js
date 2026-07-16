import test from "node:test";
import assert from "node:assert/strict";
import { buildDisplayData } from "../scripts/build-data.js";

test("every configured landing builds departures", async () => {
  for (let landingNumber = 2; landingNumber <= 24; landingNumber += 1) {
    const data = await buildDisplayData({ landingNumber });
    assert.equal(data.meta.landingNumber, landingNumber);
    assert.ok(data.departures.length > 0, `Landing ${landingNumber} has no departures`);
  }
});

test("Rockaway includes ferry and bus service", async () => {
  const data = await buildDisplayData({ landingNumber: 18 });
  assert.ok(data.departures.some((item) => item.mode === "ferry"));
  assert.ok(data.departures.some((item) => item.mode === "bus"));
});

test("routes retain their official abbreviations and colors", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  assert.equal(data.routes.SB.shortName, "SB");
  assert.equal(data.routes.SB.name, "South Brooklyn");
  assert.equal(data.routes.SB.color, "#FFD100");
  for (const route of Object.values(data.routes)) {
    assert.match(route.shortName, /\S/);
    assert.match(route.color, /^#[0-9A-F]{6}$/);
  }
});

test("display data includes the configured slideshow interval and all directions", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  assert.equal(data.meta.slideSeconds, 12);
  const directions = new Set(data.departures.map((item) => `${item.routeId}|${item.directionId}|${item.destination}`));
  assert.ok(directions.size > 4, "Pier 11 should require more than one four-route slide");
});

test("landing 1 remains unused", async () => {
  await assert.rejects(() => buildDisplayData({ landingNumber: 1 }), /active landing/);
});
