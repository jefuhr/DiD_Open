import test from "node:test";
import assert from "node:assert/strict";
import { createDepartureNotifications } from "../public/assets/ride-notifications.js";

function fixture() {
  const values = new Map(), requests = [], calls = [];
  let current = { vesselId: "opportunity" }, notification = null, permission = "granted", sub = null, hold = null, offline = false;
  const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const registration = { getNotifications: async () => [], pushManager: {
    getSubscription: async () => sub,
    subscribe: async () => { calls.push("subscribe"); return sub = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/test", keys: {} }), unsubscribe: async () => { calls.push("unsubscribe"); sub = null; return true; } }; }
  } };
  const env = { localStorage, isSecureContext: true, PushManager: function() {}, ServiceWorkerRegistration: function() {},
    navigator: { userAgent: "Test", serviceWorker: { ready: Promise.resolve(registration) } },
    Notification: { get permission() { return permission; }, requestPermission: async () => { calls.push("permission"); return permission; } },
    crypto: globalThis.crypto, AbortController, setTimeout, clearTimeout, atob,
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (offline) throw new Error("offline");
      if (url.endsWith("/config")) return { ok: true, json: async () => ({ available: true, publicKey: "AQID" }) };
      if (options.method === "PUT") { if (hold) await hold; notification = { vesselId: JSON.parse(options.body).vesselId, enabled: true }; }
      if (options.method === "DELETE") notification = null;
      return { ok: true, json: async () => ({ notification }) };
    }
  };
  const create = () => createDepartureNotifications({ base: "/", getSession: () => current, onChange: () => {}, env });
  return { env, create, calls, requests, get notification() { return notification; }, setCurrent: value => { current = value; }, deny: () => { permission = "denied"; }, offline: () => { offline = true; }, hold: value => { hold = value; } };
}

test("permission is requested only by the toggle and enabling survives reload", async () => {
  const f = fixture(), control = f.create(); await control.ready;
  assert.deepEqual(f.calls, []);
  const enabling = control.toggle(); assert.equal(f.calls[0], "permission", "permission must start in the tap gesture");
  await enabling; assert.equal(control.state.enabled, true);
  assert.equal(f.notification.vesselId, "opportunity");
  const restored = f.create(); await restored.ready; assert.equal(restored.state.enabled, true);
  await restored.toggle(); assert.equal(restored.state.enabled, false); assert.equal(f.notification, null);
});

test("denied permission and unsupported devices never claim notifications are on", async () => {
  const f = fixture(), control = f.create(); await control.ready; f.deny(); await control.toggle();
  assert.equal(control.state.enabled, false); assert.match(control.state.message, /settings/i);
  assert(!f.calls.includes("subscribe"));
  delete f.env.PushManager;
  const unsupported = f.create(); await unsupported.ready;
  assert.equal(unsupported.state.supported, false);
});

test("iPhone browsers explain installation before requesting notification permission", async () => {
  const f = fixture(); f.env.navigator.userAgent = "iPhone";
  const browser = f.create(); await browser.ready;
  assert.equal(browser.state.supported, false); assert.match(browser.state.message, /Home Screen/);
  await browser.toggle(); assert.equal(f.calls.length, 0);
  f.env.navigator.standalone = true;
  const installed = f.create(); await installed.ready; assert.equal(installed.state.supported, true);
});

test("exiting during a registration request cancels it before exit completes", async () => {
  const f = fixture(), control = f.create(); await control.ready;
  let release; f.hold(new Promise(resolve => { release = resolve; }));
  const enabling = control.toggle();
  while (!f.requests.some(request => request.options.method === "PUT")) await new Promise(resolve => setTimeout(resolve, 1));
  const stopping = control.stop(); release();
  await enabling; assert.equal(await stopping, true);
  assert.equal(f.notification, null); assert.equal(control.state.enabled, false);
});

test("offline exit unsubscribes the device and remembers server cleanup for reconnection", async () => {
  const f = fixture(), control = f.create(); await control.ready; await control.toggle();
  f.offline(); assert.equal(await control.stop(), true);
  assert.equal(control.state.enabled, false); assert(f.calls.includes("unsubscribe"));
  assert.equal(JSON.parse(f.env.localStorage.getItem("nyc-ferry-ride-push-v1")).pendingOff, true);
});

test("exit waits for confirmed cancellation when both network and browser unsubscribe fail", async () => {
  const f = fixture(), control = f.create(); await control.ready; await control.toggle();
  const worker = await f.env.navigator.serviceWorker.ready;
  (await worker.pushManager.getSubscription()).unsubscribe = async () => { throw new Error("offline"); };
  f.offline(); assert.equal(await control.stop(), false);
  assert.equal(control.state.enabled, true); assert.match(control.state.message, /Reconnect/);
});
