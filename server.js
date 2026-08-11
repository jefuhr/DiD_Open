import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { landingChoices, loadAllLandingData, stopIdsForLanding } from "./lib/landing-data.js";
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
const realtimeStopsByLanding = new Map([...landingData.byLanding].map(([id, data]) => [id, stopIdsForLanding(data)]));
console.log(`Loaded ${landingData.byLanding.size} of ${LANDING_CHOICES.length} landings; realtime covers ${landingData.merged.meta.landing.stopIds.length} stops.`);

const realtimeService = createRealtimeService({ loadDisplay: async () => landingData.merged, fleetPath: path.join(ROOT, "content/vessels.json"), cachePath: path.join(ROOT, "state/realtime.json") });
const nyuRealtimeService = createNyuRealtimeService({ loadDisplay: async () => landingData.merged, cachePath: path.join(ROOT, "state/nyu-realtime.json") });
const serviceAlertService = createServiceAlertService({ cachePath: path.join(ROOT, "state/service-alerts.json") });
const manualOverrideService = createManualOverrideService({ statePath: path.join(ROOT, "state/manual-overrides.json") });
const sftpOverridePoller = createSftpOverridePoller({ config: sftpConfig, landingId: displayConfig.landingNumber, cacheService: manualOverrideService });
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
  if (url.pathname === "/healthz" || url.pathname === "/api/health") return json(response, 200, { ok:true, service:"nyc-ferry-did", now:new Date().toISOString(), sftpOverride:sftpOverridePoller.status() });
  if (url.pathname === "/api/landings") return json(response, 200, { landings: landingData.available, configured: displayConfig.landingNumber });
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
    const result = {
      ...ferry,
      available: ferry.available || nyu.available,
      stale: Boolean(ferry.stale || nyu.stale),
      updates: stops ? updates.filter((update) => stops.has(String(update.stopId))) : updates,
      nyu: { available: nyu.available, stale: nyu.stale, fetchedAt: nyu.fetchedAt, error: nyu.error }
    };
    return json(response, result.available ? 200 : 503, result);
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
  let relative; try { relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "")); } catch { return json(response, 400, { error:"Invalid path" }); }
  const file = path.resolve(PUBLIC, relative); if (!file.startsWith(`${PUBLIC}${path.sep}`)) return json(response, 403, { error:"Forbidden" });
  return serve(response, file);
}
const server = http.createServer((request, response) => handle(request, response).catch((error) => { console.error(error); if (!response.headersSent) json(response, 500, { error:"Internal server error" }); }));
server.listen(PORT, HOST, () => {
  console.log(`NYC Ferry DiD ready at http://${HOST}:${PORT}`);
  sftpOverridePoller.start();
});
const shutdown = () => server.close(() => void sftpOverridePoller.stop().finally(() => process.exit(0)));
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
