import webpush from "web-push";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRideNotifications } from "./ride-notifications.js";

export async function createRidePush({ directory, refresh, describe, subject = "https://juliet.nyc/ferryTimesMobile/" }) {
  const keyPath = path.join(directory, "ride-push-keys.json");
  let keys;
  try { keys = JSON.parse(await readFile(keyPath, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    keys = webpush.generateVAPIDKeys();
    await mkdir(directory, { recursive: true });
    await writeFile(keyPath, JSON.stringify(keys) + "\n", { mode: 0o600, flag: "wx" });
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const service = await createRideNotifications({ statePath: path.join(directory, "ride-push-subscriptions.json"), refresh, describe,
    send: (subscription, message, options) => webpush.sendNotification(subscription, JSON.stringify(message), { ...options, timeout: 5000 }) });
  return { ...service, publicKey: keys.publicKey };
}

export async function handleRidePush(request, response, service) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!pathname.startsWith("/api/ride-notifications")) return false;
  const reply = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(JSON.stringify(body));
    return true;
  };
  if (pathname === "/api/ride-notifications/config" && request.method === "GET") return reply(200, { available: Boolean(service), publicKey: service?.publicKey || null });
  if (pathname !== "/api/ride-notifications") return reply(404, { error: "Not found." });
  if (!["GET", "PUT", "DELETE"].includes(request.method)) return reply(405, { error: "Method not allowed." });
  if (!service) return reply(503, { error: "Departure notifications are temporarily unavailable." });
  // A custom bearer header keeps these writes out of forms and cross-origin requests.
  if (request.headers["sec-fetch-site"] === "cross-site") return reply(403, { error: "Open notifications from this app." });
  if (request.headers.origin) {
    try { if (new URL(request.headers.origin).host !== request.headers.host) return reply(403, { error: "Open notifications from this app." }); }
    catch { return reply(403, { error: "Open notifications from this app." }); }
  }
  const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.authorization || "")?.[1];
  if (!token) return reply(401, { error: "A notification token is required." });
  try {
    if (request.method === "GET") return reply(200, { notification: service.get(token) });
    if (request.method === "DELETE") { await service.remove(token); return reply(200, { enabled: false }); }
    if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) return reply(415, { error: "Expected JSON." });
    let body = "", bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 8192) return reply(413, { error: "Subscription is too large." });
      body += chunk;
    }
    let value;
    try { value = JSON.parse(body); } catch { return reply(400, { error: "Invalid JSON." }); }
    if (!value || typeof value !== "object") return reply(400, { error: "Invalid subscription." });
    return reply(200, { notification: await service.set(token, value) });
  } catch (error) { return reply(error.status || 503, { error: error.status ? error.message : "Could not save notification settings. Please try again." }); }
}
