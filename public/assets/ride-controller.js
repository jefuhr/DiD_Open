import { createRideSession } from "./ride-session.js";
import { clockKey } from "./preferences.js";

const SNAPSHOT_KEY = "nyc-ferry-ride-snapshot-v1";
export function createRideController({ navigate, base }) {
  const { storage, request } = MobileRuntime;
  const session = createRideSession(storage);
  const listeners = new Set();
  const bar = document.querySelector("#rideBar");
  const picker = document.querySelector("#ridePicker");
  const choices = document.querySelector("#rideChoices");
  const search = document.querySelector("#rideSearch");
  const pickerNote = document.querySelector("#ridePickerNote");
  let snapshot = null, stopPolling = null, generation = 0, browsing = true;
  let roster = [], context = {}, pickerGeneration = 0;
  const cached = storage.json(SNAPSHOT_KEY);
  if (cached?.vessel?.id === session.current?.vesselId) snapshot = { ...cached, stale: true, positionStale: true };

  function publish() {
    const active = session.current;
    bar.hidden = !active || !browsing;
    document.documentElement.classList.toggle("ride-minimized", Boolean(active && browsing));
    if (active) {
      bar.querySelector("strong").textContent = active.name;
      const stop = snapshot?.nextStop;
      const at = stop?.arrivalAt == null ? null : snapshot.stale && stop.estimatedArrivalSeconds != null && stop.arrivalSeconds != null
        ? stop.arrivalAt + (stop.arrivalSeconds - stop.estimatedArrivalSeconds) * 1000 : stop.arrivalAt;
      const clock = at == null ? "" : new Intl.DateTimeFormat("en-US", { timeZone: snapshot.timezone, hour: "numeric", minute: "2-digit", hourCycle: storage.getItem(clockKey) === "12" ? "h12" : "h23" }).format(new Date(at));
      bar.querySelector("span").textContent = stop
        ? `${stop.name}${clock ? ` · ${clock}` : ""} · ${snapshot.stale || snapshot.positionStale ? "Saved" : stop.estimatedArrivalSeconds != null ? "ETA" : "Scheduled"}`
        : "Your boat · Tap to return";
    }
    for (const listener of listeners) listener(snapshot, active);
  }
  async function refresh() {
    const active = session.current;
    if (!active) return;
    const token = generation;
    try {
      const response = await request(`/api/ride?vesselId=${encodeURIComponent(active.vesselId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Ride unavailable");
      const data = await response.json();
      if (token !== generation || data.vessel?.id !== session.current?.vesselId || !Array.isArray(data.trips)) return;
      snapshot = { ...data, stale: Boolean(data.stale || response.saved), positionStale: Boolean(data.positionStale || response.saved) };
      storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
      if (token !== generation) return;
      if (snapshot) snapshot = { ...snapshot, stale: true, positionStale: true };
    }
    publish();
  }
  function poll() {
    stopPolling?.();
    stopPolling = session.current ? MobileRuntime.poll(refresh, 15000) : null;
  }
  function closePicker() { pickerGeneration++; if (picker.open) picker.close(); }
  function restore({ replace = false } = {}) {
    if (!session.current) return;
    closePicker();
    void navigate(base + "ride", { historyMode: replace ? "replace" : "push" });
  }
  function start(vessel) {
    const same = session.current?.vesselId === vessel.id;
    if (!same) {
      generation++;
      const returnURL = session.current?.returnURL || location.pathname + location.search;
      session.start(vessel, returnURL);
      snapshot = null;
      storage.removeItem(SNAPSHOT_KEY);
      poll();
    }
    restore();
    publish();
  }
  function renderChoices() {
    const term = search.value.trim().toLowerCase();
    const list = roster.filter(vessel => `${vessel.name} ${vessel.number || ""}`.toLowerCase().includes(term));
    choices.replaceChildren();
    for (const vessel of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.vesselId = vessel.id;
      const name = document.createElement("strong");
      name.textContent = vessel.name;
      const detail = document.createElement("span");
      const suggested = vessel.id === context.vesselId || vessel.name === context.name || (context.number && vessel.number === context.number);
      detail.textContent = [vessel.number, suggested ? (context.confirmed ? "Selected vessel" : "Suggested · Check the boat you boarded") : vessel.route ? `Reporting on ${vessel.route}` : "Select this vessel"].filter(Boolean).join(" · ");
      button.append(name, detail);
      button.addEventListener("click", () => start(vessel));
      choices.append(button);
    }
    if (!list.length) {
      const empty = document.createElement("p");
      empty.textContent = roster.length ? "No matching vessels." : "The vessel list is unavailable. Reconnect and try again.";
      choices.append(empty);
    }
  }
  async function choose(intent = {}) {
    if (intent.confirmed && intent.vesselId && (!session.current || session.current.vesselId === intent.vesselId)) {
      start({ id: intent.vesselId, name: intent.name, number: intent.number });
      return;
    }
    context = intent;
    search.value = "";
    document.querySelector("#ridePickerTitle").textContent = session.current ? "Switch boats?" : "Which boat are you riding?";
    pickerNote.textContent = session.current
      ? `Choosing a vessel replaces your ride on ${session.current.name}.`
      : "Choose the name or hull number on your boat. This pins the vessel; only feed-confirmed trips appear in its day.";
    roster = storage.json("nyc-ferry-ride-vessels", []);
    if (!Array.isArray(roster)) roster = [];
    if (intent.vesselId && intent.name && !roster.some(vessel => vessel.id === intent.vesselId)) roster.unshift({ id: intent.vesselId, name: intent.name, number: intent.number });
    renderChoices();
    picker.showModal();
    search.focus();
    const token = ++pickerGeneration;
    const results = await Promise.allSettled([request("/api/vessels").then(r => r.ok ? r.json() : Promise.reject()), request("/api/boats").then(r => r.ok ? r.json() : Promise.reject())]);
    if (token !== pickerGeneration || !picker.open) return;
    if (results[0].status === "fulfilled" && Array.isArray(results[0].value.vessels)) {
      roster = results[0].value.vessels;
      storage.setItem("nyc-ferry-ride-vessels", JSON.stringify(roster));
    }
    const boats = results[1].status === "fulfilled" ? results[1].value.boats || [] : [];
    for (const boat of boats) if (boat.vesselId && boat.name && boat.mode !== "bus" && !roster.some(vessel => vessel.id === boat.vesselId)) roster.push({ id: boat.vesselId, name: boat.name, number: boat.number });
    roster = roster.map(vessel => ({ ...vessel, route: boats.find(boat => boat.vesselId === vessel.id)?.routeId }));
    const rank = vessel => vessel.id === intent.vesselId || vessel.name === intent.name ? 0 : intent.routeId && vessel.route === intent.routeId ? 1 : 2;
    roster.sort((a,b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    renderChoices();
  }
  search.addEventListener("input", renderChoices);
  document.querySelector("#ridePickerClose").addEventListener("click", closePicker);
  picker.addEventListener("cancel", () => { pickerGeneration++; });
  picker.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); }
  });
  bar.addEventListener("click", () => restore());
  document.addEventListener("visibilitychange", () => { if (!document.hidden && session.current) restore({ replace: true }); });
  window.addEventListener("pageshow", event => { if (event.persisted && session.current) restore({ replace: true }); });
  poll();
  publish();
  return {
    get session() { return session.current; },
    get snapshot() { return snapshot; },
    choose, refresh,
    subscribe(listener) { listeners.add(listener); listener(snapshot, session.current); return () => listeners.delete(listener); },
    viewChanged(view, url) {
      browsing = view !== "ride";
      if (browsing) session.browse(url.pathname + url.search);
      publish();
    },
    minimize() { void navigate(session.current?.returnURL || base); },
    exit() {
      const target = session.current?.returnURL || base;
      generation++;
      session.exit(); snapshot = null;
      storage.removeItem(SNAPSHOT_KEY);
      poll(); publish();
      void navigate(target, { historyMode: "replace" });
    }
  };
}
