import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { landingChoices, loadAllLandingData, operatorRoster, stopIdsForLanding } from "./lib/landing-data.js";
import { clampLimit, createConnectionIndex, tripConnections, vesselsByBoat } from "./lib/connections.js";
import { createCounterService } from "./lib/counters.js";
import { openStatsStore } from "./lib/stats-store.js";
import { describeBoats, loadHarborMap } from "./lib/fleet-map.js";
import { createManualOverrideService } from "./lib/manual-overrides.js";
import { createNyuRealtimeService } from "./lib/nyu-realtime.js";
import { createRealtimeService } from "./lib/realtime.js";
import { createServiceAlertService } from "./lib/service-alerts.js";
import { createSftpOverridePoller, loadSftpOverrideConfig } from "./lib/sftp-overrides.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(PUBLIC, "data/display-data.json");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8090);
const DISPLAY_CONFIG = path.join(ROOT, "config/display.json");
const SFTP_CONFIG = path.join(ROOT, "config/sftp.json");
const displayConfig = JSON.parse(await readFile(DISPLAY_CONFIG, "utf8"));
const sftpConfig = await loadSftpOverrideConfig({ configPath: SFTP_CONFIG, rootPath: ROOT });

// This server answers for every landing, not just config/display.json's. See lib/landing-data.js
// for why the merged view matters as much as the per-landing map: without it the realtime feeds
// stay scoped to one landing and partner operators docking elsewhere never get fetched at all.
const LANDING_CHOICES = landingChoices(JSON.parse(await readFile(path.join(ROOT, "config/landings.json"), "utf8")));
const landingData = await loadAllLandingData({ root: ROOT, choices: LANDING_CHOICES });
const displayDataJson = new Map([...landingData.byLanding].map(([id, data]) => [id, `${JSON.stringify(data)}\n`]));
// The filter panel is per device and spans every landing, so it needs the whole roster rather
// than whatever the landing on screen happens to carry.
const OPERATORS = operatorRoster(landingData.byLanding);
const realtimeStopsByLanding = new Map([...landingData.byLanding].map(([id, data]) => [id, stopIdsForLanding(data)]));
console.log(`Loaded ${landingData.byLanding.size} of ${LANDING_CHOICES.length} landings; realtime covers ${landingData.merged.meta.landing.stopIds.length} stops.`);

// The map page's static half: the route lines, the docks and the bounds that hold them, plus the
// trip index that turns "in transit to stop 4 of trip 863" into the name of a landing. Built once
// from the bundled feed, which is the same contract the landing data above has.
const harbor = await loadHarborMap({ root: ROOT, landings: landingData.available });
const harborMapJson = `${JSON.stringify(harbor.map)}\n`;
console.log(`Charted ${harbor.map.routes.length} routes and ${harbor.map.landings.length} docks for the map.`);

const realtimeService = createRealtimeService({ loadDisplay: async () => landingData.merged, fleetPath: path.join(ROOT, "content/vessels.json"), cachePath: path.join(ROOT, "state/realtime.json") });
const nyuRealtimeService = createNyuRealtimeService({ loadDisplay: async () => landingData.merged, cachePath: path.join(ROOT, "state/nyu-realtime.json") });
const serviceAlertService = createServiceAlertService({ cachePath: path.join(ROOT, "state/service-alerts.json") });
// Every stop on the board, indexed by the pier it belongs to, so the trip view can be told what
// leaves from the far end of a sailing. Built once from the landings already in memory and holding
// their departures by reference — see lib/connections.js.
const connectionIndex = createConnectionIndex(landingData.byLanding);
// The landings this server actually built, which is what a notice can meaningfully be posted for.
const LANDING_IDS = new Set(landingData.available.map((landing) => landing.id));
const manualOverrideService = createManualOverrideService({ statePath: path.join(ROOT, "state/manual-overrides.json"), landingIds: LANDING_IDS });
const sftpOverridePoller = createSftpOverridePoller({ config: sftpConfig, landingId: displayConfig.landingNumber, landingIds: LANDING_IDS, cacheService: manualOverrideService });
const statsStore = await openStatsStore({ databasePath: path.join(ROOT, "state/stats.db") });
// The totals that existed before the history did. Folded into the hour they were last written and
// marked, so the lifetime numbers on the stats page survive the deploy that gave them a time axis.
const imported = await statsStore.importLegacyCounters(path.join(ROOT, "state/counters.json"));
if (imported.imported) console.log(`Imported the previous counters, dating from ${imported.since}.`);
statsStore.markSince(new Date().toISOString());
const pruned = statsStore.prune();
if (pruned.removed) console.log(`Pruned ${pruned.removed} stats rows older than ${pruned.cutoff}.`);
const counters = createCounterService({ store: statsStore });
// The counters key landings by number, which is what an agent dials and not what anyone reading a
// stats page knows a dock by.
const LANDING_NAMES = Object.fromEntries(landingData.available.map((landing) => [landing.id, landing.displayName || landing.name]));
// The extensionless pages this server answers for, and the file each one is.
//
// Reachable as /stats on a kiosk and as /ferryTimesMobile/stats on juliet.nyc. Whether the proxy
// hands the prefix on or strips it is the proxy's business and not visible from here, so both
// arrivals are answered rather than guessed between — and both are counted as the one page they
// are, since counting them apart would file the proxied spelling in with the served files.
const PAGES = new Map([["/stats", "stats.html"], ["/map", "map.html"]]);
const PROXY_PREFIX = "/ferryTimesMobile";
function pageFor(pathname) {
  // With or without the trailing slash a browser may add.
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  const canonical = trimmed.startsWith(`${PROXY_PREFIX}/`) ? trimmed.slice(PROXY_PREFIX.length) : trimmed;
  return PAGES.has(canonical) ? { canonical, file: PAGES.get(canonical) } : null;
}
// Everything counted so far, including the current minute.
//
// The rollup runs on a timer, so anything counted since the last one is still only in memory. It is
// pushed down before reading rather than merged on top afterwards: a histogram cannot be usefully
// added to a percentile once the percentile has been taken, and one extra INSERT on a page nobody
// keeps open is cheaper than carrying two half-answers around and reconciling them.
function buildStats() {
  counters.flush();
  const landings = statsStore.totals("landing");
  return {
    since: statsStore.since(),
    generatedAt: new Date().toISOString(),
    routes: statsStore.totals("route"),
    statuses: statsStore.totals("status"),
    events: statsStore.totals("event"),
    landings,
    // Only the docks that have a count. Shipping all 30 names to render the four a board has
    // actually been opened on is most of this payload for none of its meaning.
    landingNames: Object.fromEntries(Object.keys(landings).map((id) => [id, LANDING_NAMES[id]]).filter(([, name]) => name)),
    series: {
      boards: statsStore.series("route", { hours: 48, keys: ["/api/display-data"] }),
      requests: statsStore.series("route", { hours: 48 })
    },
    feed: {
      ok: statsStore.series("event", { hours: 48, keys: ["realtime-ok"] }),
      stale: statsStore.series("event", { hours: 48, keys: ["realtime-stale"] }),
      unavailable: statsStore.series("event", { hours: 48, keys: ["realtime-unavailable"] })
    },
    latency: statsStore.latencies({ hours: 24 })
  };
}

const TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".woff2":"font/woff2", ".webmanifest":"application/manifest+json; charset=utf-8" };

function headers(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
}
function json(response, status, body) { headers(response); response.writeHead(status, { "Content-Type": TYPES[".json"], "Cache-Control":"no-cache" }); response.end(`${JSON.stringify(body)}\n`); }
async function serve(response, file) {
  try { const info = await stat(file); if (!info.isFile()) throw new Error(); const extension = path.extname(file); const noCache = [".html", ".css", ".js"].includes(extension) || path.basename(file) === "sw.js"; headers(response); response.writeHead(200, { "Content-Type": TYPES[extension] || "application/octet-stream", "Content-Length": info.size, "Cache-Control": noCache ? "no-cache, must-revalidate" : "public, max-age=3600" }); createReadStream(file).pipe(response); }
  catch { json(response, 404, { error: "Not found" }); }
}
async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname === "/healthz" || url.pathname === "/api/health") return json(response, 200, { ok:true, service:"nyc-ferry-did", now:new Date().toISOString(), sftpOverride:sftpOverridePoller.status(), counters: buildStats() });
  // The counters alone, for the public stats page. /api/health carries them too, but alongside the
  // SFTP poller's target host, its key fingerprints and its last error string — fine for an
  // operator hitting health directly, not something to put behind a page anyone can open.
  if (url.pathname === "/api/stats") return json(response, 200, buildStats());
  // The change log, written by hand in content/changelog.json. Read off disk on every request
  // rather than at boot so an edit needs a deploy and not a restart, and served from /api/ so the
  // service worker treats it as data — network first, cached for offline — instead of caching it
  // for the life of a shell the way it caches everything under /assets/.
  if (url.pathname === "/api/changelog") {
    try {
      const parsed = JSON.parse(await readFile(path.join(ROOT, "content/changelog.json"), "utf8"));
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      return json(response, 200, { entries });
    } catch {
      // A change log nobody can read is not worth a 500 on a board that is otherwise fine.
      return json(response, 200, { entries: [] });
    }
  }
  if (url.pathname === "/api/landings") return json(response, 200, { landings: landingData.available, operators: OPERATORS, configured: displayConfig.landingNumber });
  if (url.pathname === "/api/display-data") {
    const requested = url.searchParams.get("landingId");
    const landingNumber = requested === null ? Number(displayConfig.landingNumber) : Number(requested);
    if (requested !== null && !displayDataJson.has(landingNumber)) return json(response, 400, { error: "Unknown landing." });
    const built = displayDataJson.get(landingNumber);
    // Falling back to the file the build wrote keeps a kiosk alive if its own landing was the one
    // that failed to build at startup — stale published times beat a blank board.
    try {
      const body = built ?? await readFile(DATA, "utf8");
      headers(response);
      response.writeHead(200, { "Content-Type":TYPES[".json"], "Cache-Control":"no-cache" });
      return response.end(body);
    } catch (error) { return json(response, 503, { error:"Display data unavailable", detail:error.message }); }
  }
  // NYU's live estimates ride along in the same payload: its updates are already namespaced with
  // the "nyu:" trip and stop ids the display was built with, so the client matches both operators
  // through one lookup. Either operator's feed failing leaves the other's usable, and one stale
  // source marks the whole payload stale — which only ever falls back to published times.
  if (url.pathname === "/api/realtime") {
    const [ferry, nyu] = await Promise.all([realtimeService.getCurrent(), nyuRealtimeService.getCurrent()]);
    // Upstream is polled once for the whole system, then narrowed per request. A client that names
    // its landing gets only its own stops, which keeps the payload the size it was before this
    // server covered all 25; omitting landingId returns everything, so an older cached client that
    // does not send it still works.
    const stops = realtimeStopsByLanding.get(Number(url.searchParams.get("landingId")));
    const updates = [...(ferry.updates || []), ...(nyu.updates || [])];
    // Where the boats are rides along in the same cached snapshot and is deliberately not forwarded
    // here. No board draws a map, and a coordinate pair per vessel on a payload every board polls
    // every fifteen seconds is weight for nobody. The map reads them from /api/boats, off this same
    // cache and without a second fetch upstream.
    const { positions, ...departureData } = ferry;
    const result = {
      ...departureData,
      available: ferry.available || nyu.available,
      stale: Boolean(ferry.stale || nyu.stale),
      updates: stops ? updates.filter((update) => stops.has(String(update.stopId))) : updates,
      nyu: { available: nyu.available, stale: nyu.stale, fetchedAt: nyu.fetchedAt, error: nyu.error }
    };
    // The status code says a payload went out; these say what was in it. A board that answers 200
    // from a stale cache all afternoon looks perfectly healthy from the outside.
    // The healthy case is counted too. A timeline of failures alone cannot tell a quiet night
    // apart from a feed that stopped being asked.
    if (!result.available) counters.event("realtime-unavailable");
    else if (result.stale) counters.event("realtime-stale");
    else counters.event("realtime-ok");
    return json(response, result.available ? 200 : 503, result);
  }
  // The map's static half. It is derived from the bundled feed and so changes only on redeploy,
  // which is worth an hour of browser cache: it is by far the largest thing the map page fetches
  // and by far the least likely to have changed since the last time it was asked for.
  if (url.pathname === "/api/map") {
    headers(response);
    response.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "public, max-age=3600" });
    return response.end(harborMapJson);
  }
  // The map's live half, read off the same cached snapshot /api/realtime uses. Ages are measured
  // against the snapshot rather than against now, so a cache being served during an upstream outage
  // shows the harbor as it stood when it was last read instead of emptying out boat by boat.
  if (url.pathname === "/api/boats") {
    const current = await realtimeService.getCurrent();
    const asOf = current.fetchedAt ? Date.parse(current.fetchedAt) : Date.now();
    const boats = describeBoats(current.positions, { trips: harbor.trips, routes: harbor.routes, asOf });
    return json(response, current.available ? 200 : 503, {
      available: current.available,
      // The vessel-position feed is fetched alongside the trip updates and can fail on its own, so
      // a payload can be current for departures and stale for positions. This page only cares
      // about the second.
      stale: Boolean(current.stale || current.vehiclesStale),
      fetchedAt: current.fetchedAt,
      error: current.error,
      boats
    });
  }
  // What else leaves from the stops one trip calls at. The client cannot answer this from its own
  // payload — that is scoped to a single landing — so it asks here, naming only the trip.
  //
  // Deliberately no time parameter. The service worker caches every /api/ URL network-first and
  // nothing prunes that cache until a version bump, so a timestamp in the query string would grow
  // it without bound; one entry per trip ever tapped is finite and worth re-serving offline.
  if (url.pathname === "/api/connections") {
    const tripId = (url.searchParams.get("tripId") || "").trim();
    if (!tripId) return json(response, 400, { error: "tripId is required." });
    // Realtime is an enrichment here, never a precondition: a feed that is down should cost the
    // trip view its delays and vessel names, not the stop list it exists to show.
    let updates = new Map(), vehicles = new Map(), vessels = new Map(), stale = true;
    try {
      const [ferry, nyu] = await Promise.all([realtimeService.getCurrent(), nyuRealtimeService.getCurrent()]);
      // System-wide, before /api/realtime narrows them to one landing — which is exactly the data
      // this endpoint needs and the only place it exists.
      updates = new Map([...(ferry.updates || []), ...(nyu.updates || [])].map((item) => [`${item.tripId}|${item.stopId}`, item]));
      vehicles = new Map((ferry.vehicles || []).map((item) => [String(item.tripId), item]));
      vessels = vesselsByBoat(ferry.vehicles || []);
      stale = Boolean(ferry.stale || nyu.stale) || !(ferry.available || nyu.available);
    } catch { /* schedule-only, and the payload says so */ }
    const result = tripConnections({
      index: connectionIndex, tripId, limit: clampLimit(url.searchParams.get("limit")),
      updates, vehicles, vessels, stale
    });
    if (!result) return json(response, 404, { error: "Unknown trip." });
    return json(response, 200, result);
  }
  if (url.pathname === "/api/alerts") { const result = await serviceAlertService.getCurrent(); return json(response, result.available ? 200 : 503, result); }
  if (url.pathname === "/api/override") {
    response.setHeader("Allow", "GET");
    try {
      if (request.method === "GET") {
        const saved = await manualOverrideService.get(url.searchParams.get("landingId"));
        return json(response, 200, sftpConfig.enabled ? saved : { ...saved, active:false, message:"", updatedAt:null });
      }
      return json(response, 405, { error: "Method not allowed" });
    } catch (error) {
      const status = error.statusCode || (error instanceof TypeError || error instanceof RangeError ? 400 : 500);
      return json(response, status, { error: status === 500 ? "Manual override unavailable." : error.message });
    }
  }
  const page = pageFor(url.pathname);
  if (page) return serve(response, path.join(PUBLIC, page.file));
  let relative; try { relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "")); } catch { return json(response, 400, { error:"Invalid path" }); }
  const file = path.resolve(PUBLIC, relative); if (!file.startsWith(`${PUBLIC}${path.sep}`)) return json(response, 403, { error:"Forbidden" });
  return serve(response, file);
}
// Counted once per request, from one place, after the response has gone out — so the count knows
// the status it ended with and nothing on the request path can be slowed or broken by counting it.
function count(request, response) {
  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    // Only the payload a board fetches when it opens or switches docks counts as viewing a landing.
    // Realtime and override both carry landingId too, and both are polled — every 15 and every 5
    // seconds — so counting those would measure how long a board was left on, which is a different
    // question wearing this one's clothes. A request with no landingId is a kiosk on the landing it
    // was configured for, and is the view it looks like rather than nothing at all.
    const requested = url.searchParams.get("landingId");
    const landingId = requested === null ? Number(displayConfig.landingNumber) : Number(requested);
    counters.record({
      route: pageFor(url.pathname)?.canonical || url.pathname,
      landingId: url.pathname === "/api/display-data" && displayDataJson.has(landingId) ? landingId : undefined,
      status: response.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
    });
  });
}
const server = http.createServer((request, response) => {
  count(request, response);
  return handle(request, response).catch((error) => { console.error(error); if (!response.headersSent) json(response, 500, { error:"Internal server error" }); });
});
server.listen(PORT, HOST, () => {
  console.log(`NYC Ferry DiD ready at http://${HOST}:${PORT}`);
  sftpOverridePoller.start();
  counters.start();
});
const shutdown = () => server.close(() => void Promise.all([sftpOverridePoller.stop(), counters.stop()]).finally(() => { statsStore.close(); process.exit(0); }));
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
