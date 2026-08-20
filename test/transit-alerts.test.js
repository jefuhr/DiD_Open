import test from "node:test";
import assert from "node:assert/strict";

import {
  SUBWAY_LOOKAHEAD_MS,
  fetchSiFerryAlerts,
  normalizeSiFerryAlerts,
  normalizeSubwayAlerts
} from "../lib/transit-alerts.js";

const now = Date.parse("2026-08-19T20:00:00Z");
const at = (offsetMs) => Math.floor((now + offsetMs) / 1000);

function subwayEntity({ id = "1", type = "Planned - Part Suspended", header = "No [G] between two places",
  description = "Use the [A] instead.", routes = ["G"], start = at(60 * 60_000), end = at(8 * 60 * 60_000) } = {}) {
  return {
    id,
    alert: {
      active_period: [{ start, end }],
      informed_entity: routes.map((route) => ({ agency_id: "MTASBWY", route_id: route })),
      header_text: { translation: [{ text: header, language: "en" }] },
      description_text: { translation: [{ text: description, language: "en" }] },
      "transit_realtime.mercury_alert": { alert_type: type }
    }
  };
}

test("only closures make it through, and only the ones about to happen", () => {
  const payload = {
    entity: [
      subwayEntity({ id: "suspended" }),
      subwayEntity({ id: "fully", type: "Planned - Suspended" }),
      // Everything below is real service information the board deliberately does not carry: it has
      // one line to spare and it belongs to the trains that are not coming.
      subwayEntity({ id: "delays", type: "Delays" }),
      subwayEntity({ id: "skipped", type: "Planned - Stops Skipped" }),
      subwayEntity({ id: "elevator", type: "Station Notice" }),
      // A closure three weekends out is not what an alert bar is for.
      subwayEntity({ id: "far", start: at(6 * 24 * 60 * 60_000), end: at(7 * 24 * 60 * 60_000) }),
      // And one that has already finished is over.
      subwayEntity({ id: "past", start: at(-8 * 60 * 60_000), end: at(-60 * 60_000) })
    ]
  };
  const alerts = normalizeSubwayAlerts(payload, { now });
  assert.deepEqual(alerts.map((alert) => alert.id), ["mta-subway-suspended", "mta-subway-fully"]);
  assert.equal(alerts[0].agency, "MTA Subway");
  assert.equal(alerts[0].source, "mta-subway");
  // The routes lead: a rider wants to know which letters are dead before reading a word of prose.
  assert.equal(alerts[0].header, "G — No [G] between two places");
  // "Planned - " is how the feed says it, not how a person does.
  assert.equal(alerts[0].effect, "Part Suspended");
});

test("a closure already running is still a closure", () => {
  const payload = { entity: [subwayEntity({ start: at(-60 * 60_000), end: at(60 * 60_000) })] };
  assert.equal(normalizeSubwayAlerts(payload, { now }).length, 1);
});

test("closures are ordered by the one you will walk into first", () => {
  const payload = {
    entity: [
      subwayEntity({ id: "later", routes: ["N"], start: at(6 * 60 * 60_000) }),
      subwayEntity({ id: "sooner", routes: ["1"], start: at(30 * 60_000) })
    ]
  };
  assert.deepEqual(
    normalizeSubwayAlerts(payload, { now }).map((alert) => alert.id),
    ["mta-subway-sooner", "mta-subway-later"]
  );
});

test("the lookahead is a day, and nothing outside it is fetched", () => {
  assert.equal(SUBWAY_LOOKAHEAD_MS, 24 * 60 * 60 * 1000);
  const justInside = { entity: [subwayEntity({ start: at(SUBWAY_LOOKAHEAD_MS - 60_000) })] };
  const justOutside = { entity: [subwayEntity({ start: at(SUBWAY_LOOKAHEAD_MS + 60_000), end: null })] };
  assert.equal(normalizeSubwayAlerts(justInside, { now }).length, 1);
  assert.equal(normalizeSubwayAlerts(justOutside, { now }).length, 0);
});

test("a feed that is empty, malformed or missing text yields nothing rather than throwing", () => {
  assert.deepEqual(normalizeSubwayAlerts(null, { now }), []);
  assert.deepEqual(normalizeSubwayAlerts({}, { now }), []);
  assert.deepEqual(normalizeSubwayAlerts({ entity: [{}] }, { now }), []);
  const blank = { entity: [subwayEntity({ header: "", description: "" })] };
  assert.deepEqual(normalizeSubwayAlerts(blank, { now }), []);
});

// Nobody has issued a 511NY key for this deployment, which is the normal state and not a fault.
test("the Staten Island Ferry source stays dormant without a key", async () => {
  const result = await fetchSiFerryAlerts({
    key: "",
    fetchImpl: () => { throw new Error("must not reach the network without a key"); }
  });
  assert.equal(result, null);
});

test("511NY events are cut down to Staten Island Ferry ones", () => {
  const payload = [
    { ID: "1", EventType: "Ferry Delay", FacilityName: "Staten Island Ferry", Description: "Boats running late." },
    { ID: "2", EventType: "Ferry Delay", FacilityName: "Port Jefferson Ferry", Description: "Not this harbour." },
    { ID: "3", EventType: "Construction", RoadwayName: "I-278", Description: "Not a ferry at all." }
  ];
  const alerts = normalizeSiFerryAlerts(payload, { now });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].agency, "Staten Island Ferry");
  assert.equal(alerts[0].id, "si-ferry-1");
});
