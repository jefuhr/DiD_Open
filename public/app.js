const elements = {
  landing: document.querySelector("#landingName"),
  time: document.querySelector("#clockTime"),
  date: document.querySelector("#clockDate"),
  departures: document.querySelector("#departures"),
  status: document.querySelector("#dataStatus"),
  slideStatus: document.querySelector("#slideStatus"),
  serviceAlerts: document.querySelector("#serviceAlerts"),
  serviceAlertSummary: document.querySelector("#serviceAlertSummary"),
  serviceAlertFreshness: document.querySelector("#serviceAlertFreshness"),
  serviceAlertCount: document.querySelector("#serviceAlertCount")
};

const cacheKey = "nyc-ferry-did-data-v5";
let data;
let realtime = { updates: [], vehicles: [], available: false, stale: true };
let serviceAlerts = null;
let slideIndex = 0;
let slideTimer = null;

function displayCount(key) {
  const value = Number(data?.meta?.[key]);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 4;
}

function applyDisplayCounts() {
  document.documentElement.dataset.routesShown = String(displayCount("routesShown"));
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

function routeDirectionGroups(now = new Date()) {
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
      const delay = hasLiveTiming ? liveDelay : 0;
      const delta = offset * 86400 + departure.seconds + delay - current.seconds;
      const slotKey = `${departure.routeId}|${departure.variant || ""}|${departure.directionId}`;
      const scheduledMoment = offset * 86400 + departure.seconds;
      const previousLast = lastDepartures.get(slotKey);
      if (!previousLast || scheduledMoment > previousLast.scheduledMoment) {
        lastDepartures.set(slotKey, { tripId: String(departure.tripId), scheduledMoment });
      }
      if (departure.routeId === "SB" && departure.servesGovernorsIsland) {
        const previousIslandLast = lastGovernorsIslandDepartures.get(slotKey);
        if (!previousIslandLast || scheduledMoment > previousIslandLast.scheduledMoment) {
          lastGovernorsIslandDepartures.set(slotKey, { tripId: String(departure.tripId), scheduledMoment });
        }
      }
      if (delta < -60) continue;
      const key = `${departure.routeId}|${departure.variant || ""}|${departure.directionId}|${departure.destination}`;
      const group = groups.get(key) || {
        key, routeId: departure.routeId, directionId: departure.directionId,
        destination: departure.destination, variant: departure.variant || null, departures: []
      };
      group.departures.push({
        ...departure,
        delay,
        delta,
        hasLiveTiming,
        boatName: vehicles.get(String(departure.tripId))?.boatName || null
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
      departures: group.departures.slice(0, displayCount("departuresShown"))
    }))
    .sort((left, right) => {
    const routeOrder = left.routeId.localeCompare(right.routeId);
    if (routeOrder) return routeOrder;
    const variantOrder = { A: 0, B: 1, LOCAL: 2 };
    const variantDifference = (variantOrder[left.variant] ?? 3) - (variantOrder[right.variant] ?? 3);
    if (variantDifference) return variantDifference;
    const directionOrder = String(left.directionId).localeCompare(String(right.directionId));
    return directionOrder || left.destination.localeCompare(right.destination);
    });
}

function departureCell(item) {
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
  const scheduledLabel = !isLast && !delayLabel && !onTimeLabel
    ? `<span class="scheduled-badge" aria-label="Status: Scheduled">SCHEDULED</span>`
    : "";
  return `<div class="departure-slot">
    <div class="slot-time-row"><time>${adjustedTime(item.departureTime, item.delay)}</time></div>
    <span class="boat-name">${item.boatName ? escapeHtml(item.boatName) : ""}</span>
    <span class="slot-relative">${escapeHtml(relativeTime(item.delta))}</span>
    <span class="departure-last-slot">${lastLabel}${delayLabel || onTimeLabel || scheduledLabel}</span>
  </div>`;
}

function render() {
  if (!data) return;
  applyDisplayCounts();
  const routesShown = displayCount("routesShown");
  const departuresShown = displayCount("departuresShown");
  const groups = routeDirectionGroups();
  const pageCount = Math.max(1, Math.ceil(groups.length / routesShown));
  slideIndex %= pageCount;
  const start = slideIndex * routesShown;
  const visible = groups.slice(start, start + routesShown);
  elements.slideStatus.textContent = pageCount > 1
    ? `Routes ${start + 1}–${Math.min(start + routesShown, groups.length)} of ${groups.length} · Page ${slideIndex + 1}/${pageCount}`
    : `${groups.length} route direction${groups.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    elements.departures.innerHTML = `<div class="empty"><div><strong>NO MORE BOATS!</strong><span>NYC Ferry service has concluded for the day.</span></div></div>`;
    return;
  }

  elements.departures.innerHTML = visible.map((group) => {
    const route = data.routes[group.routeId] || {};
    const routeClass = String(group.routeId || "default").replace(/[^A-Za-z0-9_-]/g, "");
    const variantClass = group.variant ? ` variant-${group.variant.toLowerCase()}` : "";
    const variantLabel = group.variant === "LOCAL" ? "Local" : group.variant;
    const routeName = group.variant ? `${route.name || "East River"} ${variantLabel}` : (route.name || "NYC Ferry");
    const variantBadge = group.variant ? `<small class="route-variant">${escapeHtml(variantLabel)}</small>` : "";
    const slots = [...group.departures];
    while (slots.length < departuresShown) slots.push(null);
    return `<article class="departure route-${routeClass}${variantClass}">
      <div class="route">
        <span class="route-badge"><b>${escapeHtml(route.shortName || group.routeId)}</b>${variantBadge}</span>
        <span class="route-name">${escapeHtml(routeName)}</span>
      </div>
      <div class="destination"><strong>${escapeHtml(group.destination)}</strong><span>${directionLabel(group.directionId)}</span></div>
      <div class="departure-slots">${slots.map((item) => item ? departureCell(item) : `<div class="departure-slot unavailable"><span>No scheduled trip</span></div>`).join("")}</div>
    </article>`;
  }).join("");
}

function startSlideshow() {
  if (slideTimer) clearInterval(slideTimer);
  const seconds = Number(data?.meta?.slideSeconds) || 12;
  slideTimer = setInterval(() => { slideIndex += 1; render(); }, seconds * 1000);
}

function ageLabel(timestamp) {
  const ageMs = timestamp ? Date.now() - Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  return `${Math.floor(ageMs / 3_600_000)} hr ago`;
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
    const response = await fetch("/api/realtime", { cache: "no-store" });
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

async function load() {
  try {
    const response = await fetch("/api/display-data", { cache: "no-store" });
    if (!response.ok) throw new Error();
    data = await response.json();
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    const saved = localStorage.getItem(cacheKey);
    if (!saved) throw new Error("No display data is available.");
    data = JSON.parse(saved);
  }
  elements.landing.textContent = data.meta.landing.displayName;
  document.title = `${data.meta.landing.displayName} Departures`;
  slideIndex = 0;
  updateClock();
  startSlideshow();
  loadRealtime();
  loadServiceAlerts();
}

load().catch(() => {
  elements.departures.innerHTML = `<div class="empty"><div><strong>Schedule unavailable</strong><span>The local schedule needs attention.</span></div></div>`;
});
setInterval(updateClock, 15_000);
setInterval(loadRealtime, 15_000);
setInterval(loadServiceAlerts, 60_000);
if ("serviceWorker" in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("/sw.js?v=25", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {});
}
