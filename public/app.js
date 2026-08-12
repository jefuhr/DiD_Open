const elements = {
  screen: document.querySelector("#screen"),
  landing: document.querySelector("#landingName"),
  time: document.querySelector("#clockTime"),
  date: document.querySelector("#clockDate"),
  departures: document.querySelector("#departures"),
  status: document.querySelector("#dataStatus"),
  routeCount: document.querySelector("#routeCount"),
  columnHead: document.querySelector("#columnHead"),
  serviceAlerts: document.querySelector("#serviceAlerts"),
  serviceAlertSummary: document.querySelector("#serviceAlertSummary"),
  serviceAlertFreshness: document.querySelector("#serviceAlertFreshness"),
  serviceAlertCount: document.querySelector("#serviceAlertCount"),
  manualOverride: document.querySelector("#manualOverride"),
  manualOverrideBox: document.querySelector("#manualOverrideBox"),
  manualOverrideMessage: document.querySelector("#manualOverrideMessage"),
  manualOverrideUpdated: document.querySelector("#manualOverrideUpdated"),
  menuButton: document.querySelector("#menuButton"),
  landingMenu: document.querySelector("#landingMenu"),
  landingMenuPanel: document.querySelector("#landingMenuPanel"),
  landingMenuScrim: document.querySelector("#landingMenuScrim"),
  landingMenuClose: document.querySelector("#landingMenuClose"),
  landingList: document.querySelector("#landingList"),
  sortOptions: [...document.querySelectorAll("[data-sort]")]
};

const cacheKey = "nyc-ferry-did-data-v6";
// Which landing this device is showing. Persisted so an agent's choice survives a reload and
// so an offline start knows which cached board to restore.
const landingKey = "nyc-ferry-did-selected-landing";
const landingsKey = "nyc-ferry-did-landings";
// Whether the board orders route cards by which one leaves next (the default) or by route.
// Persisted like the landing choice, and deliberately per-device: it is a reading preference,
// not board config.
const sortKey = "nyc-ferry-did-sort";
let data;
let realtime = { updates: [], vehicles: [], available: false, stale: true };
let serviceAlerts = null;
let manualOverride = { active: false, message: "", updatedAt: null };

function sortedBy() {
  return localStorage.getItem(sortKey) === "route" ? "route" : "time";
}

function renderSortToggle() {
  const active = sortedBy();
  for (const button of elements.sortOptions) {
    button.setAttribute("aria-pressed", String(button.dataset.sort === active));
  }
}

function selectSort(next) {
  if (next !== "route" && next !== "time") return;
  localStorage.setItem(sortKey, next);
  renderSortToggle();
  // Re-order in place: the menu stays open so the choice can be changed again, and nothing
  // needs refetching because sorting only touches the order cards are laid out in.
  render();
}

function displayCount(key) {
  const value = Number(data?.meta?.[key]);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 4;
}

function applyDisplayCounts() {
  document.documentElement.dataset.departuresShown = String(displayCount("departuresShown"));
}

function zonedParts(date = new Date(), timeZone = "America/New_York") {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    seconds: (Number(values.hour) % 24) * 3600 + Number(values.minute) * 60 + Number(values.second)
  };
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function activeServices(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const active = new Set();
  for (const item of data.calendars || []) {
    if (dateKey >= item.startDate && dateKey <= item.endDate && item.weekdays[weekday]) active.add(item.serviceId);
  }
  for (const item of data.exceptions || []) {
    if (item.date !== dateKey) continue;
    if (item.added) active.add(item.serviceId); else active.delete(item.serviceId);
  }
  return active;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function adjustedTime(raw, delaySeconds = 0) {
  const [hours, minutes, seconds] = raw.split(":").map(Number);
  const total = hours * 3600 + minutes * 60 + seconds + delaySeconds;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, 0, 1, Math.floor(total / 3600) % 24, Math.floor((total % 3600) / 60))));
}

// A crew shuttle is ready at the listed time but waits for the boats it is collecting from to sail,
// so it prints the window rather than a minute it will not leave on. The opening meridiem is
// dropped when both ends share it: "2:35 – 3:05 PM" reads better than "2:35 PM – 3:05 PM".
function departureLabel(item) {
  // A boat leaving the home port has no published departure time — the operator says it is not
  // constant — so the row shows when it is due at its first landing and stars it.
  const star = item.approximate ? `<abbr class="approx" title="Approximate: the boat's home-port departure is not fixed">*</abbr>` : "";
  const start = adjustedTime(item.departureTime, item.delay) + star;
  if (!item.departureTimeEnd) return start;
  const end = adjustedTime(item.departureTimeEnd, 0);
  const startMeridiem = start.slice(-2), endMeridiem = end.slice(-2);
  const opening = startMeridiem === endMeridiem ? start.slice(0, -3) : start;
  return `${opening}<span class="time-range-dash">–</span>${escapeHtml(end)}`;
}

function relativeTime(deltaSeconds) {
  if (deltaSeconds <= 90) return "Boarding";
  if (deltaSeconds < 3600) return `${Math.ceil(deltaSeconds / 60)} min`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)} hr ${Math.ceil((deltaSeconds % 3600) / 60)} min`;
  return "Tomorrow";
}

function directionLabel(directionId) {
  if (String(directionId) === "1") return "Northbound";
  if (String(directionId) === "0") return "Southbound";
  return "Direction unavailable";
}

function routeDirectionGroups(now = new Date(), limitPerGroup = displayCount("departuresShown")) {
  const current = zonedParts(now, data.meta.timezone);
  const departureWindowSeconds = (Number(data.meta.departureWindowMinutes) || 180) * 60;
  const updates = new Map((realtime.updates || []).map((item) => [`${item.tripId}|${item.stopId}`, item]));
  const vehicles = new Map((realtime.vehicles || []).map((item) => [String(item.tripId), item]));
  const groups = new Map();
  const lastDepartures = new Map();
  const lastGovernorsIslandDepartures = new Map();

  for (let offset = -1; offset <= 0; offset += 1) {
    const serviceDate = addDays(current.dateKey, offset);
    const active = activeServices(serviceDate);
    for (const departure of data.departures || []) {
      if (!active.has(departure.serviceId)) continue;
      const calendarDate = addDays(serviceDate, Math.floor(departure.seconds / 86400));
      if (calendarDate !== current.dateKey) continue;
      const update = updates.get(`${departure.tripId}|${departure.stopId}`);
      if (update?.canceled) continue;
      const liveDelay = Number(update?.delaySeconds);
      const hasLiveTiming = !realtime.stale && update?.delaySeconds != null && Number.isFinite(liveDelay);
      // NYC Ferry boats may arrive ahead of schedule, but never depart early.
      // Keep the published departure as the rider-facing floor even for old cached updates.
      const delay = hasLiveTiming ? Math.max(0, liveDelay) : 0;
      const delta = offset * 86400 + departure.seconds + delay - current.seconds;
      const slotKey = `${departure.routeId}|${departure.variant || ""}|${departure.directionId}`;
      const scheduledMoment = offset * 86400 + departure.seconds;
      // LAST means the last departure a passenger can take. A home-port run or a crew shuttle
      // leaves after it and carries nobody, so neither is allowed to claim the badge.
      const carriesPassengers = !departure.outOfService && !departure.crewShuttle;
      const previousLast = carriesPassengers ? lastDepartures.get(slotKey) : null;
      if (carriesPassengers && (!previousLast || scheduledMoment > previousLast.scheduledMoment)) {
        lastDepartures.set(slotKey, { tripId: String(departure.tripId), scheduledMoment });
      }
      if (departure.routeId === "SB" && departure.servesGovernorsIsland) {
        const previousIslandLast = lastGovernorsIslandDepartures.get(slotKey);
        if (!previousIslandLast || scheduledMoment > previousIslandLast.scheduledMoment) {
          lastGovernorsIslandDepartures.set(slotKey, { tripId: String(departure.tripId), scheduledMoment });
        }
      }
      if (delta < -60) continue;
      const via = (departure.via || []).join(" > ");
      const key = `${departure.routeId}|${departure.variant || ""}|${departure.directionId}|${departure.destination}|${via}`;
      const group = groups.get(key) || {
        key, routeId: departure.routeId, directionId: departure.directionId,
        destination: departure.destination, via: departure.via || [], variant: departure.variant || null,
        outOfService: Boolean(departure.outOfService), crewShuttle: Boolean(departure.crewShuttle),
        departures: []
      };
      group.departures.push({
        ...departure,
        delay,
        delta,
        hasLiveTiming,
        boatName: vehicles.get(String(departure.tripId))?.boatName || null,
        // A home-port row names no trip of its own, so the vessel shown is whichever one is
        // currently working the trip this boat is about to pick up. A guess, and labelled as one.
        predictedBoatName: departure.predictTripId
          ? vehicles.get(String(departure.predictTripId))?.boatName || null
          : null
      });
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      departures: group.departures
        .sort((left, right) => left.delta - right.delta)
        .map((departure) => ({
          ...departure,
          isLastOfDay: lastDepartures.get(`${departure.routeId}|${departure.variant || ""}|${departure.directionId}`)?.tripId === String(departure.tripId),
          isLastGovernorsIsland: departure.servesGovernorsIsland &&
            lastGovernorsIslandDepartures.get(`${departure.routeId}|${departure.variant || ""}|${departure.directionId}`)?.tripId === String(departure.tripId)
        }))
    }))
    .filter((group) => group.departures[0]?.delta <= departureWindowSeconds)
    .map((group) => ({
      ...group,
      departures: group.departures.slice(0, limitPerGroup)
    }))
    .sort(byRoute);
}

// Route-card order, and the tiebreak the timeline falls back on when two boats leave in the
// same minute.
function byRoute(left, right) {
  const routeOrder = left.routeId.localeCompare(right.routeId);
  if (routeOrder) return routeOrder;
  const variantOrder = { A: 0, B: 1, LOCAL: 2 };
  const variantDifference = (variantOrder[left.variant] ?? 3) - (variantOrder[right.variant] ?? 3);
  if (variantDifference) return variantDifference;
  const directionOrder = String(left.directionId).localeCompare(String(right.directionId));
  return directionOrder || left.destination.localeCompare(right.destination);
}


function routeShortName(routeId) {
  return data?.routes?.[routeId]?.shortName || routeId;
}

// Timeline view: one row per sailing in the order the boats actually leave, so departures read
// top-to-bottom instead of being spread across route cards. Route identity moves onto the row
// itself, which is what makes dropping the route grouping legible.
//
// Every remaining sailing is listed, bounded only by departureWindowMinutes — the same lookahead
// the route view already uses to decide a board is worth showing. The list scrolls; rows stay a
// fixed compact height rather than squishing, because a row too short to read is worse than one
// more flick of the thumb.
function timelineDepartures(now = new Date()) {
  const windowSeconds = (Number(data.meta.departureWindowMinutes) || 180) * 60;
  return routeDirectionGroups(now, Infinity)
    .flatMap((group) => group.departures.map((departure) => ({ departure, group })))
    .filter(({ departure }) => departure.delta <= windowSeconds)
    // Ties fall back to route order so two boats leaving the same minute cannot swap places
    // between the 15s re-renders.
    .sort((left, right) => left.departure.delta - right.departure.delta || byRoute(left.group, right.group));
}

// NY Waterway boats call at more than one terminal, so the stops before the far end are named.
// Shortened because the destination line is already the widest thing on a card: "Hoboken (14th
// Street)" becomes "Hoboken 14th", which is what the terminal is called anyway.
const VIA_SHORTENINGS = [
  [/^Hoboken \(14th Street\)$/, "Hoboken 14th"],
  [/^Hoboken \/ NJ Transit Terminal$/, "Hoboken NJT"],
  [/^Brookfield Place\/Battery Park City$/, "Brookfield Pl"],
  [/^Midtown West\/W 39th St-Pier 79$/, "Midtown"],
  [/^Wall St\/Pier 11$/, "Pier 11"],
  [/^Gov\. Island\/Yankee Pier$/, "Governors Island"],
  [/^Red Hook\/Atlantic Basin$/, "Red Hook"]
];

function shortStop(name) {
  for (const [pattern, short] of VIA_SHORTENINGS) if (pattern.test(name)) return short;
  return name;
}

// Deliberately styled apart from a confirmed vessel name: crews swap boats at short notice, so this
// says which boat is on the working right now, not which one will sail.
function predictedName(item) {
  return item.predictedBoatName
    ? `<em class="boat-name-predicted" title="Currently on this working; boats change at short notice">${escapeHtml(item.predictedBoatName)}?</em>`
    : "";
}

function viaLabel(group) {
  if (!group.via?.length) return "";
  return `<small class="via">via ${escapeHtml(group.via.map(shortStop).join(", "))}</small>`;
}

// The line under the destination. "Northbound" says nothing useful about a boat going home empty,
// so these two say what the move actually is.
function groupContext(group, isOtherOperator) {
  if (group.crewShuttle) return "Crew shuttle";
  if (group.outOfService) return "Out of service";
  return isOtherOperator ? "" : directionLabel(group.directionId);
}

// Status badges for one sailing. Shared so the timeline rows and the route cards can never
// disagree about whether a boat is late, on time, or the last of the day.
function departureStatus(item) {
  const delaySeconds = Number(item.delay);
  const hasFreshTiming = !realtime.stale && item.hasLiveTiming && Number.isFinite(delaySeconds);
  const delayLabel = hasFreshTiming && delaySeconds >= 60
    ? `<span class="vessel-delay-badge departure-delay-badge" dir="ltr" aria-label="Status: +${Math.max(1, Math.round(delaySeconds / 60))} min">+${Math.max(1, Math.round(delaySeconds / 60))} min</span>`
    : "";
  const onTimeLabel = hasFreshTiming && delaySeconds < 60
    ? `<span class="on-time-badge" aria-label="Status: On time">ON TIME</span>`
    : "";
  const isLast = item.isLastOfDay || item.isLastGovernorsIsland;
  const lastAria = item.isLastGovernorsIsland && !item.isLastOfDay
    ? "Last South Brooklyn departure serving Governors Island"
    : "Last departure of the day";
  const lastLabel = isLast ? `<strong class="departure-last-badge" aria-label="${lastAria}">LAST</strong>` : "";
  // A boat with no passengers aboard has no schedule status worth showing — it is not late or on
  // time, it is simply not in service — so NO PICKUP takes that slot instead.
  const noPickup = item.outOfService || item.crewShuttle;
  const scheduledLabel = !noPickup && !isLast && !delayLabel && !onTimeLabel
    ? `<span class="scheduled-badge" aria-label="Status: Scheduled">SCHEDULED</span>`
    : "";
  const noPickupLabel = noPickup
    ? `<span class="no-pickup-badge" aria-label="Not in service: no passengers">NO PICKUP</span>`
    : "";
  // The trip a boat works before it stops. It still carries passengers to where it is going, but it
  // will not turn round afterwards, so an agent needs to stop sending people to it for a return leg.
  //
  // A boat finishing for the day, or tying up for hours, is unambiguous. A shorter gap could as
  // easily be a crew break with the boat sitting where it is, so that one is marked with a question
  // mark: none of this is published, all of it is inferred from the shape of the boat's day, and
  // saying so is better than a confident label that turns out to be wrong.
  const dropOffLabel = !noPickup && item.endsShift
    ? `<span class="drop-off-badge${item.endsShift === "unsure" ? " drop-off-unsure" : ""}" aria-label="${item.endsShift === "unsure" ? "Probably the last trip for this boat: drop off only, unconfirmed" : "Last trip for this boat: drop off only"}">DROP OFF${item.endsShift === "unsure" ? "?" : " ONLY"}</span>`
    : "";
  // Crew boat assignment ("ER5" = East River boat 5). Boat numbers restart per route, so the
  // route code is part of the label. NY Waterway and the shuttles have no assignment.
  const assignment = Number.isInteger(item.boatAssignment)
    ? `<span class="boat-assignment">${escapeHtml(`${routeShortName(item.routeId)}${item.boatAssignment}`)}</span>`
    : "";
  // A crew shuttle is one departure carrying the crews off several boats, so it names them where a
  // revenue departure names its vessel.
  const crewBoats = item.crewShuttle && item.crewBoats?.length
    ? escapeHtml(item.crewBoats.join(" "))
    : "";
  return { delayLabel, onTimeLabel, scheduledLabel, lastLabel, assignment, noPickupLabel, dropOffLabel, crewBoats };
}
// The route's own colour, badge and operator labelling, shared by both views.
function routeVisual(routeId, variant) {
  const route = data.routes[routeId] || {};
  const partnerLogo = partnerBadgeLogo(routeId, route.shortName);
  const variantLabel = variant === "LOCAL" ? "Local" : variant;
  const badgeContent = partnerLogo
    ? `<img class="route-badge-logo" src="${partnerLogo.src}" alt="${escapeHtml(partnerLogo.alt)}">`
    : `<b>${escapeHtml(route.shortName || routeId)}</b>`;
  return {
    route,
    partnerLogo,
    variantLabel,
    badgeContent,
    routeClass: String(routeId || "default").replace(/[^A-Za-z0-9_-]/g, ""),
    isOtherOperator: Boolean(route.operator) && route.operator !== (data.meta.agencyName || "NYC Ferry"),
    style: /^#[0-9A-Fa-f]{6}$/.test(route.color || "")
      ? ` style="--route-color:${route.color};--route-text:${/^#[0-9A-Fa-f]{6}$/.test(route.textColor || "") ? route.textColor : "#FFFFFF"}"`
      : ""
  };
}

function departureCell(item) {
  const { delayLabel, onTimeLabel, scheduledLabel, lastLabel, assignment, noPickupLabel, dropOffLabel, crewBoats } = departureStatus(item);
  return `<div class="departure-slot">
    <div class="slot-time-row"><time>${departureLabel(item)}</time><span class="slot-relative">${escapeHtml(relativeTime(item.delta))}</span></div>
    <span class="departure-last-slot">${lastLabel}${noPickupLabel}${delayLabel || onTimeLabel || scheduledLabel}${dropOffLabel}${assignment}<span class="boat-name">${crewBoats || (item.boatName ? escapeHtml(item.boatName) : predictedName(item))}</span></span>
  </div>`;
}

// Partner operators merged in by scripts/build-data.js namespace their route ids with a prefix.
// Their GTFS short names are useless on a passenger board — NY Waterway publishes internal
// all-digit route ids for most routes, Seastreak reuses "Seastreak" for every route, and NYU
// publishes no short name at all (leaving the bare Passio route number) — so those badges show
// the operator's mark instead. A partner route with a real short name (W44, Greenwich) keeps it,
// and NYC Ferry badges are never touched.
const PARTNER_BADGES = [
  { prefix: "wtr:", src: "assets/waterway.png", alt: "NY Waterway", useLogo: (shortName) => /^\d+$/.test(shortName) },
  { prefix: "sea:", src: "assets/seastreak.png", alt: "Seastreak", useLogo: () => true },
  { prefix: "nyu:", src: "assets/nyu.png", alt: "NYU Langone Ferry", useLogo: () => true },
  { prefix: "lib:", src: "assets/cityferry.png", alt: "Liberty Landing Ferry", useLogo: () => true }
];

function partnerBadgeLogo(routeId, shortName) {
  const badge = PARTNER_BADGES.find((item) => String(routeId || "").startsWith(item.prefix));
  return badge && badge.useLogo(shortName || "") ? badge : null;
}

function render() {
  if (!data) return;
  applyDisplayCounts();
  return sortedBy() === "route" ? renderRouteBoard() : renderTimeline();
}

function renderTimeline() {
  const rows = timelineDepartures();
  elements.departures.dataset.view = "timeline";
  // The column head describes the route board's three columns; a timeline row is not columnar,
  // and the phone stylesheet hides it anyway.
  elements.columnHead.hidden = true;
  elements.departures.style.removeProperty("--routes-shown");
  elements.routeCount.textContent = `${rows.length} departure${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    elements.departures.innerHTML = `<div class="empty"><div><strong>NO MORE BOATS!</strong><span>NYC Ferry service has concluded for the day.</span></div></div>`;
    return;
  }

  elements.departures.innerHTML = rows.map(({ departure, group }) => {
    const visual = routeVisual(group.routeId, group.variant);
    const { delayLabel, onTimeLabel, scheduledLabel, lastLabel, assignment, noPickupLabel, dropOffLabel, crewBoats } =
      departureStatus(departure);
    const variantBadge = group.variant ? `<small class="route-variant">${escapeHtml(visual.variantLabel)}</small>` : "";
    // "Northbound" says nothing about a boat going home empty, so the context line says what the
    // move is instead — the same words the route board puts under the destination.
    const context = group.crewShuttle || group.outOfService
      ? groupContext(group, visual.isOtherOperator)
      : (visual.isOtherOperator ? visual.route.operator : directionLabel(group.directionId));
    // The vessel is only known once a live vehicle is matched to the trip, so partner operators and
    // not-yet-assigned sailings simply omit the line rather than showing a placeholder. A crew
    // shuttle names the boats it relieves in the same place.
    const boat = crewBoats
      ? `<span class="tl-boat">${crewBoats}</span>`
      : (departure.boatName ? `<span class="tl-boat">${escapeHtml(departure.boatName)}</span>` : "");
    // Three lines, each reading left-to-right: when and which boat, then where, then who and how.
    // Time and route anchor the left edge; the countdown and the status badges are pushed to the
    // right, so both columns can be scanned straight down the list without the eye wandering.
    // The destination gets a line of its own because it is the longest thing on the row and the
    // one that reads worst truncated.
    const notInService = group.outOfService || group.crewShuttle ? " timeline-row-oos" : "";
    return `<article class="departure timeline-row route-${visual.routeClass}${notInService}"${visual.style}>
      <div class="tl-head">
        <time>${departureLabel(departure)}</time>
        <span class="route-badge${visual.partnerLogo ? " route-badge-image" : ""}">${visual.badgeContent}${variantBadge}</span>
        <span class="tl-relative">${escapeHtml(relativeTime(departure.delta))}</span>
      </div>
      <strong class="tl-dest">${escapeHtml(group.destination)}${group.via?.length ? `<span class="tl-via"> via ${escapeHtml(group.via.map(shortStop).join(", "))}</span>` : ""}</strong>
      <div class="tl-meta">
        <span class="tl-context">${escapeHtml(context)}</span>
        ${boat}
        <span class="tl-status">${lastLabel}${noPickupLabel}${delayLabel || onTimeLabel || scheduledLabel}${dropOffLabel}${assignment}</span>
      </div>
    </article>`;
  }).join("");
}

function renderRouteBoard() {
  const departuresShown = displayCount("departuresShown");
  const groups = routeDirectionGroups();
  elements.departures.dataset.view = "routes";
  elements.columnHead.hidden = false;
  // Staff view: no slideshow paging. Every route direction stays on screen and
  // the row grid squishes to fit, so an agent never waits for the answer to rotate in.
  elements.departures.style.setProperty("--routes-shown", String(Math.max(1, groups.length)));
  elements.routeCount.textContent = `${groups.length} route direction${groups.length === 1 ? "" : "s"}`;

  if (!groups.length) {
    elements.departures.innerHTML = `<div class="empty"><div><strong>NO MORE BOATS!</strong><span>NYC Ferry service has concluded for the day.</span></div></div>`;
    return;
  }

  elements.departures.innerHTML = groups.map((group) => {
    const { route, partnerLogo, variantLabel, badgeContent, routeClass, isOtherOperator, style: routeStyle } =
      routeVisual(group.routeId, group.variant);
    const variantClass = group.variant ? ` variant-${group.variant.toLowerCase()}` : "";
    const routeName = group.variant ? `${route.name || "East River"} ${variantLabel}` : (route.name || "NYC Ferry");
    const variantBadge = group.variant ? `<small class="route-variant">${escapeHtml(variantLabel)}</small>` : "";
    // Partner-operator routes (NY Waterway, Seastreak) keep their own official GTFS color and get
    // a small operator label so they're never mistaken for NYC Ferry service.
    const operatorBadge = isOtherOperator ? `<small class="route-operator">${escapeHtml(route.operator)}</small>` : "";
    const slots = [...group.departures];
    while (slots.length < departuresShown) slots.push(null);
    return `<article class="departure route-${routeClass}${variantClass}"${routeStyle}>
      <div class="route">
        <span class="route-badge${partnerLogo ? " route-badge-image" : ""}">${badgeContent}${variantBadge}</span>
        <span class="route-name">${escapeHtml(routeName)}${operatorBadge}</span>
      </div>
      <div class="destination"><strong>${escapeHtml(group.destination)}${viaLabel(group)}</strong><span>${groupContext(group, isOtherOperator)}</span></div>
      <div class="departure-slots">${slots.map((item) => item ? departureCell(item) : `<div class="departure-slot unavailable"><span>No scheduled trip</span></div>`).join("")}</div>
    </article>`;
  }).join("");
}

function ageLabel(timestamp) {
  const ageMs = timestamp ? Date.now() - Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  return `${Math.floor(ageMs / 3_600_000)} hr ago`;
}

function renderManualOverride() {
  const active = Boolean(manualOverride?.active && manualOverride.message);
  elements.screen.classList.toggle("override-active", active);
  elements.manualOverride.hidden = !active;
  elements.manualOverrideMessage.textContent = active ? manualOverride.message : "";
  const length = manualOverride?.message?.length || 0;
  elements.manualOverrideBox.dataset.size = length > 700 ? "long" : length > 280 ? "medium" : "short";

  const updatedAt = Date.parse(manualOverride?.updatedAt);
  elements.manualOverrideUpdated.textContent = active && Number.isFinite(updatedAt)
    ? `Updated ${new Intl.DateTimeFormat("en-US", {
      timeZone: data?.meta?.timezone || "America/New_York",
      month: "long", day: "numeric", hour: "numeric", minute: "2-digit"
    }).format(new Date(updatedAt))}`
    : "";

  if (data) {
    document.title = active
      ? `${data.meta.landing.displayName} Service Notice`
      : `${data.meta.landing.displayName} Departures`;
  }
}

async function loadManualOverride() {
  const landingId = data?.meta?.landingNumber;
  if (!landingId) return;
  try {
    const response = await fetch(`/api/override?landingId=${encodeURIComponent(landingId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    manualOverride = await response.json();
    renderManualOverride();
  } catch {
    // Preserve the last known state if the local server is temporarily unreachable.
  }
}

function renderServiceAlerts() {
  const alerts = serviceAlerts?.alerts || [];
  const unavailable = Boolean(serviceAlerts && !serviceAlerts.available && alerts.length === 0);
  const stale = Boolean(serviceAlerts?.stale);
  elements.serviceAlerts.classList.toggle("loading", !serviceAlerts);
  elements.serviceAlerts.classList.toggle("active", alerts.length > 0);
  elements.serviceAlerts.classList.toggle("stale", stale && !unavailable);
  elements.serviceAlerts.classList.toggle("unavailable", unavailable);

  if (!serviceAlerts) return;
  if (unavailable) {
    elements.serviceAlertSummary.textContent = "Live service alerts are temporarily unavailable.";
    elements.serviceAlertFreshness.textContent = "Retrying automatically";
    elements.serviceAlertCount.hidden = true;
    return;
  }
  if (alerts.length === 0) {
    elements.serviceAlertSummary.textContent = "No active NYC Ferry service alerts.";
    elements.serviceAlertFreshness.textContent = `${stale ? "Saved update" : "Updated"} ${ageLabel(serviceAlerts.feedTimestamp || serviceAlerts.fetchedAt)}`;
    elements.serviceAlertCount.hidden = true;
    return;
  }
  const first = alerts[0];
  const detail = first.description && first.description !== first.header
    ? `${first.header} — ${first.description}`
    : first.header || first.description || "NYC Ferry service alert";
  elements.serviceAlertSummary.textContent = alerts.length > 1 ? `${detail} · ${alerts.length - 1} more active` : detail;
  elements.serviceAlertFreshness.textContent = `${stale ? "Saved alert" : "Updated"} ${ageLabel(serviceAlerts.feedTimestamp || serviceAlerts.fetchedAt)}`;
  elements.serviceAlertCount.textContent = String(alerts.length);
  elements.serviceAlertCount.hidden = false;
}

async function loadServiceAlerts() {
  try {
    const response = await fetch("/api/alerts", { cache: "no-store" });
    if (!response.ok) throw new Error();
    serviceAlerts = await response.json();
    localStorage.setItem(`${cacheKey}-alerts`, JSON.stringify(serviceAlerts));
  } catch {
    const saved = localStorage.getItem(`${cacheKey}-alerts`);
    serviceAlerts = saved
      ? { ...JSON.parse(saved), stale: true }
      : { available: false, stale: true, fetchedAt: null, alerts: [] };
  }
  renderServiceAlerts();
}

function updateClock() {
  const now = new Date();
  const timeZone = data?.meta?.timezone || "America/New_York";
  elements.time.textContent = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  elements.date.textContent = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
  render();
}

async function loadRealtime() {
  try {
    // The server tracks every landing, so name ours: without it the payload carries updates for
    // the whole system. Before display data has loaded there is no landing to name, and the
    // unfiltered response is still correct.
    const landingId = data?.meta?.landingNumber;
    const query = landingId ? `?landingId=${encodeURIComponent(landingId)}` : "";
    const response = await fetch(`/api/realtime${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    realtime = await response.json();
    localStorage.setItem(`${cacheKey}-realtime`, JSON.stringify(realtime));
    elements.status.innerHTML = `<i></i><span>${realtime.stale ? "Saved live estimates" : "Live estimates"}</span>`;
  } catch {
    const saved = localStorage.getItem(`${cacheKey}-realtime`);
    if (saved) {
      realtime = { ...JSON.parse(saved), stale: true };
      elements.status.innerHTML = "<i></i><span>Saved live estimates</span>";
    } else {
      elements.status.innerHTML = "<i></i><span>Local schedule</span>";
    }
  }
  render();
}

function selectedLanding() {
  const value = Number(localStorage.getItem(landingKey));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function landingDataKey(landingNumber) {
  return `${cacheKey}-landing-${landingNumber}`;
}

async function load() {
  const selected = selectedLanding();
  // No stored choice means this device has never picked one, so take whatever the build
  // configured. Once a board loads, its landing is remembered for the next start.
  const query = selected === null ? "" : `?landingId=${encodeURIComponent(selected)}`;
  try {
    const response = await fetch(`/api/display-data${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    data = await response.json();
    localStorage.setItem(landingKey, String(data.meta.landingNumber));
    localStorage.setItem(landingDataKey(data.meta.landingNumber), JSON.stringify(data));
  } catch {
    const saved = selected === null ? null : localStorage.getItem(landingDataKey(selected));
    if (!saved) throw new Error("No display data is available.");
    data = JSON.parse(saved);
  }
  elements.landing.textContent = data.meta.landing.displayName;
  renderLandingList();
  await loadManualOverride();
  updateClock();
  loadRealtime();
  loadServiceAlerts();
}

function renderLandingList() {
  const landings = JSON.parse(localStorage.getItem(landingsKey) || "[]");
  if (!landings.length) return;
  const current = data?.meta?.landingNumber;
  elements.landingList.innerHTML = landings.map((landing) => `<li>
    <button type="button" class="landing-option${landing.id === current ? " is-current" : ""}" data-landing-id="${landing.id}"${landing.id === current ? ' aria-current="true"' : ""}>
      <span class="landing-option-number">${escapeHtml(landing.id)}</span>
      <span class="landing-option-name">${escapeHtml(landing.displayName)}</span>
    </button>
  </li>`).join("");
}

async function loadLandings() {
  try {
    const response = await fetch("/api/landings", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    localStorage.setItem(landingsKey, JSON.stringify(payload.landings || []));
  } catch {
    // Keep whatever list was saved; the menu still works offline.
  }
  renderLandingList();
}

function setMenuOpen(open) {
  elements.landingMenu.hidden = !open;
  elements.menuButton.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
  if (open) (elements.landingList.querySelector(".is-current") || elements.landingMenuClose)?.focus();
  else elements.menuButton.focus();
}

async function selectLanding(landingNumber) {
  if (!Number.isInteger(landingNumber) || landingNumber === data?.meta?.landingNumber) return setMenuOpen(false);
  localStorage.setItem(landingKey, String(landingNumber));
  setMenuOpen(false);
  elements.departures.innerHTML = `<div class="empty"><div><strong>Loading…</strong><span>Switching landing.</span></div></div>`;
  await load().catch(() => {
    elements.departures.innerHTML = `<div class="empty"><div><strong>Landing unavailable</strong><span>That landing could not be loaded.</span></div></div>`;
  });
}

elements.menuButton.addEventListener("click", () => setMenuOpen(elements.landingMenu.hidden));
elements.landingMenuClose.addEventListener("click", () => setMenuOpen(false));
elements.landingMenuScrim.addEventListener("click", () => setMenuOpen(false));
elements.landingList.addEventListener("click", (event) => {
  const option = event.target.closest("[data-landing-id]");
  if (option) selectLanding(Number(option.dataset.landingId));
});
for (const button of elements.sortOptions) {
  button.addEventListener("click", () => selectSort(button.dataset.sort));
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.landingMenu.hidden) setMenuOpen(false);
});

renderSortToggle();
loadLandings();
load().catch(() => {
  elements.departures.innerHTML = `<div class="empty"><div><strong>Schedule unavailable</strong><span>The local schedule needs attention.</span></div></div>`;
});
setInterval(updateClock, 15_000);
setInterval(loadRealtime, 15_000);
setInterval(loadServiceAlerts, 60_000);
setInterval(loadManualOverride, 5_000);
if ("serviceWorker" in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("/sw.js?v=32", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {});
}
