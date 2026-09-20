import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

test("shell upgrades replace old notice caches and precache the module graph", async () => {
  const events = new Map(), deleted = [], installed = [];
  const ctx = {
    URL, location: { origin: "https://ferry.test" },
    self: {
      location: { href: "https://ferry.test/sw.js" },
      addEventListener: (name, callback) => events.set(name, callback),
      skipWaiting: async () => {}, clients: { claim: async () => {} }
    },
    caches: {
      keys: async () => ["nyc-ferry-did-shell-v101", "nyc-ferry-did-data-v101", "unrelated-cache"],
      delete: async (name) => { deleted.push(name); },
      open: async () => ({ addAll: async (files) => installed.push(...files), keys: async () => [] })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  for (const name of ["install", "activate"]) {
    let pending;
    events.get(name)({ waitUntil: promise => { pending = promise; } });
    await pending;
  }
  assert.deepEqual(deleted.sort(), ["nyc-ferry-did-data-v101", "nyc-ferry-did-shell-v101"]);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  for (const [, relative] of app.matchAll(/from "(\.\/assets\/[^"]+)"/g)) {
    assert.ok(installed.includes(relative.slice(1)), relative);
  }
  let intercepted = false;
  events.get("fetch")({
    request: { method: "GET", url: "https://ferry.test/api/override?landingId=16" },
    respondWith: () => { intercepted = true; }
  });
  assert.equal(intercepted, false);
});

test("shell upgrade retains API snapshots but drops the retired notice endpoint", async () => {
  const events = new Map(), stores = new Map();
  const prior = "nyc-ferry-did-data-v102";
  const request = path => ({ url: "https://ferry.test" + path });
  const schedule = request("/api/display-data?landingId=30"), map = request("/api/map"), notice = request("/api/override");
  stores.set(prior, new Map([[schedule.url, { body: "schedule" }], [map.url, { body: "geometry" }], [notice.url, { body: "retired" }]]));
  const ctx = {
    URL, self: {
      location: { href: "https://ferry.test/sw.js" },
      addEventListener: (event, callback) => events.set(event, callback),
      clients: { claim: async () => {} }
    },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async name => stores.delete(name),
      open: async name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return {
          keys: async () => [...store.keys()].map(url => ({ url })),
          match: async request => store.get(request.url),
          put: async (request, response) => store.set(request.url, response)
        };
      }
    }
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  let pending;
  events.get("activate")({ waitUntil: promise => { pending = promise; } });
  await pending;
  const current = stores.get(vm.runInContext("DATA", ctx));
  assert.equal(current.get(schedule.url).body, "schedule");
  assert.equal(current.get(map.url).body, "geometry");
  assert.equal(current.has(notice.url), false);
  assert.equal(stores.has(prior), false);
});
for (const base of ["/", "/ferryTimesMobile/"]) {
  test(`offline navigation falls back to the matching board or map shell at ${base}`, async () => {
    const events = new Map(),
      matched = [];
    const ctx = {
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
      location: { origin: "https://ferry.test" },
      self: {
        location: {
          href: `https://ferry.test/sw.js?base=${encodeURIComponent(base)}`,
        },
        addEventListener: (name, callback) => events.set(name, callback),
      },
      caches: {
        open: async () => ({
          match: async (request) => {
            matched.push(request);
            return typeof request === "string" ? { shell: request } : undefined;
          },
        }),
      },
      fetch: async () => {
        throw new Error("offline");
      },
    };
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    for (const page of ["", "map?boat=19"]) {
      let response;
      events.get("fetch")({
        request: {
          method: "GET",
          mode: "navigate",
          url: `https://ferry.test${base}${page}`,
        },
        respondWith: (promise) => {
          response = promise;
        },
      });
      assert.equal((await response).shell, page ? `${base}map` : base);
    }
    assert.ok(matched.includes(`${base}map`));
    assert.ok(vm.runInContext("FILES.includes(`${BASE}map`)", ctx));
    assert.equal(
      vm.runInContext("FILES.some(path => /kitty|bk-flame/.test(path))", ctx),
      false,
    );
  });
}

test("offline API snapshots carry an explicit saved-data header", async () => {
  const events = new Map();
  const ctx = {
    URL,
    Headers,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    location: { origin: "https://ferry.test" },
    self: {
      location: { href: "https://ferry.test/sw.js" },
      addEventListener: (name, callback) => events.set(name, callback),
    },
    caches: {
      open: async () => ({
        match: async () => new Response('{"stale":false,"boats":[]}'),
      }),
    },
    fetch: async () => {
      throw new Error("offline");
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  let result;
  events.get("fetch")({
    request: { method: "GET", url: "https://ferry.test/api/boats" },
    respondWith: (promise) => {
      result = promise;
    },
  });
  assert.equal((await result).headers.get("X-Ferry-Saved"), "1");
});
