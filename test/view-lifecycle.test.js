import test from "node:test";
import assert from "node:assert/strict";
import { createViewLifecycle } from "../public/assets/view-lifecycle.js";

test("view polling guards an in-flight task across rapid deactivate/activate and disposal", async t => {
  const previous = globalThis.MobileRuntime;
  t.after(() => { globalThis.MobileRuntime = previous; });
  const callbacks = new Set();
  globalThis.MobileRuntime = {
    poll(callback) {
      callbacks.add(callback);
      void callback();
      return () => callbacks.delete(callback);
    }
  };
  const lifecycle = createViewLifecycle();
  let calls = 0, resolve;
  lifecycle.poll(() => {
    calls++;
    return new Promise(done => { resolve = done; });
  }, 15000);
  assert.equal(calls, 0);
  lifecycle.activate();
  assert.equal(calls, 1);
  for (let i = 0; i < 8; i++) {
    lifecycle.deactivate();
    assert.equal(callbacks.size, 0);
    lifecycle.activate();
    assert.equal(callbacks.size, 1);
  }
  assert.equal(calls, 1, "switching must not duplicate the in-flight request");
  resolve();
  await new Promise(setImmediate);
  const tick = [...callbacks][0];
  void tick();
  assert.equal(calls, 2);
  lifecycle.dispose();
  lifecycle.activate();
  assert.equal(callbacks.size, 0);
  resolve();
  await new Promise(setImmediate);
  await tick();
  assert.equal(calls, 2, "a retired callback cannot fetch after disposal");
});
