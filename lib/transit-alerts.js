// Alerts from the other services a rider steps onto after the boat.
//
// The board is a ferry board and stays one: everything here is strictly secondary to NYC Ferry's
// own alerts, is filtered hard, and can fail without taking the ferry alerts down with it. A
// subway closure is context for the walk at the far end, not news about a boat.

const SUBWAY_ALERTS_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json";
// 511NY is the only machine-readable source that carries Staten Island Ferry service events. It
// needs a free registration key, so this source stays dormant — not failed, dormant — until one is
// present in the environment. NYC DOT publishes no realtime feed of its own, and siferry.com renders
// its status in the browser, so there is nothing to read server-side.
const SI_FERRY_EVENTS_URL = "https://511ny.org/api/getevents";

export const TRANSIT_ALERTS_MAX_BYTES = 6 * 1024 * 1024;
// A closure that starts tonight is worth knowing on the way home; one three weekends out is not
// what an alert bar is for.
export const SUBWAY_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// "Major closure" means the trains are not running, planned or otherwise — which in this feed is
// Mercury's alert types carrying "Suspended" ("Planned - Suspended", "Planned - Part Suspended",
// and the unplanned forms). Delays, reroutes, skipped stops and elevator notices are all real
// service information and all deliberately excluded: the board has one line to spare and it belongs
// to the trains that are not coming.
const MAJOR_SUBWAY_TYPE = /suspended/i;

function text(field) {
  const translations = field?.translation;
  if (!Array.isArray(translations) || translations.length === 0) return "";
  const english = translations.find((entry) => (entry?.language || "en").toLowerCase().startsWith("en"));
  return String((english || translations[0])?.text || "").trim();
}

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 1000 : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// Active now, or starting inside the lookahead. An alert with no period at all is treated as
// current, which is what the GTFS spec means by leaving it out.
function withinWindow(periods, now, lookaheadMs) {
  if (!Array.isArray(periods) || periods.length === 0) return true;
  return periods.some((period) => {
    const start = seconds(period?.start);
    const end = seconds(period?.end);
    if (end != null && end < now) return false;
    return start == null || start <= now + lookaheadMs;
  });
}

// Which of an alert's active periods is the one a reader needs. These alerts rarely carry a single
// window: a weekend closure is published as four or five separate overnight ones, and printing all
// of them would bury the answer to "is it running right now?".
//
// So: the period happening now if there is one, and otherwise the next one due to start. A period
// with no start is treated as already begun, which is what GTFS means by leaving it out, and one
// with no end as still running.
export function currentWindow(periods, now) {
  const parsed = (Array.isArray(periods) ? periods : [])
    .map((period) => ({ start: seconds(period?.start), end: seconds(period?.end) }))
    .filter((period) => period.end == null || period.end >= now)
    .sort((left, right) => (left.start ?? -Infinity) - (right.start ?? -Infinity));
  const active = parsed.find((period) => (period.start == null || period.start <= now));
  const window = active || parsed[0] || null;
  if (!window) return { window: null, activeNow: false };
  return {
    window: {
      start: window.start == null ? null : new Date(window.start).toISOString(),
      end: window.end == null ? null : new Date(window.end).toISOString()
    },
    activeNow: Boolean(active)
  };
}

export function normalizeSubwayAlerts(payload, { now = Date.now(), lookaheadMs = SUBWAY_LOOKAHEAD_MS } = {}) {
  const entities = Array.isArray(payload?.entity) ? payload.entity : [];
  const alerts = [];
  for (const entity of entities) {
    const alert = entity?.alert;
    if (!alert) continue;
    const mercury = alert["transit_realtime.mercury_alert"] || {};
    const alertType = String(mercury.alert_type || "");
    if (!MAJOR_SUBWAY_TYPE.test(alertType)) continue;
    const periods = alert.active_period;
    if (!withinWindow(periods, now, lookaheadMs)) continue;

    const header = text(alert.header_text);
    const description = text(alert.description_text);
    if (!header && !description) continue;
    const routeIds = unique((alert.informed_entity || []).map((informed) => informed?.route_id));
    const { window, activeNow } = currentWindow(periods, now);
    alerts.push({
      id: `mta-subway-${entity.id || alerts.length + 1}`,
      source: "mta-subway",
      agency: "MTA Subway",
      // The routes are the headline on a subway closure: a rider scanning this wants to know which
      // letters are dead before they read a word of prose.
      header: routeIds.length ? `${routeIds.join(" ")} — ${header || alertType}` : header || alertType,
      description,
      url: "https://new.mta.info/alerts/subway",
      cause: null,
      effect: alertType.replace(/^Planned - /, "") || null,
      // Work the MTA scheduled, as opposed to something that has gone wrong. The distinction is the
      // reader's first question and the feed answers it in the alert type, so it is carried through
      // rather than inferred from whether the window has started.
      planned: /^planned/i.test(alertType),
      // Whether the trains are stopped at this moment, and the window that says so. See
      // currentWindow(): one alert usually carries a week of separate overnight closures.
      activeNow,
      window,
      activePeriods: (Array.isArray(periods) ? periods : []).map((period) => ({
        start: seconds(period?.start) == null ? null : new Date(seconds(period.start)).toISOString(),
        end: seconds(period?.end) == null ? null : new Date(seconds(period.end)).toISOString()
      })),
      routeIds,
      stopIds: [],
      tripIds: []
    });
  }
  // Trains that are stopped right now come first, whatever the clock says about anything else: an
  // alert about tonight is useful, but an alert about this minute is the one somebody is standing
  // in. Within each half, soonest first — so among the closures still to come, the one a rider is
  // about to walk into leads.
  return alerts.sort((left, right) => {
    if (left.activeNow !== right.activeNow) return left.activeNow ? -1 : 1;
    const leftStart = Date.parse(left.window?.start || "") || 0;
    const rightStart = Date.parse(right.window?.start || "") || 0;
    return leftStart - rightStart;
  });
}

async function fetchJson({ fetchImpl, url, timeoutMs, contact, maxBytes = TRANSIT_ALERTS_MAX_BYTES }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("A transit alert feed URL must use HTTP or HTTPS.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": `Pier11-NYCF-Kiosk/1.0 (${contact})` }
    });
    if (!response.ok) throw new Error(`Transit alert feed responded ${response.status}.`);
    const length = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(length) && length > maxBytes) {
      throw new Error("Transit alert feed is larger than the allowed size.");
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSubwayAlerts({
  fetchImpl = globalThis.fetch,
  url = process.env.MTA_SUBWAY_ALERTS_URL || SUBWAY_ALERTS_URL,
  now = Date.now(),
  lookaheadMs = SUBWAY_LOOKAHEAD_MS,
  timeoutMs = 8000,
  contact = process.env.ALERTS_CONTACT || "juliet.fuhr@hornblower.com"
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const payload = await fetchJson({ fetchImpl, url, timeoutMs, contact });
  return normalizeSubwayAlerts(payload, { now, lookaheadMs });
}

// 511NY returns a flat list of events. Only the ferry ones concern this board, and of those only the
// Staten Island Ferry: everything else on the water here is already covered by the operators the
// board carries directly.
//
// Written defensively on purpose. This has never been run against a live 511NY response — the feed
// needs a key nobody has issued yet — so it reads every field through a fallback and drops anything
// it cannot make sense of, rather than assuming a shape and throwing on the board.
export function normalizeSiFerryAlerts(payload, { now = Date.now() } = {}) {
  const events = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
  const alerts = [];
  for (const [index, event] of events.entries()) {
    const haystack = [event?.EventType, event?.FacilityName, event?.RoadwayName, event?.Description, event?.Agency]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    if (!haystack.includes("ferry")) continue;
    if (!haystack.includes("staten island")) continue;
    const header = String(event?.Title || event?.EventType || "Staten Island Ferry service alert").trim();
    const description = String(event?.Description || "").trim();
    const endMs = Date.parse(event?.EndDate || "");
    if (Number.isFinite(endMs) && endMs < now) continue;
    alerts.push({
      id: `si-ferry-${event?.ID || index + 1}`,
      source: "si-ferry",
      agency: "Staten Island Ferry",
      header,
      description,
      url: "https://www.siferry.com/",
      cause: null,
      effect: String(event?.EventType || "").trim() || null,
      activePeriods: [{
        start: Number.isFinite(Date.parse(event?.StartDate || "")) ? new Date(Date.parse(event.StartDate)).toISOString() : null,
        end: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null
      }],
      routeIds: [],
      stopIds: [],
      tripIds: []
    });
  }
  return alerts;
}

export async function fetchSiFerryAlerts({
  fetchImpl = globalThis.fetch,
  url = process.env.SIFERRY_ALERTS_URL || SI_FERRY_EVENTS_URL,
  key = process.env.SIFERRY_ALERTS_KEY || "",
  now = Date.now(),
  timeoutMs = 8000,
  contact = process.env.ALERTS_CONTACT || "juliet.fuhr@hornblower.com"
} = {}) {
  // No key, no source. Deliberately not an error: a board with nobody's 511NY key is the normal
  // state of this deployment, and it must not be reported as something being broken.
  if (!key) return null;
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const endpoint = new URL(url);
  endpoint.searchParams.set("key", key);
  endpoint.searchParams.set("format", "json");
  const payload = await fetchJson({ fetchImpl, url: endpoint.toString(), timeoutMs, contact });
  return normalizeSiFerryAlerts(payload, { now });
}
