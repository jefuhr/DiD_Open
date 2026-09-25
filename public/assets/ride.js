import { worldX, worldY } from "./map-projection.js";
import { clockKey } from "./preferences.js";

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
export function mountRide(root, { header, ride, getGeometry, navigate, base }) {
  let active = false, geometry = null, snapshot = null, session = null, geometryJob = null;
  let renderedVessel = null;
  const expanded = new Set();
  const query = selector => root.querySelector(selector) || header.querySelector(selector);
  const title = header.querySelector("h1");
  const tripList = query("#rideTrips");
  const map = query("#rideMiniMap");
  const svgNode = (tag, attributes = {}, text) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text != null) element.textContent = text;
    return element;
  };
  function clock(at) {
    if (at == null || !Number.isFinite(at)) return "—";
    return new Intl.DateTimeFormat("en-US", { timeZone: snapshot?.timezone || "America/New_York", hour: "numeric", minute: "2-digit", hourCycle: MobileRuntime.storage.getItem(clockKey) === "12" ? "h12" : "h23" }).format(new Date(at));
  }
  function timing(stop, kind) {
    const seconds = stop[`${kind}Seconds`];
    const estimate = stop[`estimated${kind[0].toUpperCase() + kind.slice(1)}Seconds`];
    // Saved snapshots still contain their former estimates; explicitly remove those offsets.
    const at = snapshot?.stale && estimate != null && seconds != null ? stop[`${kind}At`] + (seconds - estimate) * 1000 : stop[`${kind}At`];
    return `${clock(at)} ${!snapshot?.stale && estimate != null ? "estimated" : "scheduled"}`;
  }
  function drawMap() {
    if (!geometry || !snapshot?.position) { map.setAttribute("hidden", ""); return; }
    map.removeAttribute("hidden");
    const { latitude, longitude } = snapshot.position;
    const centre = [worldX(longitude), worldY(latitude)];
    const scale = 1_400_000;
    const point = ([lat, lon]) => [(worldX(lon) - centre[0]) * scale + 200, (worldY(lat) - centre[1]) * scale + 90];
    const path = points => points.map((p,i) => { const [x,y] = point(p); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
    const layers = [svgNode("title", {}, `${snapshot.positionStale ? "Last reported" : "Current"} position of ${session.name}`)];
    for (const land of geometry.chart?.landmass || []) layers.push(svgNode("path", { d: [land.points, ...(land.holes || [])].map(ring => path(ring) + "Z").join(" "), class: "ride-land", "fill-rule": "evenodd" }));
    const labels = [];
    for (const dock of [...(geometry.landings || [])].sort((a,b) => Math.abs(a.latitude-latitude)+Math.abs(a.longitude-longitude)-Math.abs(b.latitude-latitude)-Math.abs(b.longitude-longitude))) {
      const [x,y] = point([dock.latitude,dock.longitude]);
      if (x < 10 || x > 390 || y < 12 || y > 160) continue;
      layers.push(svgNode("circle", { cx:x, cy:y, r:3, class:"ride-dock" }));
      const name = dock.name || dock.displayName;
      const label = name.length > 28 ? name.slice(0,25) + "…" : name;
      const width = label.length * 5.2;
      const left = Math.max(5,Math.min(x-width/2,395-width));
      const box = { left, right:left+width, top:y-18, bottom:y-5 };
      if (labels.some(old => box.left < old.right+8 && box.right > old.left-8 && box.top < old.bottom+5 && box.bottom > old.top-5)) continue;
      labels.push(box);
      layers.push(svgNode("text", { x:left, y:y-7 }, label));
    }
    layers.push(svgNode("circle", { cx:200, cy:90, r:16, class:"ride-boat-halo" }), svgNode("circle", { cx:200, cy:90, r:6, class:"ride-boat-dot" }));
    map.replaceChildren(...layers);
  }
  function render() {
    if (!active || !session) return;
    if (renderedVessel !== session.vesselId) { expanded.clear(); renderedVessel = session.vesselId; }
    title.textContent = session.name;
    query("#rideHull").textContent = [session.number, "NYC Ferry"].filter(Boolean).join(" · ");
    const live = snapshot && !snapshot.stale && !snapshot.positionStale;
    query("#rideFreshness").textContent = !snapshot ? "Connecting…" : snapshot.stale ? "Saved data" : snapshot.positionStale ? "Position unavailable" : "Live";
    const current = snapshot?.trips.find(trip => trip.state === "current");
    query("#rideRoute").textContent = current ? `${current.route} to ${current.destination}` : "Waiting for a confirmed current trip";
    const stop = snapshot?.nextStop;
    query("#rideNextLabel").textContent = live && snapshot.position.status === "stopped" ? "At landing" : live ? "Next landing" : "Last reported next landing";
    query("#rideNext").textContent = stop?.name || "Not yet reported";
    query("#rideETA").textContent = stop ? timing(stop, "arrival") : "Arrival time unavailable";
    const remaining = stop?.arrivalAt == null ? null : Math.max(0, Math.ceil((stop.arrivalAt - Date.now()) / 60000));
    query("#rideCountdown").textContent = live && stop?.estimatedArrivalSeconds != null ? remaining ? `In ${remaining} min` : snapshot.position.status === "stopped" ? "At the dock" : "Due now" : "";
    query("#rideSpeed").textContent = live && snapshot.position.speedKnots != null ? `${snapshot.position.speedKnots.toFixed(1)} kn` : "—";
    query("#rideReported").textContent = snapshot?.position?.reportedAt ? `Position reported ${clock(snapshot.position.reportedAt)}` : "No position reported";
    query("#rideDay").textContent = snapshot ? `Confirmed trips · ${snapshot.date}` : "Confirmed trips today";
    query("#rideHistoryNote").textContent = snapshot?.historyNote || "Your boat is saved. Reconnect to load its confirmed trips.";
    const fragment = [];
    for (const trip of snapshot?.trips || []) {
      const key = `${trip.serviceDate}|${trip.tripId}`;
      const details = node("details", null, `ride-trip ride-trip-${trip.state}`);
      details.dataset.key = key;
      if (expanded.has(key) || (!expanded.has(`closed:${key}`) && trip.state === "current")) details.setAttribute("open", "");
      const summary = node("summary");
      summary.append(node("span", `${trip.route} → ${trip.destination}`, "ride-trip-name"), node("span", `${clock(trip.startAt)} · ${trip.state === "reassigned" ? "Assignment changed" : trip.state}${trip.outOfService ? " · Out of service" : ""}`, "ride-trip-meta"));
      const stops = node("ol", null, "ride-stops");
      for (const stop of trip.stops) {
        const row = node("li", null, `${stop.current && live ? "is-current" : ""} ${stop.past ? "is-past" : ""}`);
        let name;
        if (stop.landingId != null) { name = node("a", stop.name); name.href = `${base}?landing=${stop.landingId}`; }
        else name = node("strong", stop.name);
        row.append(name);
        if (stop === trip.stops.at(-1)) row.append(node("span", "Final drop-off", "ride-stop-times"));
        row.append(node("span", stop.skipped ? "Skipped" : trip.state === "canceled" ? "Canceled" : [stop.arrivalSeconds != null ? `Arrive ${timing(stop,"arrival")}` : null, stop.departureSeconds != null ? `Depart ${timing(stop,"departure")}` : null].filter(Boolean).join(" · "), "ride-stop-times"));
        if (stop.layoverSeconds != null && !(snapshot.stale && stop.layoverEstimated)) row.append(node("span", `Layover ${Math.round(stop.layoverSeconds / 60)} min · ${stop.layoverEstimated ? "estimated" : "scheduled"}`, "ride-stop-times"));
        stops.append(row);
      }
      details.append(summary, stops);
      fragment.push(details);
    }
    if (!fragment.length) fragment.push(node("p", "No confirmed trips recorded for this boat today. Your ride stays pinned while we wait for the feed.", "ride-empty"));
    MobileRuntime.reconcile(tripList, fragment);
    drawMap();
  }
  tripList.addEventListener("toggle", event => {
    const key = event.target.dataset.key;
    if (!key) return;
    expanded.delete(event.target.open ? `closed:${key}` : key);
    expanded.add(event.target.open ? key : `closed:${key}`);
  }, true);
  query("#rideMinimize").addEventListener("click", () => ride.minimize());
  query("#rideExit").addEventListener("click", () => ride.exit());
  query("#rideOpenMap").addEventListener("click", () => { if (session) void navigate(`${base}map?boat=${encodeURIComponent(session.name)}`); });
  const unsubscribe = ride.subscribe((data, selected) => { snapshot = data; session = selected; render(); });
  return {
    ready: Promise.resolve(),
    activate() {
      active = true; root.hidden = false; root.inert = false; header.hidden = false; header.inert = false;
      document.title = `${session?.name || "Your boat"} · Riding · NYC Ferry`;
      render();
      if (!geometry && !geometryJob) geometryJob = getGeometry().then(r => r.json()).then(data => { geometry = data; if (active) drawMap(); }).catch(() => {}).finally(() => { geometryJob = null; });
    },
    deactivate() { active = false; root.hidden = true; root.inert = true; header.hidden = true; header.inert = true; },
    dispose() { this.deactivate(); unsubscribe(); }
  };
}
