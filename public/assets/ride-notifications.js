const KEY = "nyc-ferry-ride-push-v1";

export function createDepartureNotifications({ base, getSession, onChange, env = globalThis }) {
  const ios = /iPad|iPhone|iPod/.test(env.navigator?.userAgent || "") || (env.navigator?.platform === "MacIntel" && env.navigator.maxTouchPoints > 1);
  const installed = env.navigator?.standalone || env.matchMedia?.("(display-mode: standalone)").matches;
  const supported = Boolean(env.isSecureContext && env.Notification && env.PushManager && env.navigator?.serviceWorker && !(ios && !installed));
  const unavailable = ios && !installed ? "On iPhone or iPad, add this app to your Home Screen in Safari, open it there, then turn on notifications."
    : "This browser cannot receive departure notifications. Use a browser with notifications over HTTPS.";
  let saved = {}, busy = false, initialized = false, message = "", config = null, generation = 0, queue = Promise.resolve();
  try { saved = JSON.parse(env.localStorage.getItem(KEY)) || {}; } catch { /* Checked again before subscribing. */ }
  const enabled = () => Boolean(saved.vesselId);
  function persist() { env.localStorage.setItem(KEY, JSON.stringify(saved)); }
  function publish() { onChange(); }
  function enqueue(task) {
    const job = queue.catch(() => {}).then(task);
    queue = job;
    return job;
  }
  async function api(method, body) {
    const controller = new env.AbortController();
    const timeout = env.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await env.fetch("/api/ride-notifications", { method, cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${saved.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Notification settings could not be saved.");
      return data;
    } finally { env.clearTimeout(timeout); }
  }
  async function registration() {
    let timeout;
    try { return await Promise.race([env.navigator.serviceWorker.ready, new Promise((_, reject) => { timeout = env.setTimeout(() => reject(new Error("The app is still installing. Please try again.")), 10000); })]); }
    finally { env.clearTimeout(timeout); }
  }
  async function clear() {
    if (!saved.token) return true;
    saved.pendingOff = true;
    try { persist(); } catch { /* A device unsubscribe is still worth trying. */ }
    let removed = false, unsubscribed = false;
    await Promise.all([
      api("DELETE").then(() => { removed = true; }).catch(() => {}),
      (async () => {
        if (!supported) return;
        const worker = await registration(), subscription = await worker.pushManager.getSubscription();
        unsubscribed = !subscription || await subscription.unsubscribe();
        for (const notification of await worker.getNotifications()) if (notification.tag.startsWith("ride-")) notification.close();
      })().catch(() => {})
    ]);
    if (!removed && !unsubscribed) {
      message = "Could not stop notifications. Reconnect and try again before exiting or switching boats.";
      publish(); return false;
    }
    saved.vesselId = null; saved.pendingOff = !removed;
    try { persist(); } catch { /* The subscription has already been stopped. */ }
    message = "Departure notifications are off.";
    publish(); return true;
  }
  async function initialize() {
    if (!supported) { publish(); return; }
    try {
      const response = await env.fetch("/api/ride-notifications/config", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      config = await response.json();
    } catch { config = null; }
    if (saved.token) {
      if (saved.pendingOff) await clear();
      else try {
        const data = await api("GET");
        saved.vesselId = data.notification?.vesselId || null;
        if (saved.vesselId) {
          const sub = await (await registration()).pushManager.getSubscription();
          if (!sub || env.Notification.permission !== "granted" || saved.vesselId !== getSession()?.vesselId) await clear();
        }
        persist();
      } catch { message = saved.vesselId ? "Could not check notifications. Reconnect to update their settings." : ""; }
    }
    publish();
  }
  const ready = enqueue(initialize).finally(() => { initialized = true; publish(); });
  function stop() {
    generation++;
    busy = true; publish();
    return enqueue(clear).finally(() => { busy = false; publish(); });
  }
  function toggle() {
    if (busy) return Promise.resolve();
    if (enabled()) return stop();
    const session = getSession();
    if (!session || !supported) return Promise.resolve();
    // Start permission synchronously in the button's user gesture, before any network await.
    const permission = env.Notification.requestPermission();
    const token = ++generation, vesselId = session.vesselId;
    busy = true; message = ""; publish();
    return enqueue(async () => {
      let subscribed = false;
      try {
        const granted = await permission;
        if (token !== generation || getSession()?.vesselId !== vesselId) return;
        if (granted !== "granted") { message = granted === "denied" ? "Notifications are blocked. Allow them in your browser or phone settings, then try again." : "Notifications were not enabled. Tap again when you’re ready."; return; }
        if (!config?.available) throw new Error("Departure notifications are unavailable. Reconnect and reopen the app to try again.");
        if (!saved.token) saved.token = [...env.crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        // Keep the management token before making a subscription, including on private browsers.
        persist();
        const worker = await registration();
        const publicKey = Uint8Array.from(env.atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
        const subscription = await worker.pushManager.getSubscription() || await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
        subscribed = true;
        if (token !== generation || getSession()?.vesselId !== vesselId) { await clear(); return; }
        await api("PUT", { subscription: subscription.toJSON(), vesselId, base });
        saved.vesselId = vesselId; saved.pendingOff = false; persist();
        if (token !== generation || getSession()?.vesselId !== vesselId) { await clear(); return; }
        message = "On for this boat’s confirmed trips, even with the app closed. Alerts use scheduled departures; delivery and sound depend on your phone.";
      } catch (error) {
        if (subscribed) await clear();
        message = error.message || "Could not enable notifications. Please try again.";
      } finally { busy = false; publish(); }
    });
  }
  env.addEventListener?.("online", () => { void enqueue(initialize); });
  return { ready, toggle, stop,
    get state() { return { supported, busy, enabled: enabled(), available: Boolean(config?.available),
      message: !supported ? unavailable : message || (enabled() ? "On for this boat’s confirmed trips, including while the app is closed. Alerts use scheduled departure times."
        : !config?.available ? initialized ? "Departure notifications are temporarily unavailable. Reconnect and reopen the app to try again." : "Checking notification availability…"
        : "Get a phone notification at each scheduled departure on this boat’s confirmed trips, even with the app closed.") }; }
  };
}
