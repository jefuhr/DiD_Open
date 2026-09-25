import { createHash, ECDH } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { serviceEpoch } from "./ride.js";

const WINDOW_MS = 60000, REFRESH_MS = 15000;
const hash = value => createHash("sha256").update(value).digest("hex");
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const tokenKey = token => {
  if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{43,128}$/.test(token)) throw problem("Invalid notification token.", 401);
  return hash(token);
};

export function validateSubscription(value) {
  try {
    const url = new URL(value.endpoint);
    const host = url.hostname;
    // Never let this public endpoint turn the server into an arbitrary HTTP client.
    const provider = ["fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(host)
      || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
    if (!provider || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || value.endpoint.length > 4096) throw new Error();
    for (const [name, length] of [["p256dh", 65], ["auth", 16]]) {
      const key = value.keys?.[name];
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(key) || Buffer.from(key, "base64url").length !== length) throw new Error();
    }
    ECDH.convertKey(Buffer.from(value.keys.p256dh, "base64url"), "prime256v1");
    return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  } catch { throw problem("Invalid push subscription."); }
}

export function scheduledDepartures(ride, now) {
  if (!ride || ride.stale) return [];
  return ride.trips.flatMap(trip => {
    if (["canceled", "reassigned"].includes(trip.state) || !Number.isFinite(trip.confirmedAt)
      || now - trip.confirmedAt > 180000 || trip.confirmedAt > now + 60000) return [];
    // A terminal GTFS departure timestamp is a drop-off, not another sailing. The next
    // confirmed trip's origin supplies its departure, including turns at the same pier.
    return trip.stops.slice(0, -1).filter(stop => !stop.skipped && Number.isFinite(stop.departureSeconds)).map(stop => ({
      id: `${trip.serviceDate}|${trip.tripId}|${stop.sequence}`,
      at: serviceEpoch(trip.serviceDate, stop.departureSeconds, ride.timezone),
      name: stop.name, route: trip.route, vessel: ride.vessel
    }));
  });
}

export async function createRideNotifications({ statePath, refresh, describe, send, now = Date.now }) {
  const subscriptions = new Map();
  try {
    const data = JSON.parse(await readFile(statePath, "utf8"));
    if (data.version !== 1 || !Array.isArray(data.subscriptions)) throw new Error("Invalid notification state.");
    for (const row of data.subscriptions) {
      if (!/^[a-f0-9]{64}$/.test(row.key) || !Number.isFinite(row.since)) throw new Error("Invalid notification state.");
      subscriptions.set(row.key, { ...row, subscription: validateSubscription(row.subscription), ready: true });
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let writes = Promise.resolve(), running = null, timer = null, lastRefresh = -Infinity, healthy = false;
  function persist() {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(`${statePath}.tmp`, JSON.stringify({ version: 1, subscriptions: [...subscriptions.values()].map(({ ready, ...row }) => row) }) + "\n", { mode: 0o600 });
      await rename(`${statePath}.tmp`, statePath);
    });
    return writes;
  }
  function get(token) {
    const row = subscriptions.get(tokenKey(token));
    return row ? { vesselId: row.vesselId, enabled: true } : null;
  }
  async function set(token, input) {
    const key = tokenKey(token), subscription = validateSubscription(input.subscription);
    if (!["/", "/ferryTimesMobile/"].includes(input.base) || typeof input.vesselId !== "string" || !describe(input.vesselId, now())) throw problem("Unknown boat or app location.");
    if ([...subscriptions.values()].some(row => row.key !== key && row.subscription.endpoint === subscription.endpoint)) throw problem("This subscription is already registered.", 409);
    const old = subscriptions.get(key);
    if (!old && subscriptions.size >= 5000) throw problem("Notifications are busy. Please try later.", 503);
    const row = { key, subscription, vesselId: input.vesselId, base: input.base, since: old?.vesselId === input.vesselId ? old.since : now(), sent: old?.sent || {}, retry: {}, ready: false };
    subscriptions.set(key, row);
    try { await persist(); row.ready = true; }
    catch (error) { if (subscriptions.get(key) === row) { if (old) subscriptions.set(key, old); else subscriptions.delete(key); } throw error; }
    return get(token);
  }
  async function remove(token) {
    const key = tokenKey(token), old = subscriptions.get(key);
    subscriptions.delete(key);
    try { await persist(); }
    catch (error) { if (old && !subscriptions.has(key)) subscriptions.set(key, old); throw error; }
  }
  async function deliver(row, event) {
    const id = `${row.vesselId}|${event.id}`, at = now();
    if (subscriptions.get(row.key) !== row || !row.ready || row.sent[id] || row.retry[id] > at
      || event.at < row.since || event.at > at || at - event.at >= WINDOW_MS) return;
    // Save the claim before contacting the provider so a process restart cannot replay a ping.
    row.sent[id] = event.at;
    await persist();
    if (subscriptions.get(row.key) !== row || !row.ready) return;
    const message = { title: "Scheduled departure", body: `${event.vessel.name} is scheduled to depart ${event.name} now${event.route ? ` · ${event.route}` : ""}.`,
      tag: `ride-${hash(id).slice(0, 32)}`, url: `${row.base}ride`, vesselId: row.vesselId, departureAt: event.at };
    try { await send(row.subscription, message, { TTL: Math.max(1, Math.ceil((event.at + WINDOW_MS - now()) / 1000)), urgency: "high", topic: hash(id).slice(0, 32) }); }
    catch (error) {
      if (subscriptions.get(row.key) !== row) return;
      if ([404, 410].includes(error.statusCode)) subscriptions.delete(row.key);
      else { delete row.sent[id]; row.retry[id] = now() + 10000; }
      await persist();
    }
  }
  async function run() {
    if (!subscriptions.size) return;
    if (now() - lastRefresh >= REFRESH_MS) {
      lastRefresh = now();
      try { healthy = (await refresh()) !== false; } catch { healthy = false; }
    }
    if (!healthy) return;
    const descriptions = new Map(), jobs = [];
    for (const row of subscriptions.values()) {
      if (!row.ready) continue;
      for (const [key, at] of Object.entries(row.sent)) if (now() - at > 2 * 86400000) delete row.sent[key];
      if (!descriptions.has(row.vesselId)) descriptions.set(row.vesselId, scheduledDepartures(describe(row.vesselId, now()), now()));
      for (const event of descriptions.get(row.vesselId)) if (event.at <= now() && now() - event.at < WINDOW_MS) jobs.push(() => deliver(row, event));
    }
    for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16).map(job => job()));
  }
  function tick() { if (!running) running = run().finally(() => { running = null; }); return running; }
  return { get, set, remove, tick,
    start() { if (!timer) { timer = setInterval(() => { void tick().catch(() => console.error("Departure notification scheduler failed; will retry.")); }, 1000); timer.unref(); } },
    async stop() { clearInterval(timer); timer = null; await running; await writes; }
  };
}
