const { storage, request, html: reconcileHTML, poll, panel, contentTransition } = MobileRuntime;
const elements = {
  screen: document.querySelector("#screen"),
  landing: document.querySelector("#landingName"),
  time: document.querySelector("#clockTime"),
  date: document.querySelector("#clockDate"),
  departures: document.querySelector("#departures"),
  status: document.querySelector("#dataStatus"),
  routeCount: document.querySelector("#routeCount"),
  columnHead: document.querySelector("#columnHead"),
  boardNote: document.querySelector("#boardNote"),
  serviceAlerts: document.querySelector("#serviceAlerts"),
  serviceAlertSummary: document.querySelector("#serviceAlertSummary"),
  serviceAlertFreshness: document.querySelector("#serviceAlertFreshness"),
  serviceAlertCount: document.querySelector("#serviceAlertCount"),
  serviceAlertChevron: document.querySelector("#serviceAlertChevron"),
  alertMenu: document.querySelector("#alertMenu"),
  alertMenuScrim: document.querySelector("#alertMenuScrim"),
  alertMenuClose: document.querySelector("#alertMenuClose"),
  tripMenu: document.querySelector("#tripMenu"),
  tripMenuScrim: document.querySelector("#tripMenuScrim"),
  tripMenuClose: document.querySelector("#tripMenuClose"),
  tripMenuTitle: document.querySelector("#tripMenuTitle"),
  tripSummary: document.querySelector("#tripSummary"),
  tripMapLink: document.querySelector("#tripMapLink"),
  tripMapLabel: document.querySelector("#tripMapLabel"),
  tripStops: document.querySelector("#tripStops"),
  alertList: document.querySelector("#alertList"),
  changelogButton: document.querySelector("#changelogButton"),
  changelogBang: document.querySelector("#changelogBang"),
  changelogMenu: document.querySelector("#changelogMenu"),
  changelogMenuScrim: document.querySelector("#changelogMenuScrim"),
  changelogMenuClose: document.querySelector("#changelogMenuClose"),
  changelogList: document.querySelector("#changelogList"),
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
  nearestButton: document.querySelector("#nearestButton"),
  nearestLabel: document.querySelector("#nearestLabel"),
  dateBar: document.querySelector("#dateBar"),
  datePrev: document.querySelector("#datePrev"),
  dateNext: document.querySelector("#dateNext"),
  dateCurrent: document.querySelector("#dateCurrent"),
  clockToggle: document.querySelector("#clockToggle"),
  filterButton: document.querySelector("#filterButton"),
  filterCount: document.querySelector("#filterCount"),
  filterMenu: document.querySelector("#filterMenu"),
  filterMenuScrim: document.querySelector("#filterMenuScrim"),
  filterMenuClose: document.querySelector("#filterMenuClose"),
  filterList: document.querySelector("#filterList"),
  filterReset: document.querySelector("#filterReset"),
  themeButton: document.querySelector("#themeButton"),
  themeMenu: document.querySelector("#themeMenu"),
  themeMenuScrim: document.querySelector("#themeMenuScrim"),
  themeMenuClose: document.querySelector("#themeMenuClose"),
  themeList: document.querySelector("#themeList"),
  sortOptions: [...document.querySelectorAll("[data-sort]")]
};

// The prefix for every localStorage key this board owns: the chosen landing, the favourites, the
// theme, the hidden operators and the saved schedules. It resembles the service worker's cache
// names and is deliberately not versioned with them — bumping it would orphan all of that on every
// device on every release. scripts/stamp-assets.js scopes its rewrite to sw.js for this reason.
const cacheKey = "nyc-ferry-did-data-v6";
// Which landing this device is showing. Persisted so an agent's choice survives a reload and
// so an offline start knows which cached board to restore.
const landingKey = "nyc-ferry-did-selected-landing";
const landingsKey = "nyc-ferry-did-landings";
// Whether the board orders route cards by which one leaves next (the default) or by route.
// Persisted like the landing choice, and deliberately per-device: it is a reading preference,
// not board config.
const sortKey = "nyc-ferry-did-sort";
// Whether times print as 24-hour (the default, and what the schedule, the workbook and the radio
// all speak in) or 12-hour. Persisted per device like the sort choice: it is a reading preference,
// not board config, and an agent who wants one wants it on every landing they open.
const clockKey = "nyc-ferry-did-clock";
// Which operators the board has been told to hide, as a list of operator names. Persisted per
// device and deliberately not per landing: an agent who does not want to read NY Waterway boats
// does not want to read them at Pier 79 either. Stored by name rather than by route id so a
// partner adding a route does not quietly reappear on a board that hid the operator.
const hiddenOperatorsKey = "nyc-ferry-did-hidden-operators";
// Every operator the system serves anywhere, as /api/landings reports it. Cached like the landing
// list so the panel is complete offline too.
const operatorsKey = "nyc-ferry-did-operators";
// Which landings have been starred, as a list of landing ids. Persisted per device like the other
// reading preferences: an agent works a handful of docks out of the 26 on the list, and the ones
// they work do not change because they opened the board somewhere else.
const favouriteLandingsKey = "nyc-ferry-did-favourite-landings";
// Which paint the board wears. Persisted per device like the other reading preferences, and read
// again by the inline script in index.html so the choice is on the document before the first paint.
const themeKey = "nyc-ferry-did-theme";
// The board's own livery first, so a device that has never been told otherwise looks like the
// terminal signage it is modelled on.
// Night sits second because it is the only one of these anybody picks for a reason other than
// liking it — a board read on a dark bridge at 3am is a working need, not a mood.
const THEMES = [
  { id: "nyc-ferry", name: "NYC Ferry", note: "Terminal signage blue", color: "#001d41" },
  { id: "night", name: "Night", note: "Dark, for a wheelhouse after dark", color: "#0d1b26" },
  { id: "hello-kitty", name: "Hello Kitty", note: "Juliet's favorite theme 😇", color: "#ff9dbb" },
  { id: "cinnamoroll", name: "Cinnamoroll", note: "Sky blue and quiet", color: "#7ec8f0" },
  { id: "pompompurin", name: "Pompompurin", note: "Butter yellow, brown beret", color: "#ffd94a" },
  { id: "kuromi", name: "Kuromi", note: "Purple, with a loud pink streak", color: "#4a2d6b" },
  { id: "windows-xp", name: "Windows XP", note: "Luna blue and Tahoma", color: "#0058ee" },
  { id: "hacker", name: "Hacker", note: "Green phosphor on black", color: "#000000" },
  { id: "burger-king", name: "Burger King", note: "Flame-grilled, in Flame", color: "#D62300" }
];
// The newest change-log entry this device has already been shown. The mark beside the kitty is
// meant to say "there is something you have not read", so it has to remember what was read.
const changelogSeenKey = "nyc-ferry-did-changelog-seen";
// The landing a location fix last resolved to, so the shortcut survives a reload.
const nearestKey = "nyc-ferry-did-nearest";
// A fix is only good for about the shift it was taken in. Crew move between landings, and a
// shortcut still pointing at yesterday's dock is worse than no shortcut at all.
const nearestMaxAgeMs = 12 * 60 * 60 * 1000;
let nearestTimer = null;
// Which service date the board is showing, as YYYY-MM-DD, or null for "today, live".
//
// Deliberately not persisted. A landing choice is a setting; a date is a lookup. A board left
// showing tomorrow and then picked up cold the next morning would be confidently wrong about the
// one thing it exists to state, so every start and every landing switch returns to today.
let viewDate = null;
// The trip the fullscreen view is showing, and a token that lets a slow response for a trip the
// user has already navigated away from be dropped rather than painted over the new one.
let tripView = null;
let tripRequest = 0;
let data;
// `stale` gates whether live timings may be trusted; `cached` says whether there is saved data
// behind them at all. A device that has never reached the feed is stale without being cached, and
// the two have to be told apart because only one of them can honestly be called "Saved".
let realtime = { updates: [], vehicles: [], available: false, stale: true, cached: false };
let serviceAlerts = null;
let manualOverride = { active: false, message: "", updatedAt: null };

function sortedBy() {
  return storage.getItem(sortKey) === "route" ? "route" : "time";
}

function renderSortToggle() {
  const active = sortedBy();
  for (const button of elements.sortOptions) {
    button.setAttribute("aria-pressed", String(button.dataset.sort === active));
  }
}

function selectSort(next) {
  if (next !== "route" && next !== "time") return;
  storage.setItem(sortKey, next);
  renderSortToggle();
  // Re-order in place: the menu stays open so the choice can be changed again, and nothing
  // needs refetching because sorting only touches the order cards are laid out in.
  render();
}

// Hiding operators.
//
// A landing like Pier 79 carries NYC Ferry, NY Waterway and the shuttles on one list, and an agent
// working one of them is reading past the other two all day. The filter is purely a display cut:
// nothing is refetched, and the hidden operators keep loading so that unhiding is instant and a
// service alert about them still reaches the bar at the bottom.

function agencyName() {
  return data?.meta?.agencyName || "NYC Ferry";
}

function operatorOf(routeId) {
  return data?.routes?.[routeId]?.operator || agencyName();
}

// Every operator the system serves, not merely the ones calling at the landing on screen: the
// filter is one per-device setting that follows the agent between docks, so the panel has to offer
// the same rows everywhere and the badge has to count the same hidden operators everywhere. A
// panel that changed shape at every landing would read as a per-landing setting, which it is not.
//
// The roster comes from /api/landings, which builds it across every landing. Falling back to the
// current payload covers the one case the roster cannot: a device that has never reached the
// server. Ordering is the same either way — home agency first, partners alphabetically.
function operatorList() {
  try {
    const stored = JSON.parse(storage.getItem(operatorsKey) || "[]");
    const roster = Array.isArray(stored) ? stored.filter((name) => typeof name === "string") : [];
    if (roster.length) return roster;
  } catch {
    // Fall through to the landing's own operators.
  }
  const names = new Set(Object.keys(data?.routes || {}).map(operatorOf));
  const home = agencyName();
  const partners = [...names].filter((name) => name !== home).sort((left, right) => left.localeCompare(right));
  return names.has(home) ? [home, ...partners] : partners;
}

function hiddenOperators() {
  try {
    const stored = JSON.parse(storage.getItem(hiddenOperatorsKey) || "[]");
    return new Set(Array.isArray(stored) ? stored.filter((name) => typeof name === "string") : []);
  } catch {
    return new Set();
  }
}

function isVisibleRoute(routeId) {
  return !hiddenOperators().has(operatorOf(routeId));
}

function setOperatorHidden(name, hidden) {
  const next = hiddenOperators();
  if (hidden) next.add(name);
  else next.delete(name);
  storage.setItem(hiddenOperatorsKey, JSON.stringify([...next]));
  renderFilterMenu();
  // The list is rebuilt from scratch, so put the cursor back on the row that was just toggled —
  // otherwise a keyboard user is dropped to the top of the panel after every single switch.
  elements.filterList.querySelector(`[data-operator="${CSS.escape(name)}"]`)?.focus();
  // Only the cut changes, not the schedule underneath it, so this is a re-render and nothing more.
  render();
}

function showAllOperators() {
  storage.removeItem(hiddenOperatorsKey);
  renderFilterMenu();
  render();
}

function renderFilterMenu() {
  const hidden = hiddenOperators();
  const operators = operatorList();
  // The badge counts against the whole roster, so it reads the same at every landing — the setting
  // is one thing that follows the device, and a count that dropped to zero on arriving somewhere a
  // hidden operator does not call would suggest the filter had been forgotten.
  const hiddenHere = operators.filter((name) => hidden.has(name));
  elements.filterCount.hidden = hiddenHere.length === 0;
  elements.filterCount.textContent = String(hiddenHere.length);
  elements.filterButton.classList.toggle("is-filtering", hiddenHere.length > 0);
  elements.filterButton.setAttribute("aria-label", hiddenHere.length
    ? `Filter operators — ${hiddenHere.length} hidden`
    : "Filter operators");
  elements.filterReset.disabled = hiddenHere.length === 0;

  elements.filterList.innerHTML = operators.map((name) => {
    const shown = !hidden.has(name);
    return `<li><button type="button" class="filter-option${shown ? " is-shown" : ""}" data-operator="${escapeHtml(name)}" role="switch" aria-checked="${shown}">
      <span class="filter-option-name">${escapeHtml(name)}</span>
      <span class="filter-option-state" aria-hidden="true">${shown ? "Shown" : "Hidden"}</span>
    </button></li>`;
  }).join("");
}

function setFilterOpen(open) {
  panel(elements.filterMenu, open);
  elements.filterButton.setAttribute("aria-expanded", String(open));
  if (open) (elements.filterList.querySelector(".filter-option") || elements.filterMenuClose)?.focus();
  else elements.filterButton.focus();
}

// The change log, written by hand in content/changelog.json and served from /api/changelog. Never
// fatal: a board with no change log is a board, and this is the least important thing on it.
let changelog = [];

function changelogVersion(entry) {
  return String(entry?.version || entry?.date || entry?.title || "");
}

// The "!" is not decoration. It appears when the newest entry is one this device has not been shown
// and goes away when the sheet is opened, which is the only thing that makes it worth a glance.
function renderChangelogBang() {
  const newest = changelogVersion(changelog[0]);
  let seen = "";
  try {
    seen = storage.getItem(changelogSeenKey) || "";
  } catch {
    seen = "";
  }
  elements.changelogBang.hidden = !newest || newest === seen;
}

function renderChangelog() {
  elements.changelogList.innerHTML = changelog.length
    ? changelog.map((entry) => {
        const notes = Array.isArray(entry.notes) ? entry.notes : [];
        const heading = [entry.title, entry.date].filter(Boolean).map(escapeHtml).join(" · ");
        return `<li class="changelog-entry">
          <strong class="changelog-entry-head">${heading || escapeHtml(changelogVersion(entry))}</strong>
          ${notes.length ? `<ul class="changelog-notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
        </li>`;
      }).join("")
    : `<li class="alert-empty">Nothing written down yet.</li>`;
}

function setChangelogOpen(open) {
  if (open) renderChangelog();
  panel(elements.changelogMenu, open);
  elements.changelogButton.setAttribute("aria-expanded", String(open));
  if (open) {
    // Opening it is reading it.
    try {
      storage.setItem(changelogSeenKey, changelogVersion(changelog[0]));
    } catch {
      // A device that will not store the mark simply keeps showing it.
    }
    renderChangelogBang();
    elements.changelogMenuClose?.focus();
  } else {
    elements.changelogButton.focus();
  }
}

async function loadChangelog() {
  try {
    const response = await request("/api/changelog", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    changelog = Array.isArray(payload.entries) ? payload.entries : [];
  } catch {
    changelog = [];
  }
  renderChangelogBang();
}

function activeTheme() {
  const saved = storage.getItem(themeKey);
  return THEMES.some((theme) => theme.id === saved) ? saved : THEMES[0].id;
}

function applyTheme() {
  const theme = THEMES.find((entry) => entry.id === activeTheme()) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  // The status bar of an installed board is painted from this, so it has to move with the theme or
  // a pink board keeps a navy notch.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.color);
}

function renderThemeMenu() {
  const current = activeTheme();
  elements.themeList.innerHTML = THEMES.map((theme) => {
    const chosen = theme.id === current;
    return `<li><button type="button" class="filter-option theme-option${chosen ? " is-shown" : ""}" data-theme="${escapeHtml(theme.id)}" role="radio" aria-checked="${chosen}">
      <span class="filter-option-name">${escapeHtml(theme.name)}<small class="theme-option-note">${escapeHtml(theme.note)}</small></span>
      <span class="filter-option-state" aria-hidden="true">${chosen ? "On" : ""}</span>
    </button></li>`;
  }).join("");
}

function selectTheme(id) {
  if (!THEMES.some((theme) => theme.id === id)) return;
  storage.setItem(themeKey, id);
  applyTheme();
  // The sheet stays open so the themes can be compared against the board behind it, which is the
  // whole reason this lives in the footer rather than in the landing drawer.
  renderThemeMenu();
  // The favourite mark is baked into the landing list's markup, so it only changes when that list
  // is rebuilt. Without this the kitty arrives on the next reload, which reads as the picker having
  // half worked.
  renderLandingList();
  elements.themeList.querySelector(`[data-theme="${CSS.escape(id)}"]`)?.focus();
}

function setThemeOpen(open) {
  panel(elements.themeMenu, open);
  elements.themeButton.setAttribute("aria-expanded", String(open));
  if (open) (elements.themeList.querySelector(".theme-option") || elements.themeMenuClose)?.focus();
  else elements.themeButton.focus();
}

function clockFormat() {
  return storage.getItem(clockKey) === "12" ? "12" : "24";
}

// The hour half of every formatter that prints a time for someone to read.
//
// Display only. zonedParts() below deliberately does not use this: it reads the hour to do
// arithmetic with, and a 1-12 hour would put "now" twelve hours out for half of every day.
//
// h23 rather than hour12:false, which yields a 24:00 hour in some locales; h12 rather than
// hour12:true for the same reason of asking for the cycle by name.
function hourOptions() {
  return clockFormat() === "12"
    ? { hour: "numeric", hourCycle: "h12" }
    : { hour: "2-digit", hourCycle: "h23" };
}

function renderClockToggle() {
  const twelve = clockFormat() === "12";
  elements.clockToggle.textContent = twelve ? "12 h" : "24 h";
  elements.clockToggle.setAttribute("aria-pressed", String(twelve));
  elements.clockToggle.setAttribute("aria-label",
    twelve ? "Times are shown on a 12-hour clock. Switch to 24-hour." : "Times are shown on a 24-hour clock. Switch to 12-hour.");
}

function toggleClockFormat() {
  storage.setItem(clockKey, clockFormat() === "12" ? "24" : "12");
  renderClockToggle();
  // Every printed time changes at once: the rows, the clock and the notice stamp. The browsed-day
  // cache holds rendered HTML, so it has to go with them.
  resetSchedule();
  renderManualOverride();
  updateClock();
  render();
  if (tripView) renderTripView();
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

// Memoized per landing payload. Stepping through days asks this the same questions over and over —
// every render re-reads today and yesterday — and the answer for a given date cannot change while
// the payload is the one it was computed from. Cleared wholesale in resetSchedule().
const serviceCache = new Map();
const dayCache = new Map();

function resetSchedule() {
  serviceCache.clear();
  dayCache.clear();
}

function activeServices(dateKey) {
  const cached = serviceCache.get(dateKey);
  if (cached) return cached;
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const active = new Set();
  for (const item of data.calendars || []) {
    if (dateKey >= item.startDate && dateKey <= item.endDate && item.weekdays[weekday]) active.add(item.serviceId);
  }
  for (const item of data.exceptions || []) {
    if (item.date !== dateKey) continue;
    if (item.added) active.add(item.serviceId); else active.delete(item.serviceId);
  }
  serviceCache.set(dateKey, active);
  return active;
}

// What actually distinguishes one schedule day from another.
//
// A date is not the unit of work here — a service pattern is. Every ordinary Tuesday in the feed
// selects the identical set of service ids, and so produces the identical board; only weekends and
// the dated exceptions in calendar_dates.txt differ. Keying the computed day on the services rather
// than the date means stepping across a week costs two real computations, not seven, and stepping
// back across it costs none.
//
// Yesterday's services are part of the key because a sailing published as 25:10 belongs to the
// previous service day and lands on this one.
function serviceSignature(dateKey) {
  return `${[...activeServices(dateKey)].sort().join(",")}|${[...activeServices(addDays(dateKey, -1))].sort().join(",")}`;
}

// The span of dates the bundled schedule can actually answer for. Read off the calendars rather
// than feed_info, because the crew calendars and the partner feeds each carry their own bounds and
// the board is only honest for a date every one of them covers... or rather, for a date any of them
// covers: a day inside NYC Ferry's range but past NY Waterway's simply shows no waterway rows,
// which is the same thing the live board already does when a partner feed lapses.
function scheduleRange() {
  const bounded = (data.calendars || []).filter((item) => item.startDate && item.endDate);
  if (!bounded.length) return null;
  return {
    first: bounded.map((item) => item.startDate).sort()[0],
    last: bounded.map((item) => item.endDate).sort().at(-1)
  };
}

// Today and now, or a browsed date and the start of it.
//
// Everything downstream reads the board through this one object, which is what keeps browsing from
// forking the render path: a browsed day is simply "now = 00:00 on that date, and no live feed".
function viewFrame(now = new Date()) {
  const current = zonedParts(now, data.meta.timezone);
  if (!viewDate || viewDate === current.dateKey) {
    return { dateKey: current.dateKey, seconds: current.seconds, today: current.dateKey, live: true };
  }
  return { dateKey: viewDate, seconds: 0, today: current.dateKey, live: false };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function adjustedTime(raw, delaySeconds = 0) {
  const [hours, minutes, seconds] = raw.split(":").map(Number);
  const total = hours * 3600 + minutes * 60 + seconds + delaySeconds;
  // 24-hour, zero-padded, by default: this is a crew board, and the schedule, the workbook and the
  // radio all speak in it. hourOptions() lets a device switch to 12-hour without that stopping
  // being the default anywhere else.
  //
  // The hour is taken modulo 24 first, so a GTFS 25:10 prints as the 01:10 it is rather than
  // overflowing into the next day.
  return new Intl.DateTimeFormat("en-US", { ...hourOptions(), minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, 0, 1, Math.floor(total / 3600) % 24, Math.floor((total % 3600) / 60))));
}

// A crew shuttle is ready at the listed time but waits for the boats it is collecting from to sail,
// so it prints the window rather than a minute it will not leave on: "14:35 – 15:05".
function departureLabel(item) {
  // A boat leaving the home port has no published departure time — the operator says it is not
  // constant — so the row shows when it is due at its first landing and stars it.
  const star = item.approximate ? `<abbr class="approx" title="Approximate: the boat's home-port departure is not fixed">*</abbr>` : "";
  const start = adjustedTime(item.departureTime, item.delay) + star;
  if (!item.departureTimeEnd) return start;
  const end = adjustedTime(item.departureTimeEnd, 0);
  return `${start}<span class="time-range-dash">–</span>${escapeHtml(end)}`;
}

function relativeTime(deltaSeconds, live = true) {
  // On a browsed day "12 min" would be counting down from midnight, which is nonsense, so the row
  // simply shows the scheduled time and nothing else.
  if (!live) return "";
  if (deltaSeconds <= 90) return "Boarding";
  if (deltaSeconds < 3600) return `${Math.ceil(deltaSeconds / 60)} min`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)} hr ${Math.ceil((deltaSeconds % 3600) / 60)} min`;
  return "Tomorrow";
}

// Uptown and downtown rather than the compass. The feed thinks in direction_id and the compass is
// the literal reading of it, but nobody working the river says "northbound" — a boat going up the
// East River is going uptown, and that is the word an agent and a passenger will both use.
function directionLabel(directionId) {
  if (String(directionId) === "1") return "Uptown";
  if (String(directionId) === "0") return "Downtown";
  return "Direction unavailable";
}

function routeDirectionGroups(now = new Date(), limitPerGroup = displayCount("departuresShown")) {
  const frame = viewFrame(now);
  // A browsed day is a pure function of the schedule: no live feed is applied, and every delta is
  // measured from midnight rather than from a clock that moves. So the whole computed day can be
  // memoized, and — keyed on its services rather than its date — reused by every other day that
  // runs the same pattern. Today is never served from here; it changes every fifteen seconds.
  const cacheKey = frame.live ? null : `${limitPerGroup}|${serviceSignature(frame.dateKey)}`;
  if (cacheKey && dayCache.has(cacheKey)) return dayCache.get(cacheKey);
  const current = { dateKey: frame.dateKey, seconds: frame.seconds };
  const departureWindowSeconds = (Number(data.meta.departureWindowMinutes) || 180) * 60;
  // Live estimates describe boats that are on the water now. On any other day there are none, and
  // pretending otherwise would put yesterday's delays on tomorrow's sailings.
  const updates = frame.live ? new Map((realtime.updates || []).map((item) => [`${item.tripId}|${item.stopId}`, item])) : new Map();
  const vehicles = frame.live ? new Map((realtime.vehicles || []).map((item) => [String(item.tripId), item])) : new Map();
  // Which vessel is on each boat right now. The feed only names a vessel for a trip it has reached,
  // so a sailing later today has none of its own — but the workbook knows which boat runs it, and
  // that boat is out on the water under a vessel the feed *has* named. Freshest report wins when a
  // boat appears on more than one trip, which happens as it hands over between them.
  const vessels = new Map();
  for (const item of frame.live ? realtime.vehicles || [] : []) {
    if (!item.boat || !item.boatName) continue;
    const seen = vessels.get(item.boat);
    if (!seen || (item.updatedAtEpochSeconds || 0) >= (seen.updatedAtEpochSeconds || 0)) vessels.set(item.boat, item);
  }
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
      // Usually the row's own trip. A home-port run's id is minted by the build and matches nothing
      // live, so it names the revenue trip it follows out instead — the boat going to Pier C is the
      // boat that just got in, and it ties up as late as that trip ran. Crew shuttles carry no such
      // trip and keep their published times.
      const update = departure.scheduleOnly ? null : updates.get(`${departure.liveTripId || departure.tripId}|${departure.stopId}`);
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
      const carriesPassengers = !departure.outOfService && !departure.crewShuttle && !departure.arrival;
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
        arrival: Boolean(departure.arrival),
        departures: []
      };
      group.departures.push({
        ...departure,
        serviceDate,
        delay,
        delta,
        live: frame.live,
        hasLiveTiming,
        boatName: departure.scheduleOnly ? null : vehicles.get(String(departure.tripId))?.boatName || null,
        // Failing a vessel of its own, the one currently working this boat — by way of the trip a
        // home-port row is about to pick up, or simply by the boat the workbook puts on this
        // sailing. A guess either way, and labelled as one: the vessel on a working changes at
        // short notice, which is exactly why the board says "McShane?" rather than "McShane".
        predictedBoatName: departure.scheduleOnly || vehicles.get(String(departure.tripId))?.boatName
          ? null
          : (departure.predictTripId ? vehicles.get(String(departure.predictTripId))?.boatName : null)
            || (Number.isInteger(departure.boatAssignment)
              ? vessels.get(`${departure.routeId}${departure.boatAssignment}`)?.boatName || null
              : null)
      });
      groups.set(key, group);
    }
  }

  const result = [...groups.values()]
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
    // The lookahead window is about what is worth showing someone standing at the dock. Browsing a
    // day is the opposite question — the whole day is the point — so it only bounds the live board.
    .filter((group) => !frame.live || group.departures[0]?.delta <= departureWindowSeconds)
    .map((group) => ({
      ...group,
      departures: group.departures.slice(0, limitPerGroup)
    }))
    .sort(byRoute);
  if (cacheKey) dayCache.set(cacheKey, result);
  return result;
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
  const live = viewFrame(now).live;
  return routeDirectionGroups(now, Infinity)
    .flatMap((group) => group.departures.map((departure) => ({ departure, group })))
    .filter(({ departure }) => !live || departure.delta <= windowSeconds)
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

// The line under the destination. "Uptown" says nothing useful about a boat going home empty,
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
  // A boat with no passengers aboard is never on time and never merely scheduled — it is not in
  // service — so NO PICKUP takes that slot instead. It can still be late, though, and on a
  // home-port run that is the one thing worth saying: an agent watching a boat come in to tie up
  // wants the minute it will actually get here, not the minute it was meant to.
  const noPickup = item.outOfService || item.crewShuttle;
  const delayLabel = hasFreshTiming && delaySeconds >= 60
    ? `<span class="vessel-delay-badge departure-delay-badge" dir="ltr" aria-label="Status: +${Math.max(1, Math.round(delaySeconds / 60))} min">+${Math.max(1, Math.round(delaySeconds / 60))} min</span>`
    : "";
  const onTimeLabel = hasFreshTiming && delaySeconds < 60 && !noPickup
    ? `<span class="on-time-badge" aria-label="Status: On time">ON TIME</span>`
    : "";
  const isLast = item.isLastOfDay || item.isLastGovernorsIsland;
  const lastAria = item.isLastGovernorsIsland && !item.isLastOfDay
    ? "Last South Brooklyn departure serving Governors Island"
    : "Last departure of the day";
  const lastLabel = isLast ? `<strong class="departure-last-badge" aria-label="${lastAria}">LAST</strong>` : "";
  // A boat ending its run here. It is in service and full of passengers — it simply cannot be
  // boarded — so it gets its own pair of badges rather than borrowing NO PICKUP, which says the
  // opposite about the boat, or SCHEDULED, which invites someone to wait for it.
  const arrivalLabel = item.arrival
    ? `<span class="arrival-badge" aria-label="Arriving here, ending its run">ARRIVAL</span><span class="drop-off-only-badge" aria-label="Drop off only: this boat cannot be boarded">DROP OFF ONLY</span>`
    : "";
  const scheduledLabel = !noPickup && !item.arrival && !isLast && !delayLabel && !onTimeLabel
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
    ? `<span class="drop-off-badge${item.endsShift === "unsure" ? " drop-off-unsure" : ""}" aria-label="${item.endsShift === "unsure" ? "Probably this boat's final trip: drop off only, unconfirmed" : "This boat's final trip: drop off only"}">FINAL${item.endsShift === "unsure" ? "?" : ""}</span>`
    : "";
  // Which of the other Manhattan terminals this boat calls at on the way.
  //
  // Only NY Waterway's South Amboy route threads Pier 11, Brookfield Place and Pier 79 together,
  // and it does it in four different orders. Two rows can both read "South Amboy" while only one
  // of them stops at Brookfield Place, so the destination alone cannot answer the question an
  // agent is actually asked: can I get from here to there on this boat. Each terminal gets its own
  // colour so the answer is a glance rather than a read.
  const viaTerminals = (item.viaTerminals || [])
    .map((terminal) => {
      const slug = String(terminal.code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return `<span class="via-terminal-badge via-terminal-${slug}" aria-label="Calls at ${escapeHtml(terminal.name || terminal.code)} on the way">VIA ${escapeHtml(terminal.code)}</span>`;
    })
    .join("");
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
  return { delayLabel, onTimeLabel, scheduledLabel, lastLabel, arrivalLabel, assignment, noPickupLabel, dropOffLabel, crewBoats, viaTerminals };
}
// How far a colour stands off a white card, as the WCAG contrast ratio against it.
function contrastOnWhite(hex) {
  const channel = (pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(hex.slice(1, 3)) +
    0.7152 * channel(hex.slice(3, 5)) +
    0.0722 * channel(hex.slice(5, 7));
  return 1.05 / (luminance + 0.05);
}

// The countdown takes the route's colour so an all-partner board is not a column of ferry blue.
//
// Not every livery survives being used as text on a white card: South Brooklyn's yellow comes out
// at 1.5:1 and is effectively invisible, where the Staten Island Ferry's orange manages 2.4:1 and
// reads. The floor sits between the two on purpose. It is well under the 4.5:1 that body text would
// need — this is a bold, short, repeated label sitting beside its own time, not prose — but it is
// enough to keep a colour that cannot be seen at all from being used. Anything below it keeps the
// board's own accent blue, which is what every countdown used before.
const ACCENT_MIN_CONTRAST = 2;

function accentColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color || "") && contrastOnWhite(color) >= ACCENT_MIN_CONTRAST
    ? color
    : null;
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
      ? ` style="--route-color:${route.color};--route-text:${/^#[0-9A-Fa-f]{6}$/.test(route.textColor || "") ? route.textColor : "#FFFFFF"}${accentColor(route.color) ? `;--route-accent:${route.color}` : ""}"`
      : ""
  };
}

// What makes a row openable, shared by both views so they cannot disagree about which rows are.
//
// Home-port runs open the revenue trip they follow; crew shuttles without a stop list stay inert.
function scheduleForDeparture(item) {
  return data?.tripSchedules?.[item.liveTripId || item.tripId];
}

function tripAttrs(item) {
  const schedule = scheduleForDeparture(item);
  const stops = schedule?.stops;
  if (!Array.isArray(stops) || (stops.length < 2 && !schedule.timetableOnly)) return "";
  const label = `${departureLabel(item)} to ${item.destination || "destination unavailable"} — ${schedule.timetableOnly ? "show published departure details" : "show this trip's stops"}`;
  // role/tabindex rather than a real <button>: these sit inside a CSS grid and a flex column with
  // overflow and route-colour custom properties on them, and a button's own layout rules are not
  // worth the regression for an affordance the delegated listener provides either way.
  return ` data-trip-id="${escapeHtml(String(item.tripId))}" data-stop-id="${escapeHtml(String(item.stopId))}"` +
    ` data-departure-seconds="${Number(item.seconds) || 0}"` +
    ` role="button" tabindex="0" aria-haspopup="dialog" aria-label="${escapeHtml(label)}"`;
}

function sailingKey(item) {
  const serviceDate = addDays(viewFrame().dateKey, -Math.floor(item.seconds / 86400));
  return escapeHtml(JSON.stringify([serviceDate, item.tripId, item.stopId, item.seconds]));
}

// This view's destination is the card's, shared by every slot under it, so the layover cannot sit
// beside it the way the timeline's does. It joins the status line instead, which keeps a turn from
// costing each slot a line of its own in a column that is already the narrowest thing on the board.
function departureCell(item) {
  const { delayLabel, onTimeLabel, scheduledLabel, lastLabel, arrivalLabel, assignment, noPickupLabel, dropOffLabel, crewBoats, viaTerminals } = departureStatus(item);
  return `<div class="departure-slot" data-key="${sailingKey(item)}"${tripAttrs(item)}>
    <div class="slot-time-row"><time>${departureLabel(item)}</time><span class="slot-relative">${escapeHtml(relativeTime(item.delta, item.live !== false))}</span></div>
    <span class="departure-last-slot">${lastLabel}${arrivalLabel}${noPickupLabel}${delayLabel || onTimeLabel || scheduledLabel}${viaTerminals}${dropOffLabel}${assignment}<span class="boat-name">${crewBoats || (item.boatName ? escapeHtml(item.boatName) : predictedName(item))}</span>${departureLayoverLabel(item)}</span>
  </div>`;
}

// Partner operators merged in by scripts/build-data.js namespace their route ids with a prefix.
// Their GTFS short names are useless on a passenger board — NY Waterway publishes internal
// all-digit route ids for most routes, Seastreak reuses "Seastreak" for every route, and NYU
// publishes no short name at all (leaving the bare Passio route number) — so those badges show
// the operator's mark instead. A partner route with a real short name (W44, Greenwich) keeps it,
// and NYC Ferry badges are never touched.
const PARTNER_BADGES = [
  { prefix: "wtr:", src: "/assets/waterway.png", alt: "NY Waterway", useLogo: (shortName) => /^\d+$/.test(shortName) },
  // The Belford route is NY Waterway's, and rides in its own feed only so that a refresh of the
  // downloaded one cannot erase it. It carries no short name, so it always shows the wordmark.
  { prefix: "wbf:", src: "/assets/waterway.png", alt: "NY Waterway", useLogo: () => true },
  { prefix: "sea:", src: "/assets/seastreak.png", alt: "Seastreak", useLogo: () => true },
  { prefix: "nyu:", src: "/assets/nyu.png", alt: "NYU Langone Ferry", useLogo: () => true },
  { prefix: "lib:", src: "/assets/cityferry.png", alt: "Liberty Landing Ferry", useLogo: () => true },
  // The Trust's own short names ("RH", "BBP") would read as NYC Ferry route codes on a board that
  // already carries a South Brooklyn boat to the same island, so the wordmark shows instead.
  { prefix: "gi:", src: "/assets/gi.png", alt: "The Trust for Governors Island", useLogo: () => true }
];

function partnerBadgeLogo(routeId, shortName) {
  const badge = PARTNER_BADGES.find((item) => String(routeId || "").startsWith(item.prefix));
  return badge && badge.useLogo(shortName || "") ? badge : null;
}

// Stepping the board through the schedule.
//
// The whole feature is a filter over data the payload already carries: every landing ships every
// service id together with the calendars and exceptions that say which days each one runs. So a
// different day costs no fetch, no rebuild and not one extra byte — it is the same array read
// through a different date.

function dayLabel(dateKey, today) {
  if (dateKey === today) return "Today";
  if (dateKey === addDays(today, 1)) return "Tomorrow";
  if (dateKey === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${dateKey}T12:00:00Z`));
}

function longDayLabel(dateKey) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${dateKey}T12:00:00Z`));
}

function renderDateBar() {
  const frame = viewFrame();
  const range = scheduleRange();
  const label = dayLabel(frame.dateKey, frame.today);
  elements.dateBar.dataset.state = frame.live ? "today" : "browsing";
  elements.dateCurrent.textContent = label;
  elements.dateCurrent.setAttribute("aria-label", frame.live
    ? `Showing today's schedule, ${longDayLabel(frame.dateKey)}`
    : `Showing ${longDayLabel(frame.dateKey)} — tap to return to today`);
  // Nothing outside the bundled schedule: a step past the last served date would show an empty
  // board that looks like cancelled service rather than like the end of the feed.
  elements.datePrev.disabled = Boolean(range) && addDays(frame.dateKey, -1) < range.first;
  elements.dateNext.disabled = Boolean(range) && addDays(frame.dateKey, 1) > range.last;
  // The screen carries the state too, so a browsed board can be told apart at a glance from the
  // live one it otherwise looks exactly like.
  elements.screen.classList.toggle("browsing-schedule", !frame.live);
}

function stepDate(amount) {
  contentTransition(elements.departures);
  const frame = viewFrame();
  const range = scheduleRange();
  const next = addDays(frame.dateKey, amount);
  if (range && (next < range.first || next > range.last)) return;
  viewDate = next === frame.today ? null : next;
  render();
}

function showToday() {
  contentTransition(elements.departures);
  if (viewDate === null) return;
  viewDate = null;
  render();
}

// An empty live board means the boats have finished; an empty browsed one means that day was never
// going to have any. Saying "concluded for the day" about next Sunday would read as a cancellation.
function emptyBoard() {
  if (data?.meta?.crewScheduleStatus?.status === "unconfirmed" && !hasConfirmedWeekdayCrew() &&
      (data?.meta?.landing?.stopIds || []).includes("home-port")) {
    return `<div class="empty"><div><strong>CREW TIMES UNCONFIRMED</strong><span>Pier C departures will appear when the crew schedule is confirmed.</span></div></div>`;
  }
  const frame = viewFrame();
  return frame.live
    ? `<div class="empty"><div><strong>NO MORE BOATS!</strong><span>NYC Ferry service has concluded for the day.</span></div></div>`
    : `<div class="empty"><div><strong>NO SCHEDULED BOATS</strong><span>Nothing is scheduled here on ${escapeHtml(longDayLabel(frame.dateKey))}.</span></div></div>`;
}

// Pier C is the home port, and no row on it is a departure time. The operator does not publish when
// a boat lets go of the pier — it varies with the captain — so every row carries the boat's first
// pickup instead and is starred for it. The star has always had a tooltip, which is no use at all on
// a phone, so the board now says what it means once, in a line of its own above the list.
const HOME_PORT_NOTE =
  "*actual departure times at discretion of the captain, listed time is the first pickup time";

function hasConfirmedWeekdayCrew() {
  const coverage = data?.meta?.crewScheduleStatus?.confirmedWeekdays;
  const date = viewFrame().dateKey;
  return Boolean(coverage && date >= coverage.startDate && date <= coverage.endDate &&
    !coverage.excludedDates.includes(date) && ![0,6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()));
}

// The home port is the one landing with no real stop behind it; it is keyed off the stop id the
// build already puts in the payload rather than off landing 27, so renumbering the landings cannot
// silently take the note away.
function renderBoardNote() {
  const homePort = (data?.meta?.landing?.stopIds || []).includes("home-port");
  const crew = data?.meta?.crewScheduleStatus;
  const holiday = data?.meta?.holidaySchedule;
  const notes = [];
  if (hasConfirmedWeekdayCrew()) {
    notes.push(crew.confirmedWeekdays.message);
    if (homePort) notes.push(HOME_PORT_NOTE);
  } else if (crew?.status === "unconfirmed") notes.push(crew.message);
  else if (homePort) notes.push(HOME_PORT_NOTE);
  if (holiday?.dates.includes(viewFrame().dateKey)) notes.push(holiday.message);
  elements.boardNote.hidden = notes.length === 0;
  elements.boardNote.textContent = notes.join(" · ");
}

let renderFrame = null;
function render() {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; renderNow(); });
}
function renderNow() {
  if (!data) return;
  const oldOperations = new Map([...elements.departures.querySelectorAll("[data-key]")].map(node => [node.dataset.key, operationalText(node)]));
  applyDisplayCounts();
  renderDateBar();
  renderBoardNote();
  sortedBy() === "route" ? renderRouteBoard() : renderTimeline();
  let changes = 0;
  for (const node of elements.departures.querySelectorAll("[data-key]")) {
    const previous = oldOperations.get(node.dataset.key);
    if (previous !== undefined && previous !== operationalText(node)) { contentTransition(node); changes++; }
  }
  if (changes) document.querySelector("#boardAnnouncement").textContent = `Vessel or service status updated at ${elements.time.textContent}.`;
}

// An empty board caused by the filter is not a schedule fact, and must never be read as one.
function operationalText(node) {
  return [...node.querySelectorAll(".vessel-delay-badge, .tl-boat, .boat-name, .boat-assignment, .no-pickup-badge, .drop-off-badge")].map(item => item.textContent).join("|");
}

function emptyFilterBoard() {
  return `<div class="empty"><div><strong>EVERYTHING IS HIDDEN</strong><span>All operators are filtered out. Tap the filter button to show them again.</span></div></div>`;
}

// Scoped to this landing on purpose, where the panel's list is global: the question here is not
// "has everything been hidden" but "is this board empty because of the filter", and a landing that
// only NYC Ferry calls at goes blank the moment NYC Ferry is hidden — however many partners are
// still shown elsewhere.
function allOperatorsHidden() {
  const hidden = hiddenOperators();
  const here = new Set(Object.keys(data?.routes || {}).map(operatorOf));
  return here.size > 0 && [...here].every((name) => hidden.has(name));
}

function renderTimeline() {
  const rows = timelineDepartures().filter(({ group }) => isVisibleRoute(group.routeId));
  elements.departures.dataset.view = "timeline";
  // The column head describes the route board's three columns; a timeline row is not columnar,
  // and the phone stylesheet hides it anyway.
  elements.columnHead.hidden = true;
  elements.routeCount.textContent = `${rows.length} departure${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    reconcileHTML(elements.departures, allOperatorsHidden() ? emptyFilterBoard() : emptyBoard());
    return;
  }

  reconcileHTML(elements.departures, rows.map(({ departure, group }) => {
    const visual = routeVisual(group.routeId, group.variant);
    const { delayLabel, onTimeLabel, scheduledLabel, lastLabel, arrivalLabel, assignment, noPickupLabel, dropOffLabel, crewBoats, viaTerminals } =
      departureStatus(departure);
    const variantBadge = group.variant ? `<small class="route-variant">${escapeHtml(visual.variantLabel)}</small>` : "";
    // The route board has carried this class all along; the timeline needs it too, because the
    // width a badge needs depends on which variant it is naming.
    const variantClass = group.variant ? ` variant-${group.variant.toLowerCase()}` : "";
    // "Uptown" says nothing about a boat going home empty, so the context line says what the
    // move is instead — the same words the route board puts under the destination.
    const context = group.crewShuttle || group.outOfService
      ? groupContext(group, visual.isOtherOperator)
      : (visual.isOtherOperator ? visual.route.operator : directionLabel(group.directionId));
    // The vessel is only known once a live vehicle is matched to the trip, so partner operators and
    // not-yet-assigned sailings simply omit the line rather than showing a placeholder. A crew
    // shuttle names the boats it relieves in the same place.
    //
    // A home-port row names no trip of its own — its id is minted here, not in the feed — so no
    // vehicle will ever match it and boatName is always empty. The vessel to show is the one
    // currently working the trip the boat is about to pick up, which is what predictTripId is for.
    // The route board has always fallen back to it; this view had not, so every Pier C row lost
    // its boat when the board was sorted by departure time.
    const boat = crewBoats
      ? `<span class="tl-boat">${crewBoats}</span>`
      : departure.boatName ? `<span class="tl-boat">${escapeHtml(departure.boatName)}</span>`
      : departure.predictedBoatName ? `<span class="tl-boat">${predictedName(departure)}</span>`
      : "";
    // Three lines, each reading left-to-right: when and which boat, then where, then who and how.
    // Time and route anchor the left edge; the countdown and the status badges are pushed to the
    // right, so both columns can be scanned straight down the list without the eye wandering.
    // The destination owns the middle line because it is the longest thing on the row and the one
    // that reads worst truncated. The turn the boat makes when it gets there rides along at the end
    // of that line: it is short, it never truncates, and it is the destination it belongs to.
    const notInService = group.outOfService || group.crewShuttle ? " timeline-row-oos" : "";
    return `<article data-key="${sailingKey(departure)}" class="departure timeline-row route-${visual.routeClass}${variantClass}${notInService}"${visual.style}${tripAttrs(departure)}>
      <div class="tl-head">
        <time>${departureLabel(departure)}</time>
        <span class="route-badge${visual.partnerLogo ? " route-badge-image" : ""}">${visual.badgeContent}${variantBadge}</span>
        <span class="tl-relative">${escapeHtml(relativeTime(departure.delta, departure.live !== false))}</span>
      </div>
      <strong class="tl-dest"><span class="tl-dest-name">${escapeHtml(group.destination)}${group.via?.length ? `<span class="tl-via"> via ${escapeHtml(group.via.map(shortStop).join(", "))}</span>` : ""}</span>${departureLayoverLabel(departure)}</strong>
      <div class="tl-meta">
        <span class="tl-context">${escapeHtml(context)}</span>
        ${boat}
        <span class="tl-status">${lastLabel}${arrivalLabel}${noPickupLabel}${delayLabel || onTimeLabel || scheduledLabel}${viaTerminals}${dropOffLabel}${assignment}</span>
      </div>
    </article>`;
  }).join(""));
}

function renderRouteBoard() {
  const departuresShown = displayCount("departuresShown");
  const groups = routeDirectionGroups().filter((group) => isVisibleRoute(group.routeId));
  elements.departures.dataset.view = "routes";
  elements.columnHead.hidden = false;
  // Staff view: no slideshow paging. Every route direction stays on screen and
  // the row grid squishes to fit, so an agent never waits for the answer to rotate in.
  elements.routeCount.textContent = `${groups.length} route direction${groups.length === 1 ? "" : "s"}`;

  if (!groups.length) {
    reconcileHTML(elements.departures, allOperatorsHidden() ? emptyFilterBoard() : emptyBoard());
    return;
  }

  reconcileHTML(elements.departures, groups.map((group) => {
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
    return `<article data-key="${escapeHtml(group.key)}" class="departure route-${routeClass}${variantClass}"${routeStyle}>
      <div class="route">
        <span class="route-badge${partnerLogo ? " route-badge-image" : ""}">${badgeContent}${variantBadge}</span>
        <span class="route-name">${escapeHtml(routeName)}${operatorBadge}</span>
      </div>
      <div class="destination"><strong>${escapeHtml(group.destination)}${viaLabel(group)}</strong><span>${groupContext(group, isOtherOperator)}</span></div>
      <div class="departure-slots">${slots.map((item) => item ? departureCell(item) : `<div class="departure-slot unavailable"><span>No scheduled trip</span></div>`).join("")}</div>
    </article>`;
  }).join(""));
}

function ageLabel(timestamp) {
  const ageMs = timestamp ? Date.now() - Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  return `${Math.floor(ageMs / 3_600_000)} hr ago`;
}

function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function renderManualOverride() {
  const active = Boolean(manualOverride?.active && manualOverride.message);
  elements.screen.classList.toggle("override-active", active);
  elements.manualOverride.hidden = !active;
  setText(elements.manualOverrideMessage, active ? manualOverride.message : "");
  const length = manualOverride?.message?.length || 0;
  elements.manualOverrideBox.dataset.size = length > 700 ? "long" : length > 280 ? "medium" : "short";

  const updatedAt = Date.parse(manualOverride?.updatedAt);
  setText(elements.manualOverrideUpdated, active && Number.isFinite(updatedAt)
    ? `Updated ${new Intl.DateTimeFormat("en-US", {
      timeZone: data?.meta?.timezone || "America/New_York",
      month: "long", day: "numeric", ...hourOptions(), minute: "2-digit"
    }).format(new Date(updatedAt))}`
    : "");

  if (data) {
    document.title = active
      ? `${data.meta.landing.displayName} Service Notice`
      : `${data.meta.landing.displayName} Departures`;
  }
}

async function loadManualOverride() {
  const landingId = data?.meta?.landingNumber ?? requestedLanding;
  if (!landingId) return;
  const generation = landingRequest;
  try {
    const response = await request(`/api/override?landingId=${encodeURIComponent(landingId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (generation !== landingRequest) return;
    manualOverride = payload;
    renderManualOverride();
  } catch {
    // Preserve the last known state if the local server is temporarily unreachable.
  }
}

// One alert, in full. The bar above can only ever carry the first one, clipped to two lines; this
// is where the other nine live, and where the whole of any of them can actually be read.
// When a planned closure actually bites. Read off the window rather than the server's activeNow
// flag: alerts are cached for a minute and can be served from the last disk snapshot after a
// restart, so a stored "happening now" can outlive the closure it described. The times cannot.
function alertWindowLabel(window) {
  const start = window?.start ? new Date(window.start) : null;
  const end = window?.end ? new Date(window.end) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) return "";
  if (!start && !end) return "";
  const timeZone = data?.meta?.timezone || "America/New_York";
  const dayOf = (date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const timeOf = (date) => new Intl.DateTimeFormat("en-US", { timeZone, ...hourOptions(), minute: "2-digit" }).format(date);
  const dateOf = (date) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date);
  // A time on another day needs its date said out loud; one later the same day does not.
  const stamp = (date, reference) => dayOf(date) === dayOf(reference) ? timeOf(date) : `${dateOf(date)}, ${timeOf(date)}`;
  const now = new Date();
  if ((!start || start <= now) && (!end || end >= now)) {
    return end ? `Now until ${stamp(end, now)}` : "Happening now";
  }
  if (!start) return "";
  const opening = `${dateOf(start)}, ${timeOf(start)}`;
  return end ? `${opening} – ${stamp(end, start)}` : `From ${opening}`;
}

function alertRow(alert) {
  const header = alert.header || "NYC Ferry service alert";
  // The bar joins these two with an em dash to make one line. Here there is room to keep them
  // apart, and a description that merely repeats the header is not worth a second paragraph.
  const description = alert.description && alert.description !== alert.header ? alert.description : "";
  // "Unknown effect" and "Unknown cause" are what GTFS says when the publisher left the field at its
  // default, which is most of the time. They are the feed admitting it has nothing to add, and a
  // chip saying so is worse than no chip: it takes the eye and pays nothing back.
  // "Planned" leads the chips because it is the first thing a reader wants settled: scheduled work
  // to plan around, or something that has just gone wrong. It is also what the ordering sorts on,
  // and an order nobody can see the reason for reads as no order at all.
  const chips = [alert.planned ? "Planned" : null, alert.effect, alert.cause]
    .filter((chip) => chip && !/^unknown/i.test(chip))
    .map((chip) => `<span class="alert-chip">${escapeHtml(chip)}</span>`)
    .join("");
  const when = alertWindowLabel(alert.window);
  // Only http(s). An alert is third-party text, and a javascript: URL rendered as a link on a board
  // an agent taps at is not a risk worth taking for a convenience.
  const link = /^https?:\/\//i.test(alert.url || "")
    ? `<a class="alert-link" href="${escapeHtml(alert.url)}" target="_blank" rel="noopener noreferrer">Read the full notice</a>`
    : "";
  return `<li class="alert-item">
    <strong class="alert-item-header">${escapeHtml(header)}</strong>
    ${when ? `<span class="alert-when">${escapeHtml(when)}</span>` : ""}
    ${chips ? `<span class="alert-chips">${chips}</span>` : ""}
    ${description ? `<p class="alert-item-body">${escapeHtml(description)}</p>` : ""}
    ${link}
  </li>`;
}

// Grouped by whose service it is, in the order the server sent them — which puts NYC Ferry first.
// A rider needs to know at a glance whether they are reading about their boat or about the train
// they were going to catch afterwards, and a heading says that faster than reading the alert does.
function renderAlertMenu() {
  const alerts = serviceAlerts?.alerts || [];
  if (!alerts.length) {
    elements.alertList.innerHTML = `<li class="alert-empty">No active NYC Ferry service alerts.</li>`;
    return;
  }
  const groups = [];
  for (const alert of alerts) {
    const agency = alert.agency || "NYC Ferry";
    const group = groups.find((entry) => entry.agency === agency);
    if (group) group.alerts.push(alert);
    else groups.push({ agency, alerts: [alert] });
  }
  elements.alertList.innerHTML = groups.map((group) => `
    <li class="alert-group">
      <h2 class="alert-group-name">${escapeHtml(group.agency)}<span>${group.alerts.length}</span></h2>
      <ul class="alert-group-list">${group.alerts.map(alertRow).join("")}</ul>
    </li>`).join("");
}

// Connections are cached by the service worker with no expiry, so a response fetched hours ago
// comes back offline looking exactly like a fresh one. Times that old are worse than no times.
const TRIP_CONNECTIONS_MAX_AGE_MS = 5 * 60 * 1000;

// A call's own clock time. tripSchedules carries seconds; adjustedTime speaks GTFS "HH:MM:SS", and
// going through it keeps the 12/24-hour toggle working here too.
function stopClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return adjustedTime(`${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:00`, 0);
}

function layoverMinutes(seconds) {
  return Math.round(Number(seconds) / 60);
}

// The final-stop pause before this same working leaves again. Scheduled metadata is bundled with
// the trip so it works offline and on browsed days; today's connection response may enrich it with
// the live time left after delays on either side of the turn.
function turnaroundLabel(stop) {
  const isFinal = stop.sequence === tripView?.stops?.at(-1)?.sequence;
  const local = isFinal && tripView?.scheduleTurnaround?.stopId === stop.stopId
    ? { scheduledSeconds: tripView.scheduleTurnaround.scheduledLayoverSeconds, hasLiveTiming: false }
    : null;
  const turnaround = tripView?.timings?.get(stop.sequence)?.turnaround || local;
  return layoverLabel(turnaround, "trip-stop-layover");
}

function layoverLabel(turnaround, className, prefix = "") {
  const scheduled = Number(turnaround?.scheduledSeconds);
  if (!Number.isFinite(scheduled)) return "";
  const scheduledMinutes = layoverMinutes(scheduled);
  const estimated = Number(turnaround?.estimatedSeconds);
  if (turnaround.hasLiveTiming && Number.isFinite(estimated)) {
    const estimatedMinutes = layoverMinutes(estimated);
    return `<small class="${className}" aria-label="Scheduled layover ${scheduledMinutes} minutes, currently ${estimatedMinutes} minutes">${escapeHtml(prefix)}${scheduledMinutes} → ${estimatedMinutes} min</small>`;
  }
  return `<small class="${className}" aria-label="Scheduled layover ${scheduledMinutes} minutes">${escapeHtml(prefix)}scheduled ${scheduledMinutes} min</small>`;
}

// Read the terminal's timing, not this landing's delay: a boat can recover time along the route.
//
// The pier goes unnamed because a turn is always taken at the trip's last stop, which is the
// destination the label now sits beside — naming it again cost a line and said the same thing twice.
function departureLayoverLabel(item) {
  if (item.outOfService || item.crewShuttle || item.endsShift) return "";
  const schedule = scheduleForDeparture(item);
  const stop = schedule?.stops?.find((stop) => String(stop.stopId) === String(item.stopId));
  const dwellSeconds = stop?.arrivalSeconds != null && stop?.departureSeconds != null
    ? Number(stop.departureSeconds) - Number(stop.arrivalSeconds) : NaN;
  const dwellMinutes = Number.isFinite(dwellSeconds) && dwellSeconds >= 0
    ? layoverMinutes(dwellSeconds) : null;
  const dwellText = dwellMinutes == null ? "" : `Dwell ${dwellMinutes}m`;
  const dwellAria = dwellMinutes == null ? "" : `Estimated dwell ${dwellMinutes} minutes`;
  const dwellOnly = dwellText
    ? `<small class="departure-layover" aria-label="${dwellAria}">${dwellText}</small>` : "";
  const turn = schedule?.turnaround;
  if (!turn) return dwellOnly;
  const live = item.live !== false && !realtime.stale;
  const updates = live ? realtime.updates || [] : [];
  const arrival = updates.find((update) => String(update.tripId) === String(item.tripId) && update.stopId === turn.stopId);
  const next = updates.find((update) => String(update.tripId) === String(turn.nextTripId) && update.stopId === turn.stopId);
  const fresh = (update) => update?.delaySeconds != null && Number.isFinite(Number(update.delaySeconds));
  const hasLiveTiming = !arrival?.canceled && !next?.canceled && (fresh(arrival) || fresh(next));
  const delay = (update) => fresh(update) ? Math.max(0, Number(update.delaySeconds)) : 0;
  const seconds = hasLiveTiming
    ? turn.scheduledLayoverSeconds - delay(arrival) + delay(next)
    : turn.scheduledLayoverSeconds;
  if (seconds == null || !Number.isFinite(Number(seconds))) return dwellOnly;
  const minutes = layoverMinutes(seconds);
  return `<small class="departure-layover" aria-label="${dwellAria ? `${dwellAria}, ` : ""}${hasLiveTiming ? "Estimated" : "Scheduled"} layover ${minutes} minutes">${dwellText ? `${dwellText} ` : ""}Layover ${minutes}m</small>`;
}

function tripStopName(stopId) {
  return data?.stops?.[stopId]?.name || tripView?.names?.get(stopId) || stopId;
}

function tripStopLanding(stopId) {
  const local = data?.stops?.[stopId];
  if (local) return local.landingId ?? null;
  return tripView?.landings?.get(stopId) ?? null;
}

function connectionRow(connection) {
  const style = /^#[0-9A-Fa-f]{6}$/.test(connection.color || "")
    ? ` style="--route-color:${connection.color};--route-text:${/^#[0-9A-Fa-f]{6}$/.test(connection.textColor || "") ? connection.textColor : "#FFFFFF"}"`
    : "";
  const delay = Number(connection.delaySeconds);
  const delayLabel = connection.hasLiveTiming && Number.isFinite(delay) && delay >= 60
    ? `<span class="trip-conn-delay">+${Math.max(1, Math.round(delay / 60))} min</span>`
    : "";
  // Direction is rendered through the board's own vocabulary rather than the server's, so
  // "Uptown" is decided in exactly one place.
  const where = [directionLabel(connection.directionId), connection.destination]
    .filter((part) => part && part !== "Direction unavailable").join(" · ");
  // Same rule as the departure rows: a partner whose GTFS short name is useless to a rider shows
  // the operator's mark instead. Belford is the case that forced it — NY Waterway publishes the
  // route with an empty route_short_name, so the fallback to route_id put a lowercase "belford"
  // on the board where every other row carries a wordmark.
  const connLogo = partnerBadgeLogo(connection.routeId, connection.shortName);
  const connBadge = connLogo
    ? `<img class="trip-conn-badge-logo" src="${connLogo.src}" alt="${escapeHtml(connLogo.alt)}">`
    : escapeHtml(connection.shortName || connection.routeId);
  return `<li class="trip-conn"${style}>
    <span class="trip-conn-badge${connLogo ? " trip-conn-badge-image" : ""}">${connBadge}</span>
    <span class="trip-conn-time">${escapeHtml(adjustedTime(connection.departureTime, 0))}</span>
    <span class="trip-conn-where">${escapeHtml(where)}</span>
    ${delayLabel}
    <span class="trip-conn-boat">${connection.boatName
      ? escapeHtml(connection.boatName)
      : connection.predictedBoatName
        ? `<em class="boat-name-predicted" title="Currently on this working; boats change at short notice">${escapeHtml(connection.predictedBoatName)}?</em>`
        : ""}</span>
  </li>`;
}

// One stop's connections, or the reason there are none. The distinction matters: a stop emptied by
// the operator filter must never read as a stop with no boats left, which is the same principle the
// board's own empty state follows.
function connectionsFor(stop) {
  if (!tripView?.connections) return `<li class="trip-conn-note">${escapeHtml(tripView?.note || "Checking…")}</li>`;
  const all = tripView.connections.get(stop.stopId) || [];
  const visible = all.filter((connection) => !connection.operator || !hiddenOperators().has(connection.operator));
  // The server says how many this pier is worth showing — more at a hub, where several routes meet
  // and there is an actual choice to read.
  if (visible.length) return visible.slice(0, tripView.limits?.get(stop.stopId) || 3).map(connectionRow).join("");
  if (all.length) return `<li class="trip-conn-note">Hidden by the operator filter</li>`;
  if (tripStopLanding(stop.stopId) === null) return `<li class="trip-conn-note">Not served by this board</li>`;
  return `<li class="trip-conn-note">Nothing else leaves after this boat gets in</li>`;
}

// Which vessel is working a trip, for the link out to the map.
//
// The same two answers the row itself gives, in the same order. A vehicle matched to this very trip
// names it outright. Failing that, the boat the workbook puts on this sailing is out on the water
// now under some vessel the feed has named — freshest report wins, which is how a boat handing over
// between two trips resolves to the one that reported last.
function vesselForTrip(tripId) {
  const vehicles = realtime.vehicles || [];
  const departure = (data?.departures || []).find((item) => String(item.tripId) === String(tripId));
  if (departure?.scheduleOnly) return null;
  const working = vehicles.find((item) => String(item.tripId) === String(departure?.liveTripId || tripId) && item.boatName);
  if (working) return { name: working.boatName, predicted: false };
  if (!Number.isInteger(departure?.boatAssignment)) return null;
  const boat = `${departure.routeId}${departure.boatAssignment}`;
  const onTheBoat = vehicles
    .filter((item) => item.boat === boat && item.boatName)
    .sort((left, right) => (right.updatedAtEpochSeconds || 0) - (left.updatedAtEpochSeconds || 0))[0];
  return onTheBoat ? { name: onTheBoat.boatName, predicted: true } : null;
}

// The link out to the map, when there is a boat to point it at.
//
// By vessel name rather than trip id, because the predicted case is a vessel working a different
// trip entirely and this trip's id would find nothing on the map. Hidden rather than disabled when
// no vessel is known: a sailing the feed has not reached has nothing to show, and the heading's own
// map button is a tap away for anyone who wants the whole harbor.
function renderTripMapLink() {
  const vessel = tripView && viewFrame(new Date()).live ? vesselForTrip(tripView.tripId) : null;
  elements.tripMapLink.hidden = !vessel;
  if (!vessel) return;
  elements.tripMapLink.href = `map?boat=${encodeURIComponent(vessel.name)}`;
  elements.tripMapLabel.textContent = `See ${vessel.name}${vessel.predicted ? "?" : ""} on the map`;
  elements.tripMapLink.setAttribute("aria-label", vessel.predicted
    ? `See ${vessel.name} on the map — currently on this working, boats change at short notice`
    : `See ${vessel.name} on the map`);
}

function renderTripView() {
  if (!tripView) return;
  const stops = tripView.stops;
  elements.tripSummary.textContent = tripView.summary;
  renderTripMapLink();
  reconcileHTML(elements.tripStops, stops.map((stop) => {
    // Keyed on sequence, not stop id: a loop trip calls at the same pier twice and dimming by id
    // would grey out the wrong half of it.
    const past = stop.sequence < tripView.sequence;
    const current = stop.sequence === tripView.sequence;
    const landingId = tripStopLanding(stop.stopId);
    const timing = tripView.timings?.get(stop.sequence);
    const scheduledTime = stop.arrivalSeconds ?? stop.departureSeconds;
    const time = timing?.estimatedArrivalSeconds != null && Number.isFinite(Number(timing.estimatedArrivalSeconds))
      ? Number(timing.estimatedArrivalSeconds)
      : scheduledTime;
    const layover = turnaroundLabel(stop);
    const head = `<span>${escapeHtml(tripStopName(stop.stopId))}</span>` +
      `${current ? `<span class="trip-stop-you">You are here</span>` : ""}` +
      `<span class="trip-stop-timing"><span class="trip-stop-time">${time == null ? "" : escapeHtml(stopClock(time))}</span>${layover}</span>`;
    const headTag = landingId === null
      ? `<div class="trip-stop-head trip-stop-static">${head}</div>`
      : `<button type="button" class="trip-stop-head" data-landing-id="${landingId}">${head}</button>`;
    return `<li class="trip-stop${past ? " is-past" : ""}${current ? " is-current" : ""}">
      ${headTag}
      <ul class="trip-conns">${connectionsFor(stop)}</ul>
    </li>`;
  }).join(""));
}

async function loadTripConnections(tripId) {
  const token = tripRequest;
  try {
    const response = await request(`/api/connections?tripId=${encodeURIComponent(tripId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Connections responded ${response.status}`);
    const payload = await response.json();
    if (token !== tripRequest || !tripView) return;
    const age = Date.now() - Date.parse(payload.generatedAt || "");
    if (Number.isFinite(age) && age > TRIP_CONNECTIONS_MAX_AGE_MS) {
      tripView.note = "Saved connections were too old to show. These are the trip's stops.";
      renderTripView();
      return;
    }
    tripView.connections = new Map((payload.stops || []).map((stop) => [stop.stopId, stop.connections || []]));
    tripView.limits = new Map((payload.stops || []).map((stop) => [stop.stopId, stop.limit || 3]));
    tripView.timings = new Map((payload.stops || []).map((stop) => [stop.sequence, {
      estimatedArrivalSeconds: stop.estimatedArrivalSeconds,
      turnaround: stop.turnaround || null
    }]));
    // Names and landings for a device whose cached payload predates data.stops.
    for (const stop of payload.stops || []) {
      if (stop.name) tripView.names.set(stop.stopId, stop.name);
      tripView.landings.set(stop.stopId, stop.landingId ?? null);
    }
    tripView.summary = tripView.summary.replace(/ · Saved$/, "") + (payload.stale ? " · Saved" : "");
    renderTripView();
  } catch {
    if (token !== tripRequest || !tripView) return;
    tripView.note = navigator.onLine === false
      ? "No connection. Showing this trip's stops only."
      : "Connections could not be loaded. These are the trip's stops.";
    renderTripView();
  }
}

function openTripView(tripId, stopId, seconds) {
  const departure = data?.departures?.find((item) => item.tripId === tripId);
  const sourceTripId = departure?.liveTripId || tripId;
  const schedule = data?.tripSchedules?.[sourceTripId];
  if (!schedule?.stops?.length || (schedule.stops.length < 2 && !schedule.timetableOnly)) return;
  const stops = [...schedule.stops].sort((left, right) => left.sequence - right.sequence);
  // Which call was tapped. Time as well as id, because a loop trip calls at the same pier twice.
  const tapped = departure?.outOfService && departure.liveTripId ? stops.at(-1) : stops.find((stop) => stop.stopId === stopId &&
    (stop.departureSeconds === seconds || stop.arrivalSeconds === seconds)) ||
    stops.find((stop) => stop.stopId === stopId);
  const route = data?.routes?.[data?.departures?.find((item) => item.tripId === tripId)?.routeId] || {};
  const destination = tripStopName(stops.at(-1).stopId);
  tripRequest += 1;
  tripView = {
    tripId, sourceTripId, stopId, sequence: tapped?.sequence ?? stops[0].sequence, stops,
    connections: null, note: "Checking…",
    scheduleTurnaround: schedule.turnaround || null, timings: new Map(),
    names: new Map(), landings: new Map(),
    // Says out loud what the times underneath are measured from. Read as "what is leaving now"
    // they would be wrong at every stop the boat has not reached yet.
    summary: departure?.outOfService && departure.liveTripId
      ? `${route.shortName || ""} to ${departure.destination} · Out of service · Previous stops before ${tripStopName(stopId)}`.trim()
      : `${route.shortName || ""} ${destination ? `to ${destination}` : ""} · ${stops.length} stops · next boats after each call`.trim()
  };
  if (schedule.timetableOnly) {
    tripView.summary = `${route.shortName || ""} to ${departure.destination} · Published departure`;
    tripView.note = "Published holiday departure time only. Trip connections and arrival estimates are unavailable.";
    renderTripView();
    setTripOpen(true);
    return;
  }
  renderTripView();
  setTripOpen(true);
  // The endpoint answers for now. On a browsed day that answer would be about the wrong date, and a
  // confidently wrong connection is worse than none, so the stop list stands on its own.
  if (!viewFrame(new Date()).live) {
    tripView.note = "Connections are shown for today only.";
    renderTripView();
    return;
  }
  loadTripConnections(sourceTripId);
}

function refreshTripConnections() {
  if (!tripView || elements.tripMenu.hidden || !viewFrame(new Date()).live) return;
  loadTripConnections(tripView.sourceTripId || tripView.tripId);
}

function setTripOpen(open) {
  panel(elements.tripMenu, open);
  if (open) {
    elements.tripMenuClose.focus();
    return;
  }
  // Unlike every other sheet the opener is not a fixed button — render() replaces the row that
  // opened this within fifteen seconds — so focus goes back to the row only if it is still there.
  const row = tripView && elements.departures.querySelector(
    `[data-trip-id="${CSS.escape(String(tripView.tripId))}"][data-stop-id="${CSS.escape(String(tripView.stopId))}"]`);
  tripView = null;
  tripRequest += 1;
  row?.focus();
}

function setAlertMenuOpen(open) {
  // Nothing to expand into. The bar is disabled in that state, so this only guards the keyboard.
  if (open && !(serviceAlerts?.alerts || []).length) return;
  if (open) renderAlertMenu();
  panel(elements.alertMenu, open);
  elements.serviceAlerts.setAttribute("aria-expanded", String(open));
  if (open) elements.alertMenuClose?.focus();
  else elements.serviceAlerts.focus();
}

function renderServiceAlerts() {
  const alerts = serviceAlerts?.alerts || [];
  const unavailable = Boolean(serviceAlerts && !serviceAlerts.available && alerts.length === 0);
  const stale = Boolean(serviceAlerts?.stale);
  elements.serviceAlerts.classList.toggle("loading", !serviceAlerts);
  elements.serviceAlerts.classList.toggle("active", alerts.length > 0);
  elements.serviceAlerts.classList.toggle("stale", stale && !unavailable);
  elements.serviceAlerts.classList.toggle("unavailable", unavailable);

  // Only a bar with something behind it is worth tapping, and it should look like it.
  const expandable = alerts.length > 0;
  elements.serviceAlerts.disabled = !expandable;
  elements.serviceAlertChevron.hidden = !expandable;
  if (!elements.alertMenu.hidden) {
    // The feed reloads every minute underneath an open sheet. Keep it in step, and close it if the
    // last alert cleared — but without touching focus, because nobody asked for it to move and this
    // is a background refresh, not something they just did.
    if (expandable) renderAlertMenu();
    else {
      panel(elements.alertMenu, false);
      elements.serviceAlerts.setAttribute("aria-expanded", "false");
    }
  }

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
  // The bar is a ferry bar, and the server puts ferry alerts first, so the only way something else
  // leads is that the ferry has nothing wrong with it. Say whose service it is in that case: an
  // unlabelled subway closure sitting under the words SERVICE ALERTS on a ferry board reads as a
  // boat problem, which is exactly the wrong thing to tell someone waiting for one.
  const agency = first.agency && first.agency !== "NYC Ferry" ? `${first.agency}: ` : "";
  elements.serviceAlertSummary.textContent = alerts.length > 1
    ? `${agency}${detail} · ${alerts.length - 1} more active`
    : `${agency}${detail}`;
  elements.serviceAlertFreshness.textContent = `${stale ? "Saved alert" : "Updated"} ${ageLabel(serviceAlerts.feedTimestamp || serviceAlerts.fetchedAt)}`;
  elements.serviceAlertCount.textContent = String(alerts.length);
  elements.serviceAlertCount.hidden = false;
}

async function loadServiceAlerts() {
  try {
    const response = await request("/api/alerts", { cache: "no-store" });
    if (!response.ok) throw new Error();
    serviceAlerts = await response.json();
    storage.setItem(`${cacheKey}-alerts`, JSON.stringify(serviceAlerts));
  } catch {
    const saved = storage.getItem(`${cacheKey}-alerts`);
    serviceAlerts = saved
      ? { ...storage.json(`${cacheKey}-alerts`, {}), stale: true }
      : { available: false, stale: true, fetchedAt: null, alerts: [] };
  }
  renderServiceAlerts();
}

function updateClock() {
  const now = new Date();
  const timeZone = data?.meta?.timezone || "America/New_York";
  elements.time.textContent = new Intl.DateTimeFormat("en-US", { timeZone, ...hourOptions(), minute: "2-digit" }).format(now);
  elements.date.textContent = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
}

let realtimeRequest = 0;
async function loadRealtime() {
  if (!data) return;
  const landingId = data.meta.landingNumber;
  const generation = landingRequest;
  const token = ++realtimeRequest;
  const key = `${cacheKey}-realtime-${landingId}`;
  try {
    const response = await request(`/api/realtime?landingId=${encodeURIComponent(landingId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (generation !== landingRequest || token !== realtimeRequest) return;
    // A snapshot the service worker served is saved data too, just saved a layer further out.
    realtime = { ...payload, cached: Boolean(payload.stale) };
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    if (generation !== landingRequest || token !== realtimeRequest) return;
    const saved = storage.json(key);
    realtime = saved
      ? { ...saved, stale: true, cached: true }
      : { updates: [], vehicles: [], available: false, stale: true, cached: false };
  }
  reconcileHTML(elements.status, `<i></i><span>${
    scheduleSaved ? "Saved schedule" : !realtime.stale ? "Live" : realtime.cached ? "Saved" : "Local schedule"
  }</span>`);
  render();
  refreshTripConnections();
}

// A map link selects the initial board once; subsequent menu choices still work normally.
let linkedLanding = Number(new URLSearchParams(location.search).get("landing"));
function selectedLanding() {
  if (Number.isInteger(linkedLanding) && linkedLanding > 0) {
    const requested = linkedLanding;
    linkedLanding = null;
    return requested;
  }
  const value = Number(storage.getItem(landingKey));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function landingDataKey(landingNumber) {
  return `${cacheKey}-landing-${landingNumber}`;
}

let landingRequest = 0;
let requestedLanding = null;
let scheduleSaved = false;
function validSchedule(value, selected) {
  return value?.meta?.landing?.displayName && value.routes && Array.isArray(value.calendars) && Array.isArray(value.departures)
    && (selected === null || value.meta.landingNumber === selected);
}
function applySchedule(payload) {
  data = payload;
  resetSchedule();
  elements.landing.textContent = data.meta.landing.displayName;
  renderLandingList();
  renderFilterMenu();
  renderNearest();
  updateClock();
  render();
}
async function load(selected = selectedLanding()) {
  const token = ++landingRequest;
  const changed = selected !== requestedLanding;
  requestedLanding = selected;
  if (changed) {
    viewDate = null;
    setTripOpen(false);
    manualOverride = { active: false };
    renderManualOverride();
    const savedRealtime = storage.json(`${cacheKey}-realtime-${selected}`);
    realtime = savedRealtime
      ? { ...savedRealtime, stale: true, cached: true }
      : { updates: [], vehicles: [], available: false, stale: true, cached: false };
    data = null;
    void loadManualOverride();
  }
  const saved = storage.json(landingDataKey(selected));
  if (validSchedule(saved, selected)) {
    scheduleSaved = true;
    applySchedule(saved);
    reconcileHTML(elements.status, '<i></i><span>Saved · refreshing</span>');
  } else if (!data) {
    reconcileHTML(elements.departures, '<div class="empty"><div><strong>Loading schedule…</strong><span>Fetching this landing’s departures.</span></div></div>');
  }
  const query = selected === null ? "" : `?landingId=${encodeURIComponent(selected)}`;
  try {
    const response = await request(`/api/display-data${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (token !== landingRequest) return;
    if (!validSchedule(payload, selected)) throw new Error('Invalid schedule');
    storage.setItem(landingKey, String(payload.meta.landingNumber));
    storage.setItem(landingDataKey(payload.meta.landingNumber), JSON.stringify(payload));
    requestedLanding = payload.meta.landingNumber;
    scheduleSaved = Boolean(response.saved);
    applySchedule(payload);
    if (changed) contentTransition(elements.departures);
  } catch {
    if (token !== landingRequest) return;
    if (!data) {
      reconcileHTML(elements.departures, '<div class="empty"><div><strong>Landing unavailable</strong><span>No saved schedule for this landing. Choose another landing or retry when connected.</span></div></div>');
      return;
    }
  }
  if (token !== landingRequest) return;
  void loadManualOverride();
  void loadRealtime();
  void loadServiceAlerts();
}

function favouriteLandings() {
  try {
    const stored = JSON.parse(storage.getItem(favouriteLandingsKey) || "[]");
    return new Set(Array.isArray(stored) ? stored.filter(Number.isInteger) : []);
  } catch {
    return new Set();
  }
}

function setLandingFavourite(landingNumber, favourite) {
  const next = favouriteLandings();
  if (favourite) next.add(landingNumber);
  else next.delete(landingNumber);
  storage.setItem(favouriteLandingsKey, JSON.stringify([...next]));
  renderLandingList();
  // The list is rebuilt and reordered under the tap, so put the cursor back on the star that was
  // just pressed rather than dropping a keyboard user wherever that row landed.
  elements.landingList.querySelector(`[data-favourite-id="${landingNumber}"]`)?.focus();
}

// The favourite marks, drawn rather than shipped as assets: the menu is the one place offline has
// to keep working, and an inline path cannot fail to load.
//
// Every one of these is a single filled path in currentColor with no internal colours, which is
// what lets .landing-star[aria-pressed] keep saying starred-or-not by colour alone — the same
// mechanism the plain star has always used. They are silhouettes on purpose: at the 22px these
// render at, whiskers and facial features turn to grey mush, and the head shape is the only part
// doing any work.
function characterMark(paths) {
  return `<svg class="landing-star-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const starIcon = characterMark(`<path d="M12 3.6l2.6 5.28 5.83.85-4.22 4.11.996 5.8L12 16.9l-5.21 2.74.995-5.8-4.22-4.11 5.83-.85z"/>`);

// Head plus pointed ears, and the bow she is never without — on the left, as she wears it.
const kittyIcon = characterMark(`<path d="M6.4 6.1 4.5 2.9c-.2-.4.2-.8.6-.6l3.6 1.7A9.6 7.9 0 0 1 14.6 3.6l2.9-1.4c.4-.2.8.2.6.6l-1.5 2.7a7.6 7.6 0 0 1 2.3 4.6 5.4 5.4 0 0 1 1.5-.5l1.1-1.5c.3-.4.9-.1.8.4l-.3 1.6.8 1c.3.4-.1.9-.5.7l-1.6-.6-1.6.5a7.2 7.2 0 0 1-6.4 8.9A7.9 7.9 0 0 1 4 12.7a7.6 7.6 0 0 1 2.4-6.6Z"/>`);

// Round head, and the two long ears that hang past his chin.
const cinnamorollIcon = characterMark(`<path d="M12 3.4a6.4 6.4 0 0 1 6 4.1c1.6-.7 3.4-.4 4.2.8.8 1.3.1 3-1.5 4a5.9 5.9 0 0 1-2.7.9 6.4 6.4 0 0 1-1.6 1.9 5.6 5.6 0 0 1 .3 3.9c-.5 1.5-2 2.4-3.3 2-1.3-.4-1.9-2-1.4-3.5a5.2 5.2 0 0 1 .8-1.5 7.4 7.4 0 0 1-2.2-.5c-1 1.3-2.6 2-3.8 1.5-1.3-.5-1.7-2.1-1-3.5a5.3 5.3 0 0 1 1.4-1.7A6.1 6.1 0 0 1 12 3.4Z"/>`);

// Round head under the beret, with its little stalk on top and the ears sitting low and floppy.
const pompompurinIcon = characterMark(`<path d="M12.6 1.6c.5 0 .7.5.5.9l-.4.7a5 5 0 0 1 3.1 2.2 6.7 6.7 0 0 1 2.9 3.4 4.3 4.3 0 0 1 2.6 1.5c.9 1.3.4 3-1.1 3.8a4.6 4.6 0 0 1-2.3.5 7.3 7.3 0 0 1-11.2.4 4.5 4.5 0 0 1-2.6-.4c-1.6-.8-2.1-2.6-1.2-3.9a4.4 4.4 0 0 1 2.7-1.6 6.7 6.7 0 0 1 4.4-4.1A5.6 5.6 0 0 1 11.9 2c.1-.3.4-.4.7-.4Z"/>`);

// The jester hood: one peak leaning over, and a point down each side of the face.
const kuromiIcon = characterMark(`<path d="M11.4 2.1c1.4-.6 3 .1 3.6 1.5.3.7.3 1.4 0 2a7 7 0 0 1 2.8 2.8l3.1 1.4c.5.2.5.9 0 1.1l-2.6 1.1a7.1 7.1 0 0 1-1 3.6 6.9 6.9 0 0 1-11.6 0 7.1 7.1 0 0 1-1-3.6L2.1 10.9c-.5-.2-.5-.9 0-1.1l3.1-1.4a7 7 0 0 1 3.6-3.1 2.7 2.7 0 0 1 2.6-3.2Z"/>`);

// Only the Sanrio themes swap the mark. NYC Ferry and Night keep the plain star: one is the board's
// own livery and the other is a working night shift, and neither is asking for a cartoon.
const THEME_MARKS = {
  "hello-kitty": kittyIcon,
  cinnamoroll: cinnamorollIcon,
  pompompurin: pompompurinIcon,
  kuromi: kuromiIcon
};

function favouriteMark() {
  return THEME_MARKS[activeTheme()] || starIcon;
}

function renderLandingList() {
  const landings = storage.json(landingsKey, []);
  if (!landings.length) return;
  const current = data?.meta?.landingNumber;
  const favourites = favouriteLandings();
  const mark = favouriteMark();
  // Starred landings float to the top, in the list's own order underneath. Someone who works two
  // docks should find both without scrolling; the rest of the system stays where it always was.
  const ordered = [
    ...landings.filter((landing) => favourites.has(landing.id)),
    ...landings.filter((landing) => !favourites.has(landing.id))
  ];
  const query = document.querySelector("#landingSearch")?.value.trim().toLowerCase() || "";
  reconcileHTML(elements.landingList, ordered.filter(landing => landing.displayName.toLowerCase().includes(query)).map((landing) => {
    const starred = favourites.has(landing.id);
    const name = escapeHtml(landing.displayName);
    return `<li data-key="${landing.id}" class="landing-row${starred ? " is-favourite" : ""}">
    <button type="button" class="landing-star" data-favourite-id="${landing.id}" aria-pressed="${starred}" aria-label="${starred ? `Remove ${name} from favourites` : `Add ${name} to favourites`}" title="${starred ? "Remove from favourites" : "Add to favourites"}">${mark}</button>
    <button type="button" class="landing-option${landing.id === current ? " is-current" : ""}" data-landing-id="${landing.id}"${landing.id === current ? ' aria-current="true"' : ""}>
      <span class="landing-option-name">${name}</span>
    </button>
  </li>`;
  }).join(""));
}

async function loadLandings() {
  try {
    const response = await request("/api/landings", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    storage.setItem(landingsKey, JSON.stringify(payload.landings || []));
    if (Array.isArray(payload.operators) && payload.operators.length) {
      storage.setItem(operatorsKey, JSON.stringify(payload.operators));
    }
  } catch {
    // Keep whatever list was saved; the menu still works offline.
  }
  renderLandingList();
  renderFilterMenu();
}

// The nearest-landing shortcut.
//
// Someone opening this at a dock should not have to pick their landing out of a 26-item menu, so
// the button spends one tap on a location fix and then becomes a direct jump to whatever landing
// they are standing at. It only ever reads position on an explicit tap: no background watching, no
// permission prompt for anyone who never asks for it.

function savedNearest() {
  try {
    const saved = JSON.parse(storage.getItem(nearestKey) || "null");
    if (!saved || !Number.isInteger(saved.id)) return null;
    return Date.now() - Number(saved.at) > nearestMaxAgeMs ? null : saved;
  } catch {
    return null;
  }
}

// Great-circle metres. The landings sit a few km apart at most, so this is far more precision than
// ranking them needs — but Pier C and Brooklyn Navy Yard are only ~400 m apart, which is close
// enough that the cheap flat approximation is not obviously safe, and haversine costs nothing.
function distanceMetres(fromLat, fromLon, toLat, toLon) {
  const radians = Math.PI / 180;
  const halfLat = ((toLat - fromLat) * radians) / 2;
  const halfLon = ((toLon - fromLon) * radians) / 2;
  const a = Math.sin(halfLat) ** 2 + Math.cos(fromLat * radians) * Math.cos(toLat * radians) * Math.sin(halfLon) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Which of a landing's two names fits a button. Usually the short one ("Pier 11" over "Wall St /
// Pier 11"), but not always — landing 18 is "Rockaway" for display and "Rockaway + Bus Stop"
// internally — so take whichever is actually shorter rather than assuming.
function buttonLabel(landing) {
  return [landing.name, landing.displayName].filter(Boolean).sort((left, right) => left.length - right.length)[0] || `Landing ${landing.id}`;
}

function nearestLanding(latitude, longitude) {
  const landings = storage.json(landingsKey, []);
  let best = null;
  for (const landing of landings) {
    // A landing the build could not place is skipped rather than guessed at: missing from the
    // search is recoverable, wrong is not.
    if (!Number.isFinite(landing.latitude) || !Number.isFinite(landing.longitude)) continue;
    const metres = distanceMetres(latitude, longitude, landing.latitude, landing.longitude);
    if (!best || metres < best.metres) best = { id: landing.id, name: buttonLabel(landing), metres };
  }
  return best;
}

function distanceLabel(metres) {
  const miles = metres / 1609.344;
  return miles < 0.1 ? "under 0.1 mi" : `${miles.toFixed(1)} mi`;
}

function setNearest(state, label, description) {
  elements.nearestButton.dataset.state = state;
  elements.nearestButton.disabled = state === "locating";
  elements.nearestLabel.textContent = label;
  elements.nearestButton.setAttribute("aria-label", description);
  elements.nearestButton.title = description;
}

function renderNearest() {
  clearTimeout(nearestTimer);
  const saved = savedNearest();
  if (!saved) return setNearest("idle", "Nearest", "Find the nearest landing");
  // Standing at the landing already on screen, the shortcut has nowhere to send anyone, so it
  // becomes the way to take a fresh fix instead of a tap that does nothing.
  if (saved.id === data?.meta?.landingNumber) return setNearest("here", saved.name, `You are at ${saved.name} — tap to check again`);
  setNearest("ready", saved.name, `Nearest landing: ${saved.name}${saved.distance ? `, ${saved.distance} away` : ""}. Tap to switch.`);
}

// Failures say which failure it was and then get out of the way: a permission the user has to
// change in browser settings reads differently from a fix that just did not arrive.
function flashNearest(label, description) {
  setNearest("error", label, description);
  nearestTimer = setTimeout(renderNearest, 3200);
}

function locateNearest() {
  if (!navigator.geolocation) return flashNearest("No GPS", "This device cannot report its location.");
  clearTimeout(nearestTimer);
  setNearest("locating", "Locating…", "Finding the nearest landing");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const best = nearestLanding(position.coords.latitude, position.coords.longitude);
      // Only reachable from a landing list cached before landings carried positions. One online
      // start refreshes it, so this is a "not yet" rather than a real error.
      if (!best) return flashNearest("No fix", "No landing positions are available yet.");
      storage.setItem(nearestKey, JSON.stringify({ id: best.id, name: best.name, distance: distanceLabel(best.metres), at: Date.now() }));
      renderNearest();
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) return flashNearest("Blocked", "Location access is blocked for this site.");
      flashNearest("No fix", "Your location could not be determined.");
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
  );
}

// A tablet has the width to hold the landing list beside the board rather than over it, so on one
// the list is docked: it is on screen by default and the hamburger takes it away, which is the
// opposite of what the same button does on a phone. Same markup and same open/closed state either
// way — only what "open" looks like changes.
//
// Width alone, and then the surface. This used to also require a coarse pointer and a width under
// 1400px, which meant a desktop never docked the rail and read the landing list as a drawer over a
// board drawn for a screen it wasn't sitting at. A mouse is not a reason to hide the list; the only
// board that genuinely needs its whole screen is the signage display, and that is what the surface
// says. index.html sets it before the first paint.
const railMedia = window.matchMedia("(min-width:821px)");
const railKey = "nyc-ferry-did-landing-rail";
// index.html stamps this before the first paint, which is what the stylesheet reads. Deriving it
// again here rather than trusting the attribute covers the one case where the two could disagree:
// a document cached by an older service worker being driven by this script. Getting it wrong on a
// kiosk means the signage loses a quarter of its screen to a list nobody standing there can tap.
// Read off the path as a string rather than through new URL(): this runs at module top level, where
// a throw takes the whole board down with it, and location is not always the fully-formed thing a
// browser hands you.
if (!document.documentElement.dataset.surface) {
  const directory = String(location.pathname || "/").replace(/[^/]*$/, "");
  document.documentElement.dataset.surface = directory === "/" ? "kiosk" : "app";
}
MobileRuntime.syncViewport?.();
const railDocked = () => document.documentElement.dataset.surface !== "kiosk" && railMedia.matches;

function setMenuOpen(open, moveFocus = true) {
  panel(elements.landingMenu, open, !railDocked());
  elements.menuButton.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
  // Only the docked rail is a preference. A drawer is always closed to begin with.
  if (railDocked()) storage.setItem(railKey, open ? "shown" : "hidden");
  if (!moveFocus) return;
  if (open) (elements.landingList.querySelector(".is-current") || elements.landingMenuClose)?.focus();
  else elements.menuButton.focus();
}

// Runs at startup and again whenever the device is rotated or the window resized across the
// boundary, because a layout that only settles on load is wrong the moment an iPad is turned.
function applyRail() {
  const docked = railDocked();
  document.body.classList.toggle("sidebar-docked", docked);
  elements.landingMenuClose.textContent = docked ? "Hide" : "Done";
  setMenuOpen(docked && storage.getItem(railKey) !== "hidden", false);
}

async function selectLanding(landingNumber) {
  // Picking a landing dismisses a drawer, because a drawer is in the way of the answer. A docked
  // rail is not in the way of anything, so it stays where it is.
  const dismiss = () => { if (!railDocked()) setMenuOpen(false); };
  if (!Number.isInteger(landingNumber) || landingNumber === data?.meta?.landingNumber) return dismiss();
  storage.setItem(landingKey, String(landingNumber));
  dismiss();
  await load(landingNumber);
}

elements.nearestButton.addEventListener("click", () => {
  const saved = savedNearest();
  if (saved && saved.id !== data?.meta?.landingNumber) return void selectLanding(saved.id);
  locateNearest();
});

function bindSheet(setOpen, { menu, trigger, close, scrim, canClose = () => true }) {
  trigger?.addEventListener("click", () => setOpen(trigger.getAttribute("aria-expanded") !== "true"));
  close.addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));
  return { menu, setOpen, canClose };
}

const sheets = [
  bindSheet(setTripOpen, { menu: elements.tripMenu, close: elements.tripMenuClose, scrim: elements.tripMenuScrim }),
  bindSheet(setMenuOpen, { menu: elements.landingMenu, trigger: elements.menuButton, close: elements.landingMenuClose, scrim: elements.landingMenuScrim, canClose: () => !railDocked() }),
  bindSheet(setFilterOpen, { menu: elements.filterMenu, trigger: elements.filterButton, close: elements.filterMenuClose, scrim: elements.filterMenuScrim }),
  bindSheet(setThemeOpen, { menu: elements.themeMenu, trigger: elements.themeButton, close: elements.themeMenuClose, scrim: elements.themeMenuScrim }),
  bindSheet(setAlertMenuOpen, { menu: elements.alertMenu, trigger: elements.serviceAlerts, close: elements.alertMenuClose, scrim: elements.alertMenuScrim }),
  bindSheet(setChangelogOpen, { menu: elements.changelogMenu, trigger: elements.changelogButton, close: elements.changelogMenuClose, scrim: elements.changelogMenuScrim })
];

document.querySelector("#landingSearch")?.addEventListener("input", renderLandingList);
elements.landingList.addEventListener("click", (event) => {
  const star = event.target.closest("[data-favourite-id]");
  if (star) return setLandingFavourite(Number(star.dataset.favouriteId), star.getAttribute("aria-pressed") !== "true");
  const option = event.target.closest("[data-landing-id]");
  if (option) selectLanding(Number(option.dataset.landingId));
});
for (const button of elements.sortOptions) {
  button.addEventListener("click", () => selectSort(button.dataset.sort));
}
elements.clockToggle.addEventListener("click", toggleClockFormat);
elements.filterReset.addEventListener("click", showAllOperators);
elements.filterList.addEventListener("click", (event) => {
  const option = event.target.closest("[data-operator]");
  if (option) setOperatorHidden(option.dataset.operator, option.getAttribute("aria-checked") === "true");
});
// A row opens the trip it belongs to. Delegated because the board is rewritten every fifteen
// seconds and per-row listeners would be re-bound with it.
elements.departures.addEventListener("click", (event) => {
  const row = event.target.closest?.("[data-trip-id]");
  if (row) openTripView(row.dataset.tripId, row.dataset.stopId, Number(row.dataset.departureSeconds));
});
elements.departures.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest?.("[data-trip-id]");
  if (!row) return;
  // Space scrolls the departures list otherwise.
  event.preventDefault();
  openTripView(row.dataset.tripId, row.dataset.stopId, Number(row.dataset.departureSeconds));
});
// Tapping a pier is the same act as picking it from the drawer, so it is the same code path.
elements.tripStops.addEventListener("click", (event) => {
  const head = event.target.closest?.("[data-landing-id]");
  if (!head) return;
  setTripOpen(false);
  selectLanding(Number(head.dataset.landingId));
});
elements.themeList.addEventListener("click", (event) => {
  const option = event.target.closest("[data-theme]");
  if (option) selectTheme(option.dataset.theme);
});
elements.datePrev.addEventListener("click", () => stepDate(-1));
elements.dateNext.addEventListener("click", () => stepDate(1));
elements.dateCurrent.addEventListener("click", showToday);
document.addEventListener("keydown", (event) => {
  const openSheet = sheets.find(({ menu, canClose }) => !menu.hidden && canClose());
  if (event.key === "Escape" && openSheet) return openSheet.setOpen(false);
  // Arrow keys page through the schedule, which is how anyone reaches for a date stepper on a
  // desktop board. Only when the landing menu is closed and nothing is being typed into.
  // A docked rail does not swallow the arrow keys: it is part of the board, not a dialog over it.
  if (openSheet || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowLeft") stepDate(-1);
  else if (event.key === "ArrowRight") stepDate(1);
});

railMedia.addEventListener("change", applyRail);
applyRail();
applyTheme();
renderThemeMenu();
renderSortToggle();
renderClockToggle();
renderNearest();
loadChangelog();
loadLandings();
load().catch(() => {
  elements.departures.innerHTML = `<div class="empty"><div><strong>Schedule unavailable</strong><span>The local schedule needs attention.</span></div></div>`;
});
poll(updateClock, 15_000);
poll(() => data ? loadRealtime() : load(requestedLanding), 15_000);
poll(loadServiceAlerts, 60_000);
poll(loadManualOverride, 5_000);
if ("serviceWorker" in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  // The worker is fetched from the site root, so its scope covers the board wherever the board is
  // mounted — but the document it has to precache is wherever this page is, which is the root on a
  // kiosk and /ferryTimesMobile/ behind the deployment's proxy. Passing it along is the difference
  // between an offline shell and an install that fails on a 404.
  const base = new URL("./", location).pathname;
  navigator.serviceWorker.register(`/sw.js?v=103&base=${encodeURIComponent(base)}`, { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      registration.update();
      // A board added to a home screen is resumed, not reloaded. iOS keeps the page alive for days,
      // so the check above — which only ever runs on a load — never runs again, and an installed
      // board can sit on a shell several deploys old while a browser tab on the same phone is
      // current. Checking when it comes back to the front is what makes a relaunch mean something.
      // Throttled because resuming is something someone does dozens of times a shift, and the
      // answer cannot change faster than a deploy.
      let lastCheck = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (Date.now() - lastCheck < 60_000) return;
        lastCheck = Date.now();
        registration.update().catch(() => {});
      });
    })
    .catch(() => {});
}
