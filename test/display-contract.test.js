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

test("phone layout stacks the board into scrolling route cards", async () => {
  const [css, index] = await Promise.all([readFile(cssPath, "utf8"), readFile(indexPath, "utf8")]);
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /name="apple-mobile-web-app-capable"/);
  const phone = css.match(/@media\(max-width:820px\)\{[\s\S]*?\n\}/);
  assert.ok(phone, "expected a max-width:820px phone block");
  const rules = phone[0];
  // The kiosk's fixed-height, non-scrolling shell has to be released on a phone.
  assert.match(rules, /html,body\{height:auto;overflow:visible\}/);
  assert.match(rules, /\.screen\{[^}]*height:auto/);
  // Departures stack vertically instead of sitting in columns.
  assert.match(rules, /\.departure-slots\{display:flex;flex-direction:column/);
  assert.match(rules, /\.departures\{display:flex;flex-direction:column/);
  // Padding slots and the desktop column header are noise on a phone.
  assert.match(rules, /\.departure-slot\.unavailable\{display:none\}/);
  assert.match(rules, /\.column-head\{display:none\}/);
  // Notch and home-indicator clearance.
  assert.match(rules, /env\(safe-area-inset-top\)/);
  assert.match(rules, /env\(safe-area-inset-bottom\)/);
  // Landscape phones get two columns without inheriting the kiosk's fixed row count.
  assert.match(css, /@media\(max-width:820px\) and \(orientation:landscape\)/);
  assert.match(css, /grid-template-rows:none;grid-auto-rows:auto/);
});

test("phone layout leaves the kiosk board untouched", async () => {
  const css = await readFile(cssPath, "utf8");
  // Every phone override must live inside a media query; the base rules stay kiosk-sized.
  const base = css.slice(0, css.indexOf("@media(max-width:820px)"));
  assert.match(base, /\.screen\{width:100vw;height:100vh/);
  assert.match(base, /\.departures\{flex:1;min-height:0;display:grid/);
  // The board itself carries no phone-only safe-area padding outside the media query. The
  // landing drawer does use env() in the base rules, since it overlays every screen size.
  assert.doesNotMatch(base.match(/\.board\{[^}]*\}/)[0], /env\(/);
  assert.doesNotMatch(base.match(/\.board-heading\{[^}]*\}/)[0], /env\(/);
});

test("landing menu lets an agent switch the board's landing", async () => {
  const [app, css, index, server] = await Promise.all([
    readFile(appPath, "utf8"), readFile(cssPath, "utf8"),
    readFile(indexPath, "utf8"), readFile(serverPath, "utf8")
  ]);
  // Server serves the list, and every landing is loaded up front rather than built on demand:
  // switching must not depend on a first-request build, and the realtime feeds have to see all
  // of them. See test/landing-data.test.js.
  assert.match(server, /url\.pathname === "\/api\/landings"/);
  assert.match(server, /loadAllLandingData/);
  assert.match(server, /!displayDataJson\.has\(landingNumber\)/);
  assert.match(server, /return json\(response, 400, \{ error: "Unknown landing\." \}\)/);
  // No landingId still resolves to the configured landing, so the kiosk contract is unchanged.
  assert.match(server, /requested === null \? Number\(displayConfig\.landingNumber\) : Number\(requested\)/);
  // The client names its landing so realtime comes back scoped to it.
  assert.match(app, /\/api\/realtime\$\{query\}/);
  // Menu markup and the accessible toggle.
  assert.match(index, /id="menuButton"[^>]*aria-expanded="false"[^>]*aria-controls="landingMenu"/);
  assert.match(index, /id="landingMenu"[^>]*hidden/);
  assert.match(index, /id="landingList"/);
  // Selection is persisted and restored, including for an offline start.
  assert.match(app, /localStorage\.setItem\(landingKey/);
  assert.match(app, /function selectedLanding\(\)/);
  assert.match(app, /landingDataKey\(/);
  assert.match(app, /\/api\/display-data\$\{query\}/);
  // Close paths: the Done button, the scrim, and Escape.
  assert.match(app, /landingMenuClose\.addEventListener\("click"/);
  assert.match(app, /landingMenuScrim\.addEventListener\("click"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /setAttribute\("aria-expanded", String\(open\)\)/);
  // Touch targets stay finger-sized.
  assert.match(css, /\.landing-option\{[^}]*min-height:48px/);
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

test("two buttons at the top of the menu swap the departure view", async () => {
  const [app, css, index] = await Promise.all([
    readFile(appPath, "utf8"), readFile(cssPath, "utf8"), readFile(indexPath, "utf8")
  ]);
  // Both buttons sit above the landing list, and each reports its own pressed state so the
  // active view is announced rather than only shown by colour.
  const panel = index.slice(index.indexOf('id="landingMenuPanel"'), index.indexOf('id="landingList"'));
  assert.match(panel, /class="sort-toggle" role="group" aria-label="Sort departures"/);
  assert.match(panel, /id="sortByRoute" data-sort="route" aria-pressed="false"/);
  assert.match(panel, /id="sortByTime" data-sort="time" aria-pressed="true"/);
  assert.match(css, /\.sort-option\[aria-pressed="true"\]\{[^}]*background:var\(--navy\)/);

  // Departure time is the default; only an explicit choice of "route" opts out of it.
  assert.match(app, /localStorage\.getItem\(sortKey\) === "route" \? "route" : "time"/);
  assert.match(app, /localStorage\.setItem\(sortKey, next\)/);
  assert.match(app, /return sortedBy\(\) === "route" \? renderRouteBoard\(\) : renderTimeline\(\)/);
});

test("the timeline lists every upcoming sailing in departure order, route on each row", async () => {
  const [app, css, index] = await Promise.all([
    readFile(appPath, "utf8"), readFile(cssPath, "utf8"), readFile(indexPath, "utf8")
  ]);
  // Every sailing across every route is flattened into one list ordered by time, so route
  // grouping cannot survive into the ordering.
  assert.match(app, /routeDirectionGroups\(now, Infinity\)/);
  assert.match(app, /\.flatMap\(\(group\) => group\.departures\.map\(\(departure\) => \(\{ departure, group \}\)\)\)/);
  assert.match(app, /left\.departure\.delta - right\.departure\.delta \|\| byRoute\(left\.group, right\.group\)/);

  // All of them, bounded only by the board's existing lookahead — no fixed row cap.
  assert.match(app, /\.filter\(\(\{ departure \}\) => departure\.delta <= windowSeconds\)/);
  assert.doesNotMatch(app, /TIMELINE_ROWS/);
  assert.doesNotMatch(app, /\.slice\(0, TIMELINE_ROWS\)/);

  // Three compact lines, with route identity travelling on the row. The destination owns a line
  // of its own — it is the longest field and the one that reads worst truncated.
  assert.match(app, /<div class="tl-head">/);
  assert.match(app, /class="route-badge\$\{visual\.partnerLogo \? " route-badge-image" : ""\}"/);
  assert.match(app, /<strong class="tl-dest">\$\{escapeHtml\(group\.destination\)\}<\/strong>/);
  assert.match(app, /<div class="tl-meta">/);

  // Countdown and status hug the right edge so both scan as columns down the list.
  assert.match(css, /\.tl-relative\{[^}]*margin-left:auto/);
  assert.match(css, /\.tl-status\{[^}]*margin-left:auto/);
  // Long destinations must ellipsis rather than spill out of the card.
  assert.match(css, /\.tl-dest\{[^}]*text-overflow:ellipsis/);

  // The vessel name, which only NYC Ferry publishes: rendered when a live vehicle supplies one and
  // omitted outright otherwise, so partner rows carry no empty element or stray separator.
  assert.match(app, /departure\.boatName \? `<span class="tl-boat">\$\{escapeHtml\(departure\.boatName\)\}<\/span>` : ""/);
  assert.match(css, /\.tl-boat::before\{content:"·"/);

  // The phone stylesheet sets .departure{display:block}, so the row must set its own display at
  // higher specificity or it silently stacks into a full-screen-tall card.
  assert.match(css, /\.departure\.timeline-row\{display:flex/);
  // .departure also sets align-items:center for the kiosk grid, which in a column flex box centres
  // the lines horizontally and lets them overflow both edges. The row must reset it.
  assert.match(css, /\.departure\.timeline-row\{[^}]*align-items:stretch/);
  assert.match(css, /\.departures\[data-view="timeline"\]\{display:flex[^}]*overflow-y:auto/);
  // Fixed row height, not squished to fit: the list scrolls instead.
  assert.match(css, /\.departure\.timeline-row\{[^}]*flex:0 0 auto/);
  assert.match(app, /removeProperty\("--routes-shown"\)/);
  // Phone overrides must exist inside the max-width block, after .departure{display:block}.
  const phone = css.slice(css.indexOf("@media(max-width:820px)"));
  assert.match(phone, /\.departures\[data-view="timeline"\]\{gap:8px/);
  assert.match(phone, /\.timeline-row \.route-badge\{width:46px/);

  // The column head describes the route board only, and is hidden on the timeline.
  assert.match(index, /id="columnHead" hidden/);
  assert.match(app, /elements\.columnHead\.hidden = true/);
  assert.match(app, /elements\.columnHead\.hidden = false/);

  // Both views share one status source, so they cannot disagree about a late boat.
  assert.match(app, /function departureStatus\(item\)/);
  assert.match(app, /function routeVisual\(routeId, variant\)/);
});

test("offline shell includes version 40 display assets", async () => {
  const [index, worker] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(workerPath, "utf8")
  ]);
  assert.match(index, /styles\.css\?v=40/);
  assert.match(index, /app\.js\?v=40/);
  assert.match(worker, /nyc-ferry-did-shell-v40/);
  assert.match(worker, /styles\.css\?v=40/);
  assert.match(worker, /app\.js\?v=40/);
});
