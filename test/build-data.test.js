import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const display = JSON.parse(await readFile(new URL("../config/display.json", import.meta.url), "utf8"));
  assert.equal(data.meta.slideSeconds, display.slideSeconds);
  assert.equal(data.meta.departureWindowMinutes, display.departureWindowMinutes);
  assert.equal(data.meta.departuresShown, display.departuresShown);
  assert.equal(data.meta.routesShown, display.routesShown);
  assert.equal(data.meta.schemaVersion, 6);
  assert.ok(data.tripSchedules[data.departures[0].tripId]?.stops.length > 1);
  const directions = new Set(data.departures.map((item) => `${item.routeId}|${item.directionId}|${item.destination}`));
  assert.ok(directions.size > 4, "Pier 11 should require more than one four-route slide");
});

test("display counts support every whole number from one through five", async () => {
  for (let departuresShown = 1; departuresShown <= 5; departuresShown += 1) {
    for (let routesShown = 1; routesShown <= 5; routesShown += 1) {
      const data = await buildDisplayData({ landingNumber: 16, departuresShown, routesShown });
      assert.equal(data.meta.departuresShown, departuresShown);
      assert.equal(data.meta.routesShown, routesShown);
    }
  }
});

test("display counts reject values outside one through five", async () => {
  await assert.rejects(
    () => buildDisplayData({ landingNumber: 16, departuresShown: 0 }),
    /departuresShown must be a whole number from 1 through 5/
  );
  await assert.rejects(
    () => buildDisplayData({ landingNumber: 16, routesShown: 6 }),
    /routesShown must be a whole number from 1 through 5/
  );
  await assert.rejects(
    () => buildDisplayData({ landingNumber: 16, departuresShown: 2.5 }),
    /departuresShown must be a whole number from 1 through 5/
  );
});

test("South Brooklyn trips identify Governors Island service", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  const islandTrips = data.departures.filter((item) => item.routeId === "SB" && item.servesGovernorsIsland);
  assert.ok(islandTrips.length > 0);
  assert.equal(islandTrips.at(-1).tripId, "1168");
  assert.equal(islandTrips.at(-1).destination, "Governors Island");
  assert.ok(data.departures.some((item) => item.routeId === "SB" && item.seconds > islandTrips.at(-1).seconds && !item.servesGovernorsIsland));
});

test("East River departures are split into A, B, and Local variants", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  const variants = new Set(
    data.departures.filter((item) => item.routeId === "ER").map((item) => item.variant)
  );
  assert.deepEqual([...variants].sort(), ["A", "B", "LOCAL"]);
  for (const variant of variants) {
    assert.ok(data.departures.some((item) => item.routeId === "ER" && item.variant === variant));
  }
});

test("landing 1 remains unused", async () => {
  await assert.rejects(() => buildDisplayData({ landingNumber: 1 }), /active landing/);
});
