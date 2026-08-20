import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

import {
  createServiceAlertService,
  fetchServiceAlerts,
  normalizeServiceAlerts,
  normalizeWebsiteServiceAlerts
} from "../lib/service-alerts.js";

const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;
const now = Date.parse("2026-07-12T16:00:00Z");

function alertFeed() {
  return transitRealtime.FeedMessage.create({
    header: {
      gtfsRealtimeVersion: "2.0",
      timestamp: Math.round(now / 1000)
    },
    entity: [
      {
        id: "active-alert",
        alert: {
          activePeriod: [
            { start: Math.round(now / 1000) - 60, end: Math.round(now / 1000) + 3600 }
          ],
          informedEntity: [{ routeId: "ER" }, { stopId: "87" }],
          cause: 8,
          effect: 3,
          headerText: {
            translation: [
              { text: "Demoras por clima", language: "es" },
              { text: "Weather delays", language: "en" }
            ]
          },
          descriptionText: {
            translation: [{ text: "Allow additional travel time.", language: "en" }]
          }
        }
      },
      {
        id: "expired-alert",
        alert: {
          activePeriod: [{ end: Math.round(now / 1000) - 3600 }],
          effect: 1,
          headerText: { translation: [{ text: "Old suspension", language: "en" }] }
        }
      }
    ]
  });
}

function encodedFeedResponse() {
  const bytes = transitRealtime.FeedMessage.encode(alertFeed()).finish();
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name.toLowerCase() === "content-length" ? String(bytes.length) : null)
    },
    arrayBuffer: async () => bytes
  };
}

function websiteAlertPayload() {
  return [
    {
      createdDate: String(now - 60_000),
      expirationDate: String(now + 3_600_000),
      notificationTitle: "Ferry Point Park closure",
      notificationBody: "Rockaway-Soundview ferries will skip Ferry Point Park.",
      notificationGroups: ["soundviewroutealerts", "roackawayroutealerts"],
      scheduleUrl: ""
    },
    {
      createdDate: String(now - 7_200_000),
      expirationDate: String(now - 3_600_000),
      notificationTitle: "Expired website notice",
      notificationBody: "This should not be shown.",
      notificationGroups: ["generalserviceadvisories"]
    }
  ];
}

function websiteResponse(payload = websiteAlertPayload()) {
  const text = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(text.length) : null) },
    text: async () => text
  };
}

test("GTFS-Realtime alerts normalize active English rider information", () => {
  const alerts = normalizeServiceAlerts(alertFeed(), { now });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "active-alert");
  assert.equal(alerts[0].header, "Weather delays");
  assert.equal(alerts[0].description, "Allow additional travel time.");
  assert.equal(alerts[0].translations.es.header, "Demoras por clima");
  assert.equal(alerts[0].translations.en.description, "Allow additional travel time.");
  assert.equal(alerts[0].cause, "Weather");
  assert.equal(alerts[0].effect, "Significant delays");
  assert.deepEqual(alerts[0].routeIds, ["ER"]);
  assert.deepEqual(alerts[0].stopIds, ["87"]);
});

test("open-ended GTFS alert periods remain active", () => {
  const feed = transitRealtime.FeedMessage.create({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [
      {
        id: "open-ended",
        alert: {
          activePeriod: [{ start: Math.round(now / 1000) - 60 }],
          headerText: { translation: [{ text: "Open-ended alert", language: "en" }] }
        }
      }
    ]
  });
  assert.equal(normalizeServiceAlerts(feed, { now }).length, 1);
});

test("website secondary alerts normalize active route notices", () => {
  const alerts = normalizeWebsiteServiceAlerts(websiteAlertPayload(), { now });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].source, "website");
  assert.equal(alerts[0].header, "Ferry Point Park closure");
  assert.deepEqual(alerts[0].routeIds, ["RS"]);
  assert.equal(alerts[0].translations.en.description, "Rockaway-Soundview ferries will skip Ferry Point Park.");
});

test("service-alert feed decodes protobuf snapshots", async () => {
  const snapshot = await fetchServiceAlerts({
    now,
    fetchImpl: async () => encodedFeedResponse()
  });
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.alerts.length, 1);
  assert.equal(snapshot.feedTimestamp, "2026-07-12T16:00:00.000Z");
});

test("GTFS and website alerts are returned together with GTFS first", async () => {
  const snapshot = await fetchServiceAlerts({
    now,
    fetchImpl: async (url) =>
      String(url).includes("cloudfunctions.net") ? websiteResponse() : encodedFeedResponse()
  });
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.partial, false);
  assert.deepEqual(snapshot.alerts.map((alert) => alert.source), ["gtfs", "website"]);
  assert.equal(snapshot.sourceStatus.gtfs, "updated");
  assert.equal(snapshot.sourceStatus.website, "updated");
});

// This is a ferry board. Whatever else ends up on it, the boat leads — the bar above the list can
// only ever show whichever alert comes first, so the order is the feature, not a detail of it.
test("NYC Ferry alerts always come before the other services", async (t) => {
  const subwayFeed = {
    entity: [{
      id: "closure",
      alert: {
        active_period: [{ start: Math.floor(now / 1000) + 3600, end: Math.floor(now / 1000) + 7200 }],
        informed_entity: [{ agency_id: "MTASBWY", route_id: "A" }],
        header_text: { translation: [{ text: "No [A] overnight", language: "en" }] },
        description_text: { translation: [{ text: "Weekend work.", language: "en" }] },
        "transit_realtime.mercury_alert": { alert_type: "Planned - Suspended" }
      }
    }]
  };
  const snapshot = await fetchServiceAlerts({
    now,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("api-endpoint.mta.info")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => subwayFeed };
      }
      return target.includes("cloudfunctions.net") ? websiteResponse() : encodedFeedResponse();
    }
  });
  assert.deepEqual(snapshot.alerts.map((alert) => alert.agency),
    ["NYC Ferry", "NYC Ferry", "MTA Subway"]);
  assert.equal(snapshot.sourceStatus["mta-subway"], "updated");
  // Dormant, not broken: nobody has issued a 511NY key, and the board must not report that as a
  // source being down.
  assert.equal(snapshot.sourceStatus["si-ferry"], "disabled");
});

test("a subway feed going down cannot take the ferry alerts with it", async () => {
  const snapshot = await fetchServiceAlerts({
    now,
    fetchImpl: async (url) => {
      if (String(url).includes("api-endpoint.mta.info")) throw new Error("offline");
      return String(url).includes("cloudfunctions.net") ? websiteResponse() : encodedFeedResponse();
    }
  });
  assert.equal(snapshot.available, true);
  assert.deepEqual(snapshot.alerts.map((alert) => alert.agency), ["NYC Ferry", "NYC Ferry"]);
  assert.equal(snapshot.sourceStatus["mta-subway"], "unavailable");
});

test("service alerts fall back to the last disk snapshot", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-alert-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let currentTime = now;
  let fail = false;
  const service = createServiceAlertService({
    cachePath: path.join(directory, "alerts.json"),
    ttlMs: 1000,
    now: () => currentTime,
    fetchImpl: async () => {
      if (fail) throw new Error("offline");
      return encodedFeedResponse();
    }
  });

  const fresh = await service.getCurrent();
  assert.equal(fresh.alerts[0].header, "Weather delays");
  fail = true;
  currentTime += 120_000;
  const stale = await service.getCurrent();
  assert.equal(stale.stale, true);
  assert.equal(stale.cacheState, "stale");
  assert.equal(stale.alerts[0].header, "Weather delays");
});
