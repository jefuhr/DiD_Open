import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appPath = new URL("../public/app.js", import.meta.url);
const cssPath = new URL("../public/styles.css", import.meta.url);
const indexPath = new URL("../public/index.html", import.meta.url);
const workerPath = new URL("../public/sw.js", import.meta.url);
const serverPath = new URL("../server.js", import.meta.url);

test("marks the final trip in each route-direction slot as LAST", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(app, /const slotKey = `\$\{departure\.routeId\}\|\$\{departure\.variant \|\| ""\}\|\$\{departure\.directionId\}`/);
  assert.match(app, /isLastOfDay: lastDepartures\.get/);
  assert.match(app, /class="departure-last-badge"[^>]*>LAST<\/strong>/);
  assert.doesNotMatch(app, /const slotKey = .*destination/);
});

test("marks the final South Brooklyn trip serving Governors Island", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(app, /departure\.routeId === "SB" && departure\.servesGovernorsIsland/);
  assert.match(app, /isLastGovernorsIsland: departure\.servesGovernorsIsland/);
  assert.match(app, /Last South Brooklyn departure serving Governors Island/);
  assert.match(app, /item\.isLastOfDay \|\| item\.isLastGovernorsIsland/);
});

test("uses the kiosk yellow LAST badge styling", async () => {
  const [app, css] = await Promise.all([readFile(appPath, "utf8"), readFile(cssPath, "utf8")]);
  assert.match(css, /--warning:#ffd100/);
  assert.match(app, /<span class="departure-last-slot">\$\{lastLabel\}/);
  assert.match(css, /\.departure-last-slot\{[^}]*min-height:/);
  assert.match(css, /\.departure-last-badge\{[^}]*background:var\(--warning\)[^}]*border:2px solid #d89a26[^}]*border-radius:8px/);
});

test("shows fresh late and on-time status in the reserved badge row", async () => {
  const [app, css] = await Promise.all([readFile(appPath, "utf8"), readFile(cssPath, "utf8")]);
  assert.match(app, /hasFreshTiming = !realtime\.stale && item\.hasLiveTiming/);
  assert.match(app, /delaySeconds >= 60/);
  assert.match(app, />\+\$\{Math\.max\(1, Math\.round\(delaySeconds \/ 60\)\)\} min<\/span>/);
  assert.match(app, /class="on-time-badge"[^>]*>ON TIME<\/span>/);
  assert.match(app, /class="scheduled-badge"[^>]*>SCHEDULED<\/span>/);
  assert.match(app, /!isLast && !delayLabel && !onTimeLabel/);
  assert.match(app, /departure-last-slot">\$\{lastLabel\}\$\{noPickupLabel\}\$\{delayLabel \|\| onTimeLabel \|\| scheduledLabel\}/);
  assert.match(css, /\.vessel-delay-badge\{background:#b83224\}/);
  assert.match(css, /\.on-time-badge\{background:#218a4b\}/);
  assert.match(css, /\.scheduled-badge\{color:var\(--navy\);background:#e6eef2/);
});

test("never displays a realtime departure earlier than its scheduled time", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(app, /const delay = hasLiveTiming \? Math\.max\(0, liveDelay\) : 0/);
});

test("service alert freshness sits beside its heading", async () => {
  const [index, css] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);
  assert.match(index, /class="service-alert-heading">\s*<strong>Service alerts<\/strong>\s*<small id="serviceAlertFreshness">/);
  assert.match(css, /\.service-alert-heading\{display:flex;align-items:baseline/);
});

test("staff board shows every route direction at once with config-driven departure columns", async () => {
  const [app, css] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);
  assert.match(app, /displayCount\("departuresShown"\)/);
  assert.match(app, /dataset\.departuresShown/);
  assert.match(app, /setProperty\("--routes-shown", String\(Math\.max\(1, groups\.length\)\)\)/);
  assert.doesNotMatch(app, /slideTimer|startSlideshow|slideIndex|PAGE_SIZE|TIMES_PER_DIRECTION/);
  assert.match(css, /repeat\(var\(--routes-shown\),minmax\(0,1fr\)\)/);
  assert.match(css, /repeat\(var\(--departures-shown\),minmax\(0,1fr\)\)/);
  for (let count = 1; count <= 5; count += 1) {
    assert.match(css, new RegExp(`data-departures-shown="${count}"`));
  }
});

test("shows the crew boat assignment beside the boat name", async () => {
  const [app, css] = await Promise.all([readFile(appPath, "utf8"), readFile(cssPath, "utf8")]);
  assert.match(app, /Number\.isInteger\(item\.boatAssignment\)/);
  assert.match(app, /routeShortName\(item\.routeId\)\}\$\{item\.boatAssignment\}/);
  assert.match(app, /class="boat-assignment"/);
  // The assignment sits between the status badge and the boat name in the same row.
  assert.match(app, /\$\{delayLabel \|\| onTimeLabel \|\| scheduledLabel\}\$\{dropOffLabel\}\$\{assignment\}<span class="boat-name">/);
  assert.match(css, /\.boat-assignment\{[^}]*flex:0 0 auto/);
});

test("staff board strips the rider-facing chrome: no header bar, no ad", async () => {
  const [index, worker] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(workerPath, "utf8")
  ]);
  assert.doesNotMatch(index, /<header|ferry-mart|ad\.jpg|nyc-ferry-logo/);
  assert.doesNotMatch(worker, /ad\.jpg|nyc-ferry-logo/);
  assert.match(index, /id="clockTime"/);
  assert.match(index, /id="routeCount"/);
});

test("SFTP landing notices replace all GTFS display regions", async () => {
  const [app, css, index, server] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(indexPath, "utf8"),
    readFile(serverPath, "utf8")
  ]);
  assert.match(server, /createSftpOverridePoller/);
  assert.match(server, /sftpOverridePoller\.start\(\)/);
  assert.match(server, /url\.pathname === "\/api\/override"/);
  assert.doesNotMatch(server, /request\.method === "POST"|KIOSK_OVERRIDE_TOKEN/);
  assert.match(index, /id="manualOverride"[^>]*hidden[^>]*aria-live="assertive"/);
  assert.match(app, /\/api\/override\?landingId=/);
  assert.match(app, /setInterval\(loadManualOverride, 5_000\)/);
  assert.match(app, /manualOverrideMessage\.textContent/);
  assert.match(css, /\.screen\.override-active \.content,\.screen\.override-active \.service-alert-bar\{display:none\}/);
  assert.match(css, /\.manual-override-box\{/);
});

test("partner operators show their mark in the route badge", async () => {
  const [app, css, worker] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(workerPath, "utf8")
  ]);
  assert.match(app, /prefix: "wtr:", src: "assets\/waterway\.png"/);
  assert.match(app, /prefix: "sea:", src: "assets\/seastreak\.png"/);
  assert.match(app, /prefix: "nyu:", src: "assets\/nyu\.png"/);
  assert.match(app, /prefix: "lib:", src: "assets\/cityferry\.png"/);
  assert.match(app, /class="route-badge-logo" src="\$\{partnerLogo\.src\}"/);
  assert.match(css, /\.route-badge-logo\{[^}]*object-fit:contain/);
  assert.match(worker, /\/assets\/waterway\.png/);
  assert.match(worker, /\/assets\/seastreak\.png/);
  assert.match(worker, /\/assets\/nyu\.png/);
  assert.match(worker, /\/assets\/cityferry\.png/);
});

test("offline shell includes version 34 display assets", async () => {
  const [index, worker] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(workerPath, "utf8")
  ]);
  assert.match(index, /styles\.css\?v=34/);
  assert.match(index, /app\.js\?v=34/);
  assert.match(worker, /nyc-ferry-did-shell-v34/);
  assert.match(worker, /styles\.css\?v=34/);
  assert.match(worker, /app\.js\?v=34/);
});
