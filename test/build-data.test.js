import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDisplayData, parseCsv } from "../scripts/build-data.js";

test("every configured landing builds departures", async () => {
  for (let landingNumber = 2; landingNumber <= 26; landingNumber += 1) {
    const data = await buildDisplayData({ landingNumber });
    assert.equal(data.meta.landingNumber, landingNumber);
    assert.ok(data.departures.length > 0, `Landing ${landingNumber} has no departures`);
  }
});

test("Rockaway includes ferry and bus service", async () => {
  const data = await buildDisplayData({ landingNumber: 18, busesEnabled: true });
  assert.equal(data.meta.busesEnabled, true);
  assert.ok(data.departures.some((item) => item.mode === "ferry"));
  assert.ok(data.departures.some((item) => item.mode === "bus"));
});

test("busesEnabled false drops the Rockaway shuttles and keeps the ferries", async () => {
  const data = await buildDisplayData({ landingNumber: 18, busesEnabled: false });
  assert.equal(data.meta.busesEnabled, false);
  assert.equal(data.departures.some((item) => item.mode === "bus"), false);
  assert.ok(data.departures.some((item) => item.mode === "ferry"));
  for (const route of Object.values(data.routes)) assert.equal(route.mode, "ferry");
});

test("busesEnabled false drops the NY Waterway shuttles at Pier 79", async () => {
  const withBuses = await buildDisplayData({ landingNumber: 26, waterwayEnabled: true, busesEnabled: true });
  assert.ok(withBuses.departures.some((item) => item.operator === "NY Waterway" && item.mode === "bus"));

  const data = await buildDisplayData({ landingNumber: 26, waterwayEnabled: true, busesEnabled: false });
  assert.equal(data.departures.some((item) => item.mode === "bus"), false);
  // The waterway merge itself stays on; only its bus routes are removed.
  assert.equal(data.meta.waterway.enabled, true);
  assert.ok(data.departures.some((item) => item.operator === "NY Waterway" && item.mode === "ferry"));
  for (const route of Object.values(data.routes)) assert.equal(route.mode, "ferry");
});

test("config/display.json declares busesEnabled as a boolean", async () => {
  const display = JSON.parse(await readFile(new URL("../config/display.json", import.meta.url), "utf8"));
  assert.equal(typeof display.busesEnabled, "boolean");
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
  assert.equal(data.meta.schemaVersion, 8);
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

test("NY Waterway departures are merged in at Pier 11 when enabled", async () => {
  const data = await buildDisplayData({ landingNumber: 16, waterwayEnabled: true });
  assert.equal(data.meta.waterway.enabled, true);
  assert.equal(data.meta.waterway.agencyName, "NY Waterway");
  const waterwayDepartures = data.departures.filter((item) => item.operator === "NY Waterway");
  assert.ok(waterwayDepartures.length > 0, "Pier 11 should include NY Waterway departures");
  for (const departure of waterwayDepartures) {
    assert.match(departure.tripId, /^wtr:/);
    assert.match(departure.routeId, /^wtr:/);
    assert.match(departure.stopId, /^wtr:/);
    assert.ok(data.tripSchedules[departure.tripId]?.stops.length > 1);
    assert.ok(data.routes[departure.routeId]);
    assert.equal(data.routes[departure.routeId].operator, "NY Waterway");
  }
  // Namespacing must not disturb NYC Ferry's own departures or route ids.
  assert.ok(data.departures.some((item) => item.operator === "NYC Ferry"));
  assert.ok(data.routes.SB);
  assert.equal(data.routes.SB.operator, "NYC Ferry");
});

test("NY Waterway departures are omitted when waterwayEnabled is false", async () => {
  const data = await buildDisplayData({ landingNumber: 16, waterwayEnabled: false });
  assert.equal(data.meta.waterway.enabled, false);
  assert.equal(data.meta.waterway.agencyName, null);
  assert.equal(data.departures.some((item) => item.operator === "NY Waterway"), false);
  assert.equal(data.meta.schemaVersion, 8);
});

test("NY Waterway departures are omitted for landings without a waterwayStopIds mapping", async () => {
  const data = await buildDisplayData({ landingNumber: 7, waterwayEnabled: true });
  assert.equal(data.meta.waterway.enabled, false);
  assert.equal(data.departures.some((item) => item.operator === "NY Waterway"), false);
});

test("crew boat assignments are attached to NYC Ferry departures", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  // The Governors Island shuttle is crewed off-schedule and has no Boat column in the
  // workbook, so it is the one ferry route that never carries an assignment.
  const scheduled = data.departures.filter((item) =>
    item.operator === "NYC Ferry" && item.mode === "ferry" && item.routeId !== "GI");
  assert.ok(scheduled.length > 0);
  const labeled = scheduled.filter((item) => Number.isInteger(item.boatAssignment) && item.boatAssignment >= 1);
  assert.ok(labeled.length / scheduled.length > 0.95,
    `${scheduled.length - labeled.length} of ${scheduled.length} scheduled ferry departures lack a boat assignment`);
  assert.ok(data.departures.filter((item) => item.routeId === "GI").every((item) => item.boatAssignment === null));
  // NY Waterway publishes no crew schedule, so those rows stay unlabeled.
  assert.ok(data.departures.filter((item) => item.operator === "NY Waterway").every((item) => item.boatAssignment === null));
});

test("boat assignments join GTFS trip_short_name to the schedule workbook", async () => {
  const [assignmentsRaw, tripsRaw] = await Promise.all([
    readFile(new URL("../content/boat-assignments.json", import.meta.url), "utf8"),
    readFile(new URL("../gtfs/trips.txt", import.meta.url), "utf8")
  ]);
  const { assignments } = JSON.parse(assignmentsRaw);
  assert.ok(Object.keys(assignments).length > 300);
  assert.ok(Object.values(assignments).every((boat) => Number.isInteger(boat) && boat >= 1));
  // Shuttle-bus routes (RES/RWS) and the Governors Island shuttle carry no boat number, so
  // coverage is asserted over the ferry routes the workbook actually schedules.
  const trips = parseCsv(tripsRaw).filter((trip) => ["AS", "ER", "RS", "SB", "SG", "RR"].includes(trip.route_id));
  const missing = trips.filter((trip) => assignments[String(trip.trip_short_name).trim()] === undefined);
  assert.ok(missing.length / trips.length < 0.05, `${missing.length} of ${trips.length} ferry trips lack a boat assignment`);
});
