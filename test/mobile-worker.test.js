import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
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
