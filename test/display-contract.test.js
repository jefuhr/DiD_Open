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

// The badge on a boat's last working trip reads FINAL. Nothing about it is published: it is inferred
// from the shape of the boat's day against the crew sheet, so a shorter gap that could be a break
// rather than a finish keeps the question mark instead of claiming certainty.
test("a boat's last trip is badged FINAL", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(app, />FINAL\$\{item\.endsShift === "unsure" \? "\?" : ""\}<\/span>/);
  assert.doesNotMatch(app, /DROP OFF/, "the badge no longer says DROP OFF ONLY");
  // The reason survives for anyone reading by screen reader, where the word alone is thinner.
  assert.match(app, /aria-label="\$\{item\.endsShift === "unsure" \? "Probably this boat's final trip: drop off only, unconfirmed" : "This boat's final trip: drop off only"\}"/);
  // Distinct from LAST, which marks the last sailing a passenger can take on that route direction.
  assert.match(app, /class="departure-last-badge"[^>]*>LAST<\/strong>/);
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

// Sorted by route, the board used to divide its height by however many route directions the landing
// had. Pier 11 has twenty, so every row got a twentieth of the screen and its own overflow:hidden
// cut the destination and the status badges in half; a landing with two got half a screen each.
// Rows are a fixed height now and the list scrolls, which is what the timeline view already did.
test("the route board keeps its rows one size and scrolls past the bottom", async () => {
  const [app, css] = await Promise.all([readFile(appPath, "utf8"), readFile(cssPath, "utf8")]);
  const rule = css.match(/\.departures\{[^}]*\}/)[0];

  assert.match(rule, /grid-auto-rows:var\(--route-row\)/, "every row is the same height");
  assert.match(rule, /--route-row:clamp\(/, "and that height is bounded, not a fraction of the screen");
  assert.doesNotMatch(rule, /minmax\(0,1fr\)/, "a fractional row is what squashed twenty of them");
  // Without this the rows stretch to fill a landing that only has two.
  assert.match(rule, /align-content:start/);
  assert.match(rule, /overflow-y:auto/);
  // Firefox and Chrome take scrollbar-width; older WebKit needs the pseudo-element.
  assert.match(css, /\.departures\{[^}]*scrollbar-width:thin/);
  assert.match(css, /\.departures::-webkit-scrollbar\{width:/);

  // The row count no longer drives the layout, so nothing should still be setting it.
  assert.doesNotMatch(css, /--routes-shown/);
  assert.doesNotMatch(app, /--routes-shown/);

  // The phone stacks cards and scrolls the page itself; a scroller inside it would trap the gesture.
  const phone = css.slice(css.indexOf("@media(max-width:820px)"));
  assert.match(phone, /\.departures\{display:flex[^}]*overflow:visible/);
});

// A home-port row's trip id is minted by the build, not taken from the feed, so no live vehicle can
// ever match it and its own boatName is always empty. The vessel worth showing is the one currently
// working the trip the boat is about to pick up. The route board fell back to that; the timeline did
// not, so every Pier C row lost its boat the moment the board was sorted by departure time.
test("both views name the predicted boat on a home-port row", async () => {
  const app = await readFile(appPath, "utf8");

  // One helper renders the guess, so both views mark it the same way: italic, muted, question mark.
  assert.match(app, /function predictedName\(item\)/);
  assert.match(app, /predictedBoatName[\s\S]{0,200}boat-name-predicted[^`]*\}\?<\/em>/);
  assert.match(app, /predictTripId\s*\?\s*\n?\s*vehicles\.get\(String\(departure\.predictTripId\)\)/);

  // The route board's slot and the timeline's row both reach for it, and neither may stop at
  // boatName alone.
  assert.match(app, /item\.boatName \? escapeHtml\(item\.boatName\) : predictedName\(item\)/);
  assert.match(app, /departure\.predictedBoatName \? `<span class="tl-boat">\$\{predictedName\(departure\)\}<\/span>`/);

  const timeline = app.slice(app.indexOf("function renderTimeline"));
  const boatLine = timeline.slice(timeline.indexOf("const boat = crewBoats"), timeline.indexOf("Three lines"));
  assert.match(boatLine, /predictedName\(departure\)/, "the timeline must not stop at boatName");
});

// Every scheduled sailing, not just the home-port rows. The feed names a vessel only for trips it
// has reached, so anything later today has none of its own — but the workbook puts a boat on it, and
// the server says which vessel is on that boat right now.
test("a scheduled sailing predicts its vessel from the boat working it", async () => {
  const app = await readFile(appPath, "utf8");

  // Freshest report wins: a boat shows up on two trips as it hands over between them.
  assert.match(app, /const vessels = new Map\(\)/);
  assert.match(app, /if \(!item\.boat \|\| !item\.boatName\) continue/);
  assert.match(app, /updatedAtEpochSeconds \|\| 0\) >= \(seen\.updatedAtEpochSeconds \|\| 0\)/);

  // Looked up by the boat the workbook assigns, which partner rows and crew shuttles do not have.
  assert.match(app, /Number\.isInteger\(departure\.boatAssignment\)\s*\n?\s*\? vessels\.get\(`\$\{departure\.routeId\}\$\{departure\.boatAssignment\}`\)/);

  // A live vessel always wins; the guess only fills the gap, never competes with a real match.
  assert.match(app, /predictedBoatName: vehicles\.get\(String\(departure\.tripId\)\)\?\.boatName\s*\n?\s*\? null/);
});

test("staff board shows every route direction with config-driven departure columns", async () => {
  const [app, css] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);
  assert.match(app, /displayCount\("departuresShown"\)/);
  assert.match(app, /dataset\.departuresShown/);
  assert.doesNotMatch(app, /slideTimer|startSlideshow|slideIndex|PAGE_SIZE|TIMES_PER_DIRECTION/);
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
  // The far end, plus the stops on the way for a boat that calls at several.
  assert.match(app, /<strong class="tl-dest">\$\{escapeHtml\(group\.destination\)\}\$\{group\.via\?\.length/);
  assert.match(app, /<div class="tl-meta">/);

  // Countdown and status hug the right edge so both scan as columns down the list.
  assert.match(css, /\.tl-relative\{[^}]*margin-left:auto/);
  assert.match(css, /\.tl-status\{[^}]*margin-left:auto/);
  // Long destinations must ellipsis rather than spill out of the card.
  assert.match(css, /\.tl-dest\{[^}]*text-overflow:ellipsis/);

  // The vessel name, which only NYC Ferry publishes: rendered when a live vehicle supplies one and
  // omitted outright otherwise, so partner rows carry no empty element or stray separator.
  // A real vessel name when one is matched, otherwise the predicted one, otherwise no line at all —
  // never a placeholder. Partner operators publish no vessel and fall through to nothing.
  assert.match(app, /departure\.boatName \? `<span class="tl-boat">\$\{escapeHtml\(departure\.boatName\)\}<\/span>`/);
  assert.match(app, /: ""/);
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

// The crews, the workbook and the radio all speak 24-hour time, so the board does too. Every clock
// on screen is covered: the departure times, the range a crew shuttle prints, the header clock and
// the service-notice timestamp.
test("every time on the board is 24-hour", async () => {
  const app = await readFile(appPath, "utf8");

  // Each formatter that prints an hour has to ask for h23. Counting them together is what stops a
  // fifth one being added later in 12-hour and going unnoticed.
  const hours = app.match(/hour: "2-digit"/g) || [];
  const cycles = app.match(/hourCycle: "h23"/g) || [];
  assert.ok(hours.length >= 4, "the departure times, the clock, the notice stamp and the day boundary");
  assert.equal(hours.length, cycles.length, "every hour-printing formatter asks for h23");
  assert.doesNotMatch(app, /hour: "numeric"/, "a numeric hour formats as 12-hour under en-US");
  // hour12:false is the tempting spelling and the wrong one — it yields a 24:00 hour in some
  // locales, where h23 always rolls to 00:00.
  assert.doesNotMatch(app, /hour12: false/);

  // A 24-hour range needs no meridiem trimming, and the slicing that did it would silently eat the
  // last two digits of the minutes if it were left behind.
  assert.doesNotMatch(app, /slice\(-2\)/);
  assert.match(app, /return `\$\{start\}<span class="time-range-dash">–<\/span>\$\{escapeHtml\(end\)\}`/);
});

test("offline shell includes version 50 display assets", async () => {
  const [index, worker] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(workerPath, "utf8")
  ]);
  assert.match(index, /styles\.css\?v=50/);
  assert.match(index, /app\.js\?v=50/);
  assert.match(worker, /nyc-ferry-did-shell-v50/);
  assert.match(worker, /styles\.css\?v=50/);
  assert.match(worker, /app\.js\?v=50/);
});

// The Trust's boats are badged with its wordmark, so the logo has to be precached with the rest of
// the shell — a partner badge that 404s offline leaves an empty box where the operator should be.
test("the Governors Island badge ships with the offline shell", async () => {
  const [app, worker] = await Promise.all([readFile(appPath, "utf8"), readFile(workerPath, "utf8")]);
  assert.match(app, /\{ prefix: "gi:", src: "assets\/gi\.png"/);
  assert.match(worker, /'\/assets\/gi\.png'/);
});

// The nearest-landing button. Two things here are easy to break and invisible when broken: the
// button must never read position without a tap, and it has to sit on the heading's first line —
// .board-state wraps to a line of its own on a phone, which is what puts this in the top right.
test("the nearest-landing button locates on tap and then shortcuts", async () => {
  const [index, app, css] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(appPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);

  assert.match(index, /id="nearestButton"/);
  assert.match(index, /id="nearestLabel"/);
  // Between the landing name and the chips, so the phone wrap leaves it in the corner.
  assert.ok(
    index.indexOf('id="nearestButton"') > index.indexOf('id="landingName"'),
    "the button must follow the landing name"
  );
  assert.ok(
    index.indexOf('id="nearestButton"') < index.indexOf('class="board-state"'),
    "the button must precede the chips that wrap onto the second line"
  );

  // Position is read on an explicit tap and nowhere else: no watchPosition, and no getCurrentPosition
  // on load, so anyone who never asks is never prompted.
  assert.doesNotMatch(app, /watchPosition/);
  assert.equal(app.match(/getCurrentPosition/g)?.length, 1, "position is requested in exactly one place");
  assert.match(app, /function locateNearest\(\)/);
  assert.match(app, /elements\.nearestButton\.addEventListener\("click"/);

  // Ranking needs a position per landing, which only reaches the client through /api/landings.
  assert.match(app, /function nearestLanding\(latitude, longitude\)/);
  assert.match(app, /function distanceMetres\(/);
  assert.match(app, /Number\.isFinite\(landing\.latitude\)/);

  // Tapping always does something: jump to the landing, or take a fresh fix when already there.
  assert.match(app, /saved\.id !== data\?\.meta\?\.landingNumber\) return void selectLanding\(saved\.id\)/);
  assert.match(app, /setNearest\("here"/);

  // A denied permission is a different problem from a fix that did not arrive, and says so.
  assert.match(app, /PERMISSION_DENIED/);

  assert.match(css, /\.nearest-button\{[^}]*flex:0 0 auto/);
  // The label is a landing name and some are long, so it truncates rather than widening the header.
  assert.match(css, /\.nearest-label\{[^}]*text-overflow:ellipsis/);
  const phoneStyles = css.slice(css.indexOf("@media(max-width:820px)"));
  assert.match(phoneStyles, /\.nearest-button\{height:40px/);
});

// A merge once shipped conflict markers in index.html and sw.js. Nothing caught it: the contract
// tests only look for patterns they expect, so text nobody asserts on rode all the way to a live
// board and rendered as "<<<<<<< HEAD ======= >>>>>>> staff" above the departures. This is the
// cheap guard that would have.
test("no file carries an unresolved merge conflict", async () => {
  const root = new URL("../", import.meta.url);
  const files = [
    "public/index.html", "public/app.js", "public/styles.css", "public/sw.js",
    "scripts/build-data.js", "scripts/out-of-service.js", "server.js",
    "config/display.json", "config/landings.json", "config/crew-shuttles.json"
  ];
  for (const name of files) {
    const text = await readFile(new URL(name, root), "utf8");
    for (const marker of ["<<<<<<<", "=======", ">>>>>>>"]) {
      assert.doesNotMatch(text, new RegExp(`^${marker}`, "m"), `${name} still has a ${marker} conflict marker`);
    }
  }
});
