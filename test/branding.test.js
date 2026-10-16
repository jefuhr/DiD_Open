import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { createRealtimeService } from "../lib/realtime.js";
import { createNyuRealtimeService } from "../lib/nyu-realtime.js";
import { fetchServiceAlerts } from "../lib/service-alerts.js";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Ferry Kitty names the installed app and every HTML entry point", async () => {
	const manifest = JSON.parse(await read("public/assets/site.webmanifest"));
	assert.equal(manifest.name, "Ferry Kitty");
	assert.equal(manifest.short_name, "Ferry Kitty");
	for (const file of ["index.html", "map.html", "stats.html"]) {
		const { window } = new JSDOM(await read(`public/${file}`));
		try {
			assert.equal(window.document.title, file === "stats.html" ? "Ferry Kitty · Stats" : "Ferry Kitty", file);
			if (file !== "stats.html") {
				assert.equal(window.document.querySelector('meta[name="apple-mobile-web-app-title"]').content, "Ferry Kitty", file);
			} else {
				assert.equal(window.document.querySelector("h1").textContent, "Ferry Kitty");
			}
		} finally {
			window.close();
		}
	}
});

test("package and container identities use ferry-kitty", async () => {
	const pkg = JSON.parse(await read("package.json"));
	const lock = JSON.parse(await read("package-lock.json"));
	assert.equal(pkg.name, "ferry-kitty");
	assert.equal(lock.name, pkg.name);
	assert.equal(lock.packages[""].name, pkg.name);
	assert.match(await read("compose.yaml"), /^\s+image: ferry-kitty:local$/m);
});

test("realtime clients identify Ferry Kitty to upstream operators", async t => {
	const directory = await mkdtemp(path.join(tmpdir(), "ferry-kitty-branding-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const requests = [];
	const fetchImpl = async (url, options) => {
		requests.push({ url: String(url), userAgent: options.headers["User-Agent"] });
		return { ok: false, status: 503 };
	};
	const realtime = createRealtimeService({
		loadDisplay: async () => ({}),
		fleetPath: new URL("../content/vessels.json", import.meta.url),
		cachePath: path.join(directory, "realtime.json"), fetchImpl
	});
	const nyu = createNyuRealtimeService({
		loadDisplay: async () => ({ meta: { nyu: { enabled: true, stopIds: ["13139"] } } }),
		cachePath: path.join(directory, "nyu.json"), fetchImpl
	});
	await Promise.all([realtime.getCurrent(), nyu.getCurrent()]);
	assert.equal(requests.length, 3, "trip updates, vessel positions, and NYU ETAs all identify their client");
	for (const request of requests) assert.equal(request.userAgent, "Ferry-Kitty/1.0", request.url);
});

test("alert clients identify Ferry Kitty and retain their contact address", async () => {
	const requests = [];
	const contact = "https://example.test/contact";
	await assert.rejects(fetchServiceAlerts({
		contact,
		fetchImpl: async (url, options) => {
			requests.push({ url: String(url), userAgent: options.headers["User-Agent"] });
			return { ok: false, status: 503 };
		}
	}), /NYC Ferry service-alert sources are unavailable/);
	assert.ok(requests.length >= 4, "GTFS, website, crew, and subway alert clients are covered");
	for (const request of requests) assert.equal(request.userAgent, `Ferry-Kitty/1.0 (${contact})`, request.url);
});
