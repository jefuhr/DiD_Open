export const RIDE_KEY = "nyc-ferry-did-ride-v1";
const safeReturn = value => typeof value === "string" && /^\/(?:ferryTimesMobile\/)?(?:map(?:\.html)?|index\.html)?(?:\?[^#]*)?$/.test(value) ? value : "/";

export function createRideSession(storage) {
  let current = null;
  try {
    const saved = JSON.parse(storage.getItem(RIDE_KEY));
    if (saved?.version === 1 && typeof saved.vesselId === "string" && saved.vesselId && typeof saved.name === "string") current = { ...saved, returnURL: safeReturn(saved.returnURL) };
  } catch { /* Invalid saved state is the same as no ride. */ }
  function save() { storage.setItem(RIDE_KEY, JSON.stringify(current)); }
  return {
    get current() { return current; },
    start(vessel, returnURL) {
      current = { version: 1, vesselId: vessel.id, name: vessel.name, number: vessel.number || null, startedAt: new Date().toISOString(), returnURL: safeReturn(returnURL) };
      save();
    },
    browse(url) { if (current) { current.returnURL = safeReturn(url); save(); } },
    exit() { current = null; storage.removeItem(RIDE_KEY); }
  };
}
