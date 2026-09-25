import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createECDH } from "node:crypto";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRidePush, handleRidePush } from "../lib/ride-push.js";

test("push settings persist privately, require a token, reject cross-origin writes, and bypass caching", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ride-push-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const options = { directory, refresh: async () => false, describe: id => id === "opportunity" ? { vessel: { id } } : null };
  const service = await createRidePush(options);
  assert.equal((await stat(path.join(directory, "ride-push-keys.json"))).mode & 0o777, 0o600);
  const server = http.createServer((request, response) => void handleRidePush(request, response, service));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + "/api/ride-notifications";
  const key = createECDH("prime256v1"); key.generateKeys();
  const headers = { Authorization: `Bearer ${"a".repeat(64)}`, "Content-Type": "application/json", Origin: origin };
  const body = JSON.stringify({ vesselId: "opportunity", base: "/", subscription: { endpoint: "https://web.push.apple.com/test", keys: { p256dh: key.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } } });
  assert.equal((await fetch(url, { method: "PUT", body })).status, 401);
  assert.equal((await fetch(url, { method: "PUT", headers: { ...headers, Origin: "https://evil.example" }, body })).status, 403);
  assert.equal((await fetch(url, { method: "PUT", headers, body: "[" })).status, 400);
  assert.equal((await fetch(url, { method: "PUT", headers, body: " ".repeat(8193) })).status, 413);
  const enabled = await fetch(url, { method: "PUT", headers, body });
  assert.equal(enabled.status, 200); assert.equal(enabled.headers.get("cache-control"), "no-store");
  assert.equal((await enabled.json()).notification.vesselId, "opportunity");
  const restored = await createRidePush(options);
  assert.equal(restored.publicKey, service.publicKey);
  assert.equal(restored.get("a".repeat(64)).vesselId, "opportunity");
  assert.equal((await stat(path.join(directory, "ride-push-subscriptions.json"))).mode & 0o777, 0o600);
  const other = await fetch(url, { headers: { Authorization: `Bearer ${"b".repeat(64)}` } });
  assert.equal((await other.json()).notification, null);
  await fetch(url, { method: "DELETE", headers });
  assert.equal(service.get("a".repeat(64)), null);
});

test("the worker displays push without a page and safely opens ride mode from the notification", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const base of ["/", "/ferryTimesMobile/"]) {
    const listeners = {}, shown = [], opened = [], origin = "https://ferry.example";
    const self = { location: { href: `${origin}/sw.js?base=${encodeURIComponent(base)}`, origin },
      addEventListener: (name, fn) => { listeners[name] = fn; },
      registration: { showNotification: async (...args) => { shown.push(args); } },
      clients: { matchAll: async () => [], openWindow: async url => { opened.push(url); } } };
    vm.runInNewContext(source, { self, URL, location: self.location });
    let job;
    listeners.push({ data: { json: () => ({ body: "Opportunity is scheduled to depart Pier 11 now.", tag: "ride-test", url: `${base}ride` }) }, waitUntil: promise => { job = promise; } });
    await job; assert.equal(shown.length, 1); assert.equal(shown[0][1].renotify, false);
    let closed = false;
    listeners.notificationclick({ notification: { data: shown[0][1].data, close: () => { closed = true; } }, waitUntil: promise => { job = promise; } });
    await job; assert(closed); assert.equal(opened[0], origin + base + "ride");
    listeners.notificationclick({ notification: { data: { url: "https://evil.example" }, close() {} }, waitUntil: promise => { job = promise; } });
    await job; assert.equal(opened[1], origin + base + "ride");
    let cached = false;
    listeners.fetch({ request: { method: "GET", url: origin + "/api/ride-notifications" }, respondWith() { cached = true; } });
    assert.equal(cached, false);
  }
});
