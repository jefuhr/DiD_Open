import test from "node:test";
import assert from "node:assert/strict";
import { createRideSession, RIDE_KEY } from "../public/assets/ride-session.js";
function storage() { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
test("a ride survives a new session and only explicit exit clears it", () => {
  const saved = storage();
  const ride = createRideSession(saved);
  ride.start({ id: "opportunity", name: "Opportunity" }, "/map?boat=Opportunity");
  ride.browse("/?landing=17");
  const restored = createRideSession(saved);
  assert.equal(restored.current.vesselId, "opportunity");
  assert.equal(restored.current.returnURL, "/?landing=17");
  restored.exit();
  assert.equal(createRideSession(saved).current, null);
});
test("corrupt sessions and external return locations cannot redirect the app", () => {
  const saved = storage();
  saved.setItem(RIDE_KEY, "{oops");
  assert.equal(createRideSession(saved).current, null);
  const ride = createRideSession(saved);
  ride.start({ id: "opportunity", name: "Opportunity" }, "//evil.example");
  assert.equal(ride.current.returnURL, "/");
});
