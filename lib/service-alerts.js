import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;

export const SERVICE_ALERTS_FEED_URL =
  "https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/alert";
export const WEBSITE_SERVICE_ALERTS_URL =
  "https://us-central1-nyc-ferry.cloudfunctions.net/nycf_service_alerts?lang=en";
export const SERVICE_ALERTS_TTL_MS = 60_000;
export const SERVICE_ALERTS_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_CONTACT = "juliet.fuhr@hornblower.com";

const WEBSITE_ROUTE_GROUPS = {
  eastriverroutealerts: "ER",
  astoriaroutealerts: "AS",
  southbrooklynroutealerts: "SB",
  stgeorgeroutealerts: "SG",
  roackawayroutealerts: "RS",
  rockawayroutealerts: "RS",
  soundviewroutealerts: "RS",
  governorsislandroutealerts: "GI"
};

const CAUSES = {
  1: "Unknown cause",
  2: "Other cause",
  3: "Technical problem",
  4: "Strike",
  5: "Demonstration",
  6: "Accident",
  7: "Holiday",
  8: "Weather",
  9: "Maintenance",
  10: "Construction",
  11: "Police activity",
  12: "Medical emergency"
};

const EFFECTS = {
  1: "No service",
  2: "Reduced service",
  3: "Significant delays",
  4: "Detour",
  5: "Additional service",
  6: "Modified service",
  7: "Other effect",
  8: "Unknown effect",
  9: "Stop moved",
  10: "No effect",
  11: "Accessibility issue"
};

function finiteNumber(value) {
  if (value == null) return null;
  if (typeof value?.toNumber === "function") return value.toNumber();
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function translatedText(value) {
  const translations = value?.translation || [];
  const preferred = translations.find((entry) => /^en(?:-|$)/i.test(entry.language || ""));
  return String(preferred?.text || translations[0]?.text || "").trim();
}

function translatedTextMap(value) {
  const result = {};
  for (const entry of value?.translation || []) {
    const text = String(entry?.text || "").trim();
    if (!text) continue;
    const language = String(entry?.language || "und").trim().replaceAll("_", "-").toLowerCase();
    result[language] ??= text;
    const base = language.split("-")[0];
    result[base] ??= text;
  }
  return result;
}

function isoTimestamp(seconds) {
  return seconds == null ? null : new Date(seconds * 1000).toISOString();
}

function optionalPeriodTime(period, field) {
  return Object.hasOwn(period || {}, field) ? finiteNumber(period[field]) : null;
}

function periodIsActive(period, nowSeconds) {
  const start = optionalPeriodTime(period, "start");
  const end = optionalPeriodTime(period, "end");
  return (start == null || nowSeconds >= start) && (end == null || nowSeconds <= end);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizedAlertIsActive(alert, nowMs) {
  const periods = alert.activePeriods || [];
  if (!periods.length) return true;
  return periods.some((period) => {
    const start = period.start ? Date.parse(period.start) : Number.NEGATIVE_INFINITY;
    const end = period.end ? Date.parse(period.end) : Number.POSITIVE_INFINITY;
    return nowMs >= start && nowMs <= end;
  });
}

function currentSnapshot(snapshot, nowMs) {
  return {
    ...snapshot,
    alerts: (snapshot.alerts || []).filter((alert) => normalizedAlertIsActive(alert, nowMs))
  };
}

export function normalizeServiceAlerts(feed, { now = Date.now() } = {}) {
  const nowSeconds = Math.floor(now / 1000);
  const alerts = [];

  for (const entity of feed?.entity || []) {
    const alert = entity?.alert;
    if (!alert) continue;
    const periods = alert.activePeriod || [];
    if (periods.length && !periods.some((period) => periodIsActive(period, nowSeconds))) continue;
    const informedEntities = alert.informedEntity || [];
    const header = translatedText(alert.headerText);
    const description = translatedText(alert.descriptionText);
    const translatedHeaders = translatedTextMap(alert.headerText);
    const translatedDescriptions = translatedTextMap(alert.descriptionText);
    const translatedUrls = translatedTextMap(alert.url);
    const translations = Object.fromEntries(
      unique([
        ...Object.keys(translatedHeaders),
        ...Object.keys(translatedDescriptions),
        ...Object.keys(translatedUrls)
      ]).map((language) => [language, {
        header: translatedHeaders[language] || "",
        description: translatedDescriptions[language] || "",
        url: translatedUrls[language] || ""
      }])
    );
    const effect = EFFECTS[finiteNumber(alert.effect)] || null;
    if (!header && !description && !effect) continue;

    alerts.push({
      id: String(entity.id || `alert-${alerts.length + 1}`),
      source: "gtfs",
      header: header || effect || "NYC Ferry service alert",
      description,
      url: translatedText(alert.url),
      translations,
      cause: CAUSES[finiteNumber(alert.cause)] || null,
      effect,
      activePeriods: periods.map((period) => ({
        start: isoTimestamp(optionalPeriodTime(period, "start")),
        end: isoTimestamp(optionalPeriodTime(period, "end"))
      })),
      routeIds: unique(informedEntities.map((entity) => entity.routeId)),
      stopIds: unique(informedEntities.map((entity) => entity.stopId)),
      tripIds: unique(informedEntities.map((entity) => entity.trip?.tripId))
    });
  }

  return alerts.sort((left, right) => left.header.localeCompare(right.header));
}

function websiteTimestamp(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  return number < 1_000_000_000_000 ? number * 1000 : number;
}

function websiteRouteIds(groups) {
  return unique((groups || []).map((group) =>
    WEBSITE_ROUTE_GROUPS[String(group || "").toLowerCase().replace(/[^a-z]/g, "")]
  ));
}

export function normalizeWebsiteServiceAlerts(payload, { now = Date.now() } = {}) {
  if (!Array.isArray(payload)) return [];
  return payload
    .flatMap((item, index) => {
      const header = String(item?.notificationTitle || "").trim();
      const description = String(item?.notificationBody || "").trim();
      const createdAtMs = websiteTimestamp(item?.createdDate);
      const expiresAtMs = websiteTimestamp(item?.expirationDate);
      if (!header && !description) return [];
      if (createdAtMs != null && createdAtMs > now + 5 * 60_000) return [];
      if (expiresAtMs != null && expiresAtMs < now) return [];
      const idPart = createdAtMs ?? `${index + 1}`;
      const url = String(item?.scheduleUrl || "").trim() || "https://www.ferry.nyc/service-alerts/";
      return [{
        id: `website-${idPart}`,
        source: "website",
        header: header || "NYC Ferry service alert",
        description,
        url,
        translations: {
          en: { header, description, url }
        },
        cause: null,
        effect: null,
        activePeriods: [{
          start: createdAtMs == null ? null : new Date(createdAtMs).toISOString(),
          end: expiresAtMs == null ? null : new Date(expiresAtMs).toISOString()
        }],
        routeIds: websiteRouteIds(item?.notificationGroups),
        stopIds: [],
        tripIds: [],
        websiteGroups: unique(item?.notificationGroups || []),
        createdAt: createdAtMs == null ? null : new Date(createdAtMs).toISOString(),
        expiresAt: expiresAtMs == null ? null : new Date(expiresAtMs).toISOString()
      }];
    })
    .sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
}

async function fetchGtfsServiceAlerts({
  fetchImpl = globalThis.fetch,
  url = process.env.NYCF_ALERTS_URL || SERVICE_ALERTS_FEED_URL,
  now = Date.now(),
  timeoutMs = 8000,
  contact = process.env.ALERTS_CONTACT || DEFAULT_CONTACT
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("The service-alert feed URL must use HTTP or HTTPS.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: "application/x-protobuf, application/octet-stream",
        "User-Agent": `Pier11-NYCF-Kiosk/1.0 (${contact})`
      }
    });
    if (!response.ok) throw new Error(`NYC Ferry alert feed returned ${response.status}.`);
    const contentLength = finiteNumber(response.headers?.get?.("content-length"));
    if (contentLength != null && contentLength > SERVICE_ALERTS_MAX_BYTES) {
      throw new Error("NYC Ferry alert feed exceeded the size limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > SERVICE_ALERTS_MAX_BYTES) {
      throw new Error("NYC Ferry alert feed exceeded the size limit.");
    }
    const feed = transitRealtime.FeedMessage.decode(bytes);
    const feedTimestampSeconds = finiteNumber(feed?.header?.timestamp);
    return {
      available: true,
      stale: false,
      cacheState: "updated",
      fetchedAt: new Date(now).toISOString(),
      feedTimestamp: isoTimestamp(feedTimestampSeconds),
      alerts: normalizeServiceAlerts(feed, { now })
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWebsiteServiceAlerts({
  fetchImpl = globalThis.fetch,
  url = process.env.NYCF_WEBSITE_ALERTS_URL || WEBSITE_SERVICE_ALERTS_URL,
  now = Date.now(),
  timeoutMs = 8000,
  contact = process.env.ALERTS_CONTACT || DEFAULT_CONTACT
} = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("The website-alert feed URL must use HTTP or HTTPS.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": `Pier11-NYCF-Kiosk/1.0 (${contact})`
      }
    });
    if (!response.ok) throw new Error(`NYC Ferry website-alert feed returned ${response.status}.`);
    const contentLength = finiteNumber(response.headers?.get?.("content-length"));
    if (contentLength != null && contentLength > SERVICE_ALERTS_MAX_BYTES) {
      throw new Error("NYC Ferry website-alert feed exceeded the size limit.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > SERVICE_ALERTS_MAX_BYTES) {
      throw new Error("NYC Ferry website-alert feed exceeded the size limit.");
    }
    return normalizeWebsiteServiceAlerts(JSON.parse(text), { now });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchServiceAlerts({
  fetchImpl = globalThis.fetch,
  url = process.env.NYCF_ALERTS_URL || SERVICE_ALERTS_FEED_URL,
  websiteUrl = process.env.NYCF_WEBSITE_ALERTS_URL || WEBSITE_SERVICE_ALERTS_URL,
  now = Date.now(),
  timeoutMs = 8000,
  contact = process.env.ALERTS_CONTACT || DEFAULT_CONTACT
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const [gtfsResult, websiteResult] = await Promise.allSettled([
    fetchGtfsServiceAlerts({ fetchImpl, url, now, timeoutMs, contact }),
    fetchWebsiteServiceAlerts({
      fetchImpl,
      url: websiteUrl,
      now,
      timeoutMs,
      contact
    })
  ]);
  if (gtfsResult.status === "rejected" && websiteResult.status === "rejected") {
    throw new AggregateError(
      [gtfsResult.reason, websiteResult.reason],
      "NYC Ferry service-alert sources are unavailable."
    );
  }
  const gtfsSnapshot = gtfsResult.status === "fulfilled" ? gtfsResult.value : null;
  const websiteAlerts = websiteResult.status === "fulfilled" ? websiteResult.value : [];
  return {
    available: true,
    stale: false,
    partial: !gtfsSnapshot || websiteResult.status !== "fulfilled",
    cacheState: "updated",
    fetchedAt: new Date(now).toISOString(),
    feedTimestamp: gtfsSnapshot?.feedTimestamp || null,
    sourceStatus: {
      gtfs: gtfsSnapshot ? "updated" : "unavailable",
      website: websiteResult.status === "fulfilled" ? "updated" : "unavailable"
    },
    alerts: [...(gtfsSnapshot?.alerts || []), ...websiteAlerts]
  };
}

export function createServiceAlertService({
  cachePath,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = SERVICE_ALERTS_TTL_MS,
  url,
  websiteUrl,
  contact
}) {
  if (!cachePath) throw new Error("cachePath is required.");
  let memoryCache = null;
  let cacheRead = false;
  let inFlight = null;

  async function loadCache() {
    if (cacheRead) return memoryCache;
    cacheRead = true;
    try {
      const parsed = JSON.parse(await readFile(cachePath, "utf8"));
      if (parsed?.available && Array.isArray(parsed.alerts)) {
        memoryCache = {
          ...parsed,
          alerts: parsed.alerts.map((alert) => ({
            ...alert,
            source: alert.source || "gtfs"
          }))
        };
      }
    } catch {
      memoryCache = null;
    }
    return memoryCache;
  }

  async function persist(snapshot) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    const temporaryPath = `${cachePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`, "utf8");
    await rename(temporaryPath, cachePath);
  }

  async function getCurrent() {
    const cached = await loadCache();
    const ageMs = cached ? now() - Date.parse(cached.fetchedAt) : Number.POSITIVE_INFINITY;
    if (cached && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs) {
      return { ...currentSnapshot(cached, now()), stale: false, cacheState: "fresh" };
    }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const latest = await fetchServiceAlerts({
          fetchImpl,
          url,
          websiteUrl,
          now: now(),
          contact
        });
        const unavailableSources = Object.entries(latest.sourceStatus || {})
          .filter(([, status]) => status === "unavailable")
          .map(([source]) => source);
        const savedAlerts = unavailableSources.length
          ? (cached?.alerts || []).filter(
              (alert) => unavailableSources.includes(alert.source || "gtfs") &&
                normalizedAlertIsActive(alert, now())
            )
          : [];
        const existingIds = new Set(latest.alerts.map((alert) => `${alert.source}:${alert.id}`));
        const fresh = {
          ...latest,
          sourceStatus: {
            ...latest.sourceStatus,
            ...Object.fromEntries(
              unavailableSources
                .filter((source) => savedAlerts.some((alert) => (alert.source || "gtfs") === source))
                .map((source) => [source, "saved"])
            )
          },
          alerts: [
            ...latest.alerts,
            ...savedAlerts.filter((alert) => !existingIds.has(`${alert.source}:${alert.id}`))
          ]
        };
        memoryCache = fresh;
        try {
          await persist(fresh);
        } catch {
          // The current alert snapshot remains usable if disk persistence fails.
        }
        return fresh;
      } catch {
        if (cached) {
          return {
            ...currentSnapshot(cached, now()),
            stale: true,
            cacheState: "stale",
            error: "Live service alerts are unavailable; showing the last saved update."
          };
        }
        return {
          available: false,
          stale: true,
          cacheState: "unavailable",
          fetchedAt: null,
          feedTimestamp: null,
          alerts: [],
          error: "Live service alerts are temporarily unavailable."
        };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { getCurrent };
}
