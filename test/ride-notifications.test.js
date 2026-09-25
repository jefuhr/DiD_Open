import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createECDH } from "node:crypto";
import { createRideNotifications, scheduledDepartures, validateSubscription } from "../lib/ride-notifications.js";
import { serviceEpoch } from "../lib/ride.js";

const at = serviceEpoch("2026-09-24", 36000);
const token = "a".repeat(64);
const key = createECDH("prime256v1"); key.generateKeys();
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: key.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } };
const input = { vesselId: "opportunity", subscription, base: "/ferryTimesMobile/" };
function snapshot() {
  return { vessel: { id: "opportunity", name: "Opportunity" }, timezone: "America/New_York", stale: false,
    trips: [{ tripId: "t1", serviceDate: "2026-09-24", state: "current", confirmedAt: at, route: "ER", stops: [
      { stopId: "a", name: "Pier 11", sequence: 1, departureSeconds: 36000, estimatedDepartureSeconds: 36300 },
      { stopId: "b", name: "DUMBO", sequence: 2, departureSeconds: 36030 },
      { stopId: "a", name: "Pier 11", sequence: 3, departureSeconds: 36050 },
      { stopId: "c", name: "Final drop-off", sequence: 4, departureSeconds: 36060 }
    ] }] };
}
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ride-notifications-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = at - 1000, data = snapshot(), refreshes = 0;
  const sent = [];
  const options = { statePath: path.join(dir, "subscriptions.json"), now: () => clock,
    refresh: async () => { refreshes++; }, describe: id => id === "opportunity" ? data : { ...data, vessel: { id, name: "Bay Hopper" } },
    send: async (sub, message, opts) => { sent.push({ sub, message, opts }); } };
  return { options, sent, get refreshes() { return refreshes; }, advance: ms => { clock += ms; }, setData: value => { data = value; } };
}

test("departure reminders use schedule times, include repeat landings, and exclude terminal drop-offs", () => {
  const events = scheduledDepartures(snapshot(), at);
  assert.deepEqual(events.map(event => event.at), [at, at + 30000, at + 50000]);
  assert.equal(new Set(events.map(event => event.id)).size, 3);
  for (const state of ["canceled", "reassigned"]) {
    const data = snapshot(); data.trips[0].state = state;
    assert.equal(scheduledDepartures(data, at).length, 0);
  }
  const skipped = snapshot(); skipped.trips[0].stops[1].skipped = true;
  assert.equal(scheduledDepartures(skipped, at).length, 2);
  assert.equal(scheduledDepartures({ ...snapshot(), stale: true }, at).length, 0);
  assert.equal(scheduledDepartures(snapshot(), at + 181000).length, 0);
});

test("departures beyond midnight stay on their original service day", () => {
  const data = snapshot(); data.trips[0].stops[0].departureSeconds = 90000;
  assert.equal(scheduledDepartures(data, at)[0].at, serviceEpoch("2026-09-24", 90000));
});

test("only real push provider HTTPS endpoints and valid encryption keys can be saved", () => {
  assert.deepEqual(validateSubscription(subscription), subscription);
  for (const endpoint of ["http://fcm.googleapis.com/test", "https://127.0.0.1/test", "https://fcm.googleapis.com.evil.test/test", "https://user@fcm.googleapis.com/test", "https://fcm.googleapis.com:8443/test"]) {
    assert.throws(() => validateSubscription({ ...subscription, endpoint }), /subscription/i);
  }
  assert.throws(() => validateSubscription({ ...subscription, keys: { auth: "x", p256dh: "x" } }), /subscription/i);
});

test("notifications run without page requests, fire once per departure, and survive a restart", async t => {
  const f = await fixture(t);
  let service = await createRideNotifications(f.options);
  await service.tick(); assert.equal(f.refreshes, 0);
  await service.set(token, input);
  await service.tick(); assert.equal(f.sent.length, 0);
  f.advance(1000);
  await service.tick(); await service.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].message.body, /Opportunity.*scheduled to depart Pier 11/);
  assert.equal(f.sent[0].message.url, "/ferryTimesMobile/ride");
  assert.equal(f.sent[0].opts.TTL, 60);
  service = await createRideNotifications(f.options);
  await service.tick(); assert.equal(f.sent.length, 1);
  f.advance(30000); await service.tick();
  f.advance(20000); await service.tick();
  assert.equal(f.sent.length, 3);
  f.advance(10000); await service.tick(); assert.equal(f.sent.length, 3);
});

test("enabling midway does not replay missed departures; exit and switching cancel old subscriptions", async t => {
  const f = await fixture(t), service = await createRideNotifications(f.options);
  f.advance(15000);
  await service.set(token, input); await service.tick(); assert.equal(f.sent.length, 0);
  await service.set(token, { ...input, vesselId: "bay-hopper" });
  f.advance(16000); await service.tick();
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].message.body, /Bay Hopper/);
  await service.remove(token); f.advance(20000); await service.tick();
  assert.equal(f.sent.length, 1); assert.equal(service.get(token), null);
});

test("a stale or failed refresh never causes a catch-up burst", async t => {
  const f = await fixture(t), service = await createRideNotifications(f.options);
  await service.set(token, input);
  f.setData({ ...snapshot(), stale: true }); f.advance(1000); await service.tick();
  assert.equal(f.sent.length, 0);
  f.advance(120000); f.setData(snapshot()); await service.tick();
  assert.equal(f.sent.length, 0);
});

test("transient delivery failure retries within the short window; gone subscriptions are removed", async t => {
  const f = await fixture(t); let status = 503, calls = 0;
  const service = await createRideNotifications({ ...f.options, send: async () => { calls++; if (status) throw Object.assign(new Error("push unavailable"), { statusCode: status }); } });
  await service.set(token, input); f.advance(1000); await service.tick(); assert.equal(calls, 1);
  await service.tick(); assert.equal(calls, 1, "no retry storm");
  status = 0; f.advance(10000); await service.tick(); assert.equal(calls, 2);
  status = 410; f.advance(20000); await service.tick(); assert.equal(service.get(token), null);
});

test("another token cannot take over an existing subscription", async t => {
  const f = await fixture(t), service = await createRideNotifications(f.options);
  await service.set(token, input);
  await assert.rejects(service.set("b".repeat(64), input), /already registered/i);
  assert.equal(service.get("b".repeat(64)), null);
});

test("exit during a feed refresh prevents a pending departure send", async t => {
  const f = await fixture(t); let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const service = await createRideNotifications({ ...f.options, refresh: () => waiting });
  await service.set(token, input); f.advance(1000);
  const tick = service.tick();
  await service.remove(token); release(); await tick;
  assert.equal(f.sent.length, 0);
});
