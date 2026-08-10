import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDisplayData } from "./scripts/build-data.js";
import { createManualOverrideService } from "./lib/manual-overrides.js";
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
const realtimeService = createRealtimeService({ dataPath: DATA, fleetPath: path.join(ROOT, "content/vessels.json"), cachePath: path.join(ROOT, "state/realtime.json") });
const serviceAlertService = createServiceAlertService({ cachePath: path.join(ROOT, "state/service-alerts.json") });
const manualOverrideService = createManualOverrideService({ statePath: path.join(ROOT, "state/manual-overrides.json") });
const sftpOverridePoller = createSftpOverridePoller({ config: sftpConfig, landingId: displayConfig.landingNumber, cacheService: manualOverrideService });
const TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".woff2":"font/woff2", ".webmanifest":"application/manifest+json; charset=utf-8" };

// Landings an agent can switch between from the menu. config/landings.json is the source of
// truth, same as the build, so adding a landing there makes it selectable with no other change.
const landings = JSON.parse(await readFile(path.join(ROOT, "config/landings.json"), "utf8"));
const LANDING_CHOICES = Object.entries(landings)
  .filter(([, item]) => !item.unused)
  .map(([id, item]) => ({ id: Number(id), displayName: item.displayName || item.name || `Landing ${id}` }))
  .sort((left, right) => left.displayName.localeCompare(right.displayName));
const SELECTABLE_LANDINGS = new Set(LANDING_CHOICES.map((item) => item.id));

// Switching landings rebuilds display data on demand (~25ms warm). Results are cached for the
// life of the process because the inputs — the bundled GTFS feed and config/display.json — only
// change on redeploy, which is the same restart-after-config-change contract the build has.
const displayDataCache = new Map();
async function displayDataFor(landingNumber) {
  const cached = displayDataCache.get(landingNumber);
  if (cached) return cached;
  const built = `${JSON.stringify(await buildDisplayData({ root: ROOT, landingNumber }))}\n`;
  displayDataCache.set(landingNumber, built);
  return built;
}

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
  if (url.pathname === "/api/landings") return json(response, 200, { landings: LANDING_CHOICES, configured: displayConfig.landingNumber });
  if (url.pathname === "/api/display-data") {
    const requested = url.searchParams.get("landingId");
    try {
      // No landingId keeps the original contract: serve the file the build produced.
      if (requested === null) {
        const data = await readFile(DATA, "utf8");
        headers(response);
        response.writeHead(200, { "Content-Type":TYPES[".json"], "Cache-Control":"no-cache" });
        return response.end(data);
      }
      const landingNumber = Number(requested);
      if (!Number.isInteger(landingNumber) || !SELECTABLE_LANDINGS.has(landingNumber)) {
        return json(response, 400, { error: "Unknown landing." });
      }
      headers(response);
      response.writeHead(200, { "Content-Type":TYPES[".json"], "Cache-Control":"no-cache" });
      return response.end(await displayDataFor(landingNumber));
    } catch (error) { return json(response, 503, { error:"Display data unavailable", detail:error.message }); }
  }
  if (url.pathname === "/api/realtime") { const result = await realtimeService.getCurrent(); return json(response, result.available ? 200 : 503, result); }
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
