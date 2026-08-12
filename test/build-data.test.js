import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDisplayData, decodeEntities, parseCsv } from "../scripts/build-data.js";

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
  // Revenue departures only: a home-port run belongs to no A/B/Local pattern and carries no variant.
  const variants = new Set(
    data.departures.filter((item) => item.routeId === "ER" && !item.outOfService).map((item) => item.variant)
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
  // Scoped by feed prefix, not by operator: NY Waterway also runs the IKEA boat, which is a
  // separate feed with its own prefix, so the operator name alone no longer identifies this feed.
  const waterwayDepartures = data.departures.filter((item) => item.routeId.startsWith("wtr:"));
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
  assert.equal(data.departures.some((item) => item.routeId.startsWith("wtr:")), false);
  assert.equal(data.meta.schemaVersion, 8);
});

test("NY Waterway departures are omitted for landings without a waterwayStopIds mapping", async () => {
  const data = await buildDisplayData({ landingNumber: 7, waterwayEnabled: true });
  assert.equal(data.meta.waterway.enabled, false);
  assert.equal(data.departures.some((item) => item.routeId.startsWith("wtr:")), false);
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

// The Trillium feed types four Hudson-crossing ferries as buses. With busesEnabled=false — the
// setting every deployed board uses — that silently deleted a third of NY Waterway's service at
// Pier 11. These are the routes and the counts the operator publishes on nywaterway.com.
test("NY Waterway ferries mistyped as buses in the feed still sail", async () => {
  const data = await buildDisplayData({ landingNumber: 16, waterwayEnabled: true, busesEnabled: false });
  const counts = {};
  for (const item of data.departures.filter((entry) => entry.routeId.startsWith("wtr:"))) {
    counts[item.destination] = (counts[item.destination] || 0) + 1;
  }
  // Edgewater, Hoboken/14th St and Port Liberte are the three mistyped routes calling at Pier 11.
  assert.equal(counts.Edgewater, 6);
  assert.equal(counts["Hoboken (14th St)"], 15);
  assert.equal(counts["Port Liberte"], 11);
  // Every one of them is a ferry on the board, not a bus, so busesEnabled cannot reach them.
  for (const item of data.departures.filter((entry) => entry.routeId.startsWith("wtr:"))) {
    assert.equal(item.mode, "ferry");
  }
  // Genuine buses are still dropped: the feed's crosstown shuttles never appear.
  assert.equal(data.departures.some((item) => item.mode === "bus"), false);
});

// The same sailing listed under two trip ids used to render as two identical rows.
test("a sailing listed twice in a feed is shown once", async () => {
  const data = await buildDisplayData({ landingNumber: 16, waterwayEnabled: true });
  const seen = new Set();
  for (const item of data.departures) {
    const key = [item.serviceId, item.routeId, item.variant || "", item.stopId, item.departureTime, item.destination].join(" ");
    assert.equal(seen.has(key), false, `duplicate departure on the board: ${key}`);
    seen.add(key);
  }
  // The known case: NY Waterway carries stale South Amboy trips alongside the current ones, so
  // Pier 11 must show the six departures the operator publishes rather than eight.
  const southAmboy = data.departures.filter((item) => item.routeId.startsWith("wtr:") && item.destination === "South Amboy");
  assert.deepEqual(southAmboy.map((item) => item.departureTime).sort(),
    ["06:35:00", "07:40:00", "15:35:00", "16:35:00", "17:15:00", "18:15:00"]);
});

// NY Waterway runs the IKEA Brooklyn weekend boat but leaves it out of its GTFS, so gtfs/ikea/ is
// transcribed from the operator's published image. These are the departure times on that image.
test("the IKEA weekend ferry sails from Pier 11 and Midtown", async () => {
  const pier11 = await buildDisplayData({ landingNumber: 16, ikeaEnabled: true });
  assert.equal(pier11.meta.ikea.enabled, true);
  const fromPier11 = pier11.departures.filter((item) => item.routeId.startsWith("ike:"));
  assert.deepEqual(fromPier11.filter((item) => item.destination === "IKEA Brooklyn").map((item) => item.departureTime),
    ["11:00:00", "12:30:00", "14:00:00", "15:30:00", "17:00:00"]);
  assert.deepEqual(fromPier11.filter((item) => item.destination === "Midtown / W 39th Street").map((item) => item.departureTime),
    ["11:30:00", "13:00:00", "14:30:00", "16:00:00", "17:30:00", "18:35:00"]);

  const midtown = await buildDisplayData({ landingNumber: 26, ikeaEnabled: true });
  const fromMidtown = midtown.departures.filter((item) => item.routeId.startsWith("ike:"));
  assert.deepEqual(fromMidtown.map((item) => item.departureTime),
    ["10:30:00", "12:00:00", "13:30:00", "15:00:00", "16:30:00", "17:55:00"]);
  // The last sailing of the day is printed with the Pier 11 cell blacked out: it runs non-stop,
  // which is why Pier 11 sees five southbound boats and Midtown sees six.
  assert.equal(fromMidtown.at(-1).nextStop, "IKEA Brooklyn");
  // It is NY Waterway's boat, badged IKEA, and it is a ferry rather than a shuttle bus.
  assert.equal(midtown.routes["ike:IKEA"].operator, "NY Waterway");
  assert.equal(midtown.routes["ike:IKEA"].shortName, "IKEA");
  assert.equal(midtown.routes["ike:IKEA"].mode, "ferry");
});

test("the IKEA ferry only runs at weekends, and only where it docks", async () => {
  const calendar = await readFile(new URL("../gtfs/ikea/calendar.txt", import.meta.url), "utf8");
  const [, row] = calendar.trim().split("\n");
  const [, sunday, monday, tuesday, wednesday, thursday, friday, saturday] = row.split(",");
  assert.deepEqual([monday, tuesday, wednesday, thursday, friday], ["0", "0", "0", "0", "0"]);
  assert.deepEqual([saturday, sunday], ["1", "1"]);
  // The switch is off wherever no ikeaStopIds mapping exists, so no other landing grows an IKEA row.
  const redHook = await buildDisplayData({ landingNumber: 17, ikeaEnabled: true });
  assert.equal(redHook.meta.ikea.enabled, false);
  assert.equal(redHook.departures.some((item) => item.routeId.startsWith("ike:")), false);
});

// Out-of-service moves. Nothing here is in the GTFS feed or the schedule workbook — the workbook
// only says which boat runs which trip, which is what makes "this boat's last trip" answerable.
test("a boat's last revenue trip is flagged, and it runs home to Pier C after it", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  const homePort = data.departures.filter((item) => item.outOfService);
  assert.ok(homePort.length > 0, "Pier 11 should be where several boats finish");
  for (const item of homePort) {
    assert.equal(item.destination, "Pier C");
    assert.equal(item.operator, "NYC Ferry");
    assert.equal(item.crewShuttle, false);
    // A home-port run belongs to the boat that makes it, so the badge still identifies the boat.
    assert.ok(Number.isInteger(item.boatAssignment));
  }
  // One home-port run per boat per service, never two.
  const keys = homePort.map((item) => `${item.routeId}${item.boatAssignment}|${item.serviceId}`);
  assert.equal(new Set(keys).size, keys.length);
  // The revenue trip that precedes it is flagged on every leg, so an agent upstream sees it too.
  const flagged = data.departures.filter((item) => item.lastTripOfBoat);
  assert.ok(flagged.length > 0);
  assert.ok(flagged.every((item) => !item.outOfService && !item.crewShuttle));

  // Governors Island is crewed off-schedule and carries no boat number, so nothing can be derived
  // for it and it must not acquire a home-port run by accident.
  assert.equal(data.departures.some((item) => item.routeId === "GI" && item.outOfService), false);
  // Partner operators publish no crew schedule at all.
  const waterway = await buildDisplayData({ landingNumber: 16, waterwayEnabled: true });
  assert.equal(waterway.departures.some((item) => item.routeId.startsWith("wtr:") && item.outOfService), false);
});

test("a crew shuttle is one departure for all the boats it relieves, and never marks them out of service", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  const shuttles = data.departures.filter((item) => item.crewShuttle);
  assert.ok(shuttles.length > 0);
  const weekend = shuttles.filter((item) => item.serviceId === "crew-weekend");
  // "ERF 3 PM/RWSV 5PM/RWSV 2PM/AST 2 PM: P11 14:35" is one 2:35pm departure, not four.
  const swap = weekend.find((item) => item.departureTime === "14:35:00");
  assert.ok(swap, "expected the 14:35 Pier 11 crew shuttle");
  assert.deepEqual(swap.crewBoats, ["ER3", "RS5", "RS2", "AS2"]);
  assert.equal(swap.destination, "Pier C");
  assert.equal(swap.outOfService, false);
  assert.equal(swap.routeId, "CREW");
  assert.ok(data.routes.CREW, "the shuttle needs a route of its own, not a borrowed one");
  // None of the boats it relieves is finishing: each keeps running afterwards.
  for (const boat of swap.crewBoats) {
    const route = boat.replace(/\d+$/, ""), number = Number(boat.replace(/^\D+/, ""));
    const later = data.departures.filter((item) =>
      item.routeId === route && item.boatAssignment === number && !item.outOfService &&
      item.seconds > swap.seconds);
    assert.ok(later.length > 0, `${boat} should still have revenue departures after the crew swap`);
  }
});

test("crew shuttles follow the weekend pattern on holidays, which the feed knows nothing about", async () => {
  const data = await buildDisplayData({ landingNumber: 16 });
  const services = new Map(data.calendars.map((item) => [item.serviceId, item]));
  // weekdays[] is Sunday-first.
  assert.deepEqual(services.get("crew-weekend").weekdays, [true, false, false, false, false, false, true]);
  assert.deepEqual(services.get("crew-weekday").weekdays, [false, true, true, true, true, true, false]);
  assert.ok(services.get("crew-weekend").startDate && services.get("crew-weekend").endDate);
  // A holiday swaps one for the other. The bundled feed has an empty calendar_dates.txt, so these
  // exceptions are the only thing that makes a holiday different from any other weekday.
  const holiday = "2026-09-07";
  assert.ok(data.exceptions.some((item) => item.serviceId === "crew-weekend" && item.date === holiday && item.added));
  assert.ok(data.exceptions.some((item) => item.serviceId === "crew-weekday" && item.date === holiday && !item.added));
});

test("landings with no crew shuttle configured get none", async () => {
  // Red Hook appears in no shuttle line, so it should carry home-port runs at most.
  const data = await buildDisplayData({ landingNumber: 17 });
  assert.equal(data.departures.some((item) => item.crewShuttle), false);
  assert.equal(data.routes.CREW, undefined);
});
