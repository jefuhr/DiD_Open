import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDisplayData, decodeEntities } from "../scripts/build-data.js";

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
  assert.equal(data.meta.schemaVersion, 7);
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
  assert.equal(data.meta.schemaVersion, 7);
});

test("NY Waterway departures are omitted for landings without a waterwayStopIds mapping", async () => {
  const data = await buildDisplayData({ landingNumber: 7, waterwayEnabled: true });
  assert.equal(data.meta.waterway.enabled, false);
  assert.equal(data.departures.some((item) => item.operator === "NY Waterway"), false);
});

test("Seastreak departures are merged in at East 34th Street when enabled", async () => {
  const data = await buildDisplayData({ landingNumber: 8, seastreakEnabled: true });
  assert.equal(data.meta.seastreak.enabled, true);
  assert.equal(data.meta.seastreak.agencyName, "Seastreak");
  const seastreakDepartures = data.departures.filter((item) => item.operator === "Seastreak");
  assert.ok(seastreakDepartures.length > 0, "East 34th Street should include Seastreak departures");
  for (const departure of seastreakDepartures) {
    assert.match(departure.tripId, /^sea:/);
    assert.match(departure.routeId, /^sea:/);
    assert.match(departure.stopId, /^sea:/);
    assert.match(departure.serviceId, /^sea:/);
    assert.ok(data.tripSchedules[departure.tripId]?.stops.length > 1);
    assert.equal(data.routes[departure.routeId].operator, "Seastreak");
    // Seastreak's own headsigns only name a region, so the board shows the trip's last stop.
    assert.doesNotMatch(departure.destination, /^(Manhattan|New Jersey)$/);
  }
  // NYC Ferry's own departures and route ids are untouched by the merge.
  assert.ok(data.departures.some((item) => item.operator === "NYC Ferry"));
  assert.ok(data.routes.ER);
  assert.equal(data.routes.ER.operator, "NYC Ferry");
});

test("Seastreak departures are omitted when seastreakEnabled is false", async () => {
  const data = await buildDisplayData({ landingNumber: 8, seastreakEnabled: false });
  assert.equal(data.meta.seastreak.enabled, false);
  assert.equal(data.meta.seastreak.agencyName, null);
  assert.equal(data.departures.some((item) => item.operator === "Seastreak"), false);
  assert.ok(data.departures.length > 0);
});

test("Seastreak departures are omitted for landings without a seastreakStopIds mapping", async () => {
  const data = await buildDisplayData({ landingNumber: 16, seastreakEnabled: true });
  assert.equal(data.meta.seastreak.enabled, false);
  assert.equal(data.departures.some((item) => item.operator === "Seastreak"), false);
});

test("NYU ferry departures are merged in at both terminals it serves", async () => {
  // East 34th Street and Sunset Park are opposite ends of the same NYU crossing, so each should
  // show the other as the destination.
  for (const [landingNumber, destination] of [[8, "Brooklyn Army Terminal"], [24, "East 34th Street"]]) {
    const data = await buildDisplayData({ landingNumber, nyuEnabled: true });
    assert.equal(data.meta.nyu.enabled, true);
    assert.equal(data.meta.nyu.agencyName, "New York University");
    const nyuDepartures = data.departures.filter((item) => item.operator === "New York University");
    assert.ok(nyuDepartures.length > 0, `landing ${landingNumber} should include NYU departures`);
    for (const departure of nyuDepartures) {
      assert.match(departure.tripId, /^nyu:/);
      assert.match(departure.routeId, /^nyu:/);
      assert.match(departure.stopId, /^nyu:/);
      assert.match(departure.serviceId, /^nyu:/);
      assert.ok(data.tripSchedules[departure.tripId]?.stops.length > 1);
      assert.equal(data.routes[departure.routeId].operator, "New York University");
      assert.equal(departure.destination, destination);
      assert.equal(departure.mode, "ferry");
    }
    assert.ok(data.departures.some((item) => item.operator === "NYC Ferry"));
  }
});

test("NYU ferry departures are omitted when nyuEnabled is false", async () => {
  const data = await buildDisplayData({ landingNumber: 8, nyuEnabled: false });
  assert.equal(data.meta.nyu.enabled, false);
  assert.equal(data.meta.nyu.agencyName, null);
  assert.equal(data.departures.some((item) => item.operator === "New York University"), false);
  assert.ok(data.departures.length > 0);
});

test("NYU ferry departures are omitted for landings without a nyuStopIds mapping", async () => {
  const data = await buildDisplayData({ landingNumber: 16, nyuEnabled: true });
  assert.equal(data.meta.nyu.enabled, false);
  assert.equal(data.departures.some((item) => item.operator === "New York University"), false);
});

test("the generated NYU feed only runs on the weekdays Passio publishes service for", async () => {
  const data = await buildDisplayData({ landingNumber: 8, nyuEnabled: true });
  const nyuCalendars = data.calendars.filter((item) => item.serviceId.startsWith("nyu:"));
  assert.ok(nyuCalendars.length > 0);
  for (const calendar of nyuCalendars) {
    // weekdays is [Sun..Sat]; NYU runs Monday through Friday only.
    assert.deepEqual(calendar.weekdays, [false, true, true, true, true, true, false]);
    assert.match(calendar.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(calendar.endDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("Liberty Landing departures are merged in at Battery Park City when enabled", async () => {
  const data = await buildDisplayData({ landingNumber: 25, libertyEnabled: true });
  assert.equal(data.meta.liberty.enabled, true);
  assert.equal(data.meta.liberty.agencyName, "Liberty Landing Ferry");
  const libertyDepartures = data.departures.filter((item) => item.operator === "Liberty Landing Ferry");
  assert.ok(libertyDepartures.length > 0, "Battery Park City should parse Liberty Landing departures");
  for (const departure of libertyDepartures) {
    assert.match(departure.tripId, /^lib:/);
    assert.match(departure.routeId, /^lib:/);
    assert.match(departure.stopId, /^lib:/);
    assert.match(departure.serviceId, /^lib:/);
    assert.ok(data.tripSchedules[departure.tripId]?.stops.length > 1);
    assert.equal(data.routes[departure.routeId].operator, "Liberty Landing Ferry");
    assert.equal(departure.mode, "ferry");
  }
  // The NY Waterway dock at this landing keeps its own namespace and its own operator.
  assert.ok(data.departures.some((item) => item.operator === "NY Waterway"));
  assert.ok(data.departures.some((item) => item.operator === "NYC Ferry"));
});

test("Liberty Landing departures are omitted when libertyEnabled is false", async () => {
  const data = await buildDisplayData({ landingNumber: 25, libertyEnabled: false });
  assert.equal(data.meta.liberty.enabled, false);
  assert.equal(data.meta.liberty.agencyName, null);
  assert.equal(data.departures.some((item) => item.operator === "Liberty Landing Ferry"), false);
  assert.ok(data.departures.length > 0);
});

test("Liberty Landing departures are omitted for landings without a libertyStopIds mapping", async () => {
  const data = await buildDisplayData({ landingNumber: 16, libertyEnabled: true });
  assert.equal(data.meta.liberty.enabled, false);
  assert.equal(data.departures.some((item) => item.operator === "Liberty Landing Ferry"), false);
});

test("every bundled feed is still in service, so no operator is silently empty", async () => {
  // public/app.js only counts a departure whose service is in effect today, so a lapsed feed shows
  // nothing at all rather than failing loudly. Liberty Landing shipped that way once — a 2019 feed
  // that had expired in 2020 — so this asserts the invariant for every operator at every landing
  // that pulls one in. A failure here means that feed needs regenerating or replacing.
  const today = new Date().toISOString().slice(0, 10);
  for (const landingNumber of [8, 16, 25]) {
    const data = await buildDisplayData({ landingNumber });
    const latestEnd = new Map();
    const covered = new Set();
    for (const calendar of data.calendars) {
      const operator = calendar.serviceId.includes(":") ? calendar.serviceId.split(":")[0] : "nycf";
      if (!latestEnd.has(operator) || calendar.endDate > latestEnd.get(operator)) latestEnd.set(operator, calendar.endDate);
      if (today >= calendar.startDate && today <= calendar.endDate) covered.add(operator);
    }
    for (const [operator, endDate] of latestEnd) {
      assert.ok(
        covered.has(operator),
        `landing ${landingNumber}: the "${operator}" feed has no service covering ${today} (latest end ${endDate}); it needs replacing`
      );
    }
  }
});

test("the Liberty Landing feed matches the timetable its operator publishes", async () => {
  // gtfs/liberty/ is transcribed from libertylandingcityferry.com by scripts/build-liberty-gtfs.js,
  // not downloaded, so this pins the shape of that transcription. The operator prints hourly
  // sailings leaving Brookfield Place at :45 — weekdays 06:45 to 19:45, weekends from 09:45.
  const data = await buildDisplayData({ landingNumber: 25, libertyEnabled: true });
  const fromBrookfield = data.departures.filter((item) => item.stopId === "lib:2557122");
  const byService = new Map();
  for (const departure of fromBrookfield) {
    const list = byService.get(departure.serviceId) || [];
    list.push(departure.departureTime);
    byService.set(departure.serviceId, list);
  }
  const weekday = (byService.get("lib:liberty-weekday") || []).sort();
  const weekend = (byService.get("lib:liberty-weekend") || []).sort();
  assert.deepEqual(weekday, Array.from({ length: 14 }, (_, index) => `${String(index + 6).padStart(2, "0")}:45:00`));
  assert.deepEqual(weekend, Array.from({ length: 11 }, (_, index) => `${String(index + 9).padStart(2, "0")}:45:00`));
  // Every sailing from Manhattan runs to Liberty Landing by way of Warren Street.
  for (const departure of fromBrookfield) {
    assert.equal(departure.destination, "Liberty Landing");
    assert.equal(departure.nextStop, "Warren Street");
  }
});

test("partner feeds keep separate id namespaces at a landing that has both", async () => {
  const data = await buildDisplayData({ landingNumber: 8, seastreakEnabled: true, waterwayEnabled: true, nyuEnabled: true });
  const prefixes = new Set(Object.keys(data.routes).map((id) => id.split(":")[1] ? `${id.split(":")[0]}:` : "nycf"));
  assert.ok(prefixes.has("sea:"));
  assert.ok(prefixes.has("nyu:"));
  for (const departure of data.departures) {
    const operator = data.routes[departure.routeId].operator;
    if (departure.routeId.startsWith("sea:")) assert.equal(operator, "Seastreak");
    else if (departure.routeId.startsWith("wtr:")) assert.equal(operator, "NY Waterway");
    else if (departure.routeId.startsWith("nyu:")) assert.equal(operator, "New York University");
    else assert.equal(operator, "NYC Ferry");
  }
  // Departures stay in one time-sorted list regardless of which feed they came from.
  const seconds = data.departures.map((item) => item.seconds);
  assert.deepEqual(seconds, [...seconds].sort((left, right) => left - right));
});

test("HTML-escaped feed text is decoded before it reaches the screen", async () => {
  assert.equal(decodeEntities("Martha&#8217;s Vineyard &amp; Nantucket"), "Martha’s Vineyard & Nantucket");
  assert.equal(decodeEntities("New Bedford &#038; Nantucket"), "New Bedford & Nantucket");
  assert.equal(decodeEntities("Pier 11  /  Wall St"), "Pier 11 / Wall St");
  assert.equal(decodeEntities(""), "");
  const data = await buildDisplayData({ landingNumber: 8, seastreakEnabled: true });
  for (const route of Object.values(data.routes)) assert.doesNotMatch(route.name, /&#?\w+;/);
  for (const departure of data.departures) assert.doesNotMatch(departure.destination, /&#?\w+;/);
});
