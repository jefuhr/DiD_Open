// Shared plumbing for the phone-sized browser checks.
//
// Each check used to carry its own copy of this: the same static server, the same content-type
// table, the same 390x844 mobile context, and its own idea of where the application server lives —
// two of the three hardcoded port 8094 while the third read MOBILE_TEST_ORIGIN, so the same
// environment variable moved one check and not the others.
//
// These are not part of `npm test`. They need Chromium and a running application server, and they
// exist to answer questions the DOM tests cannot: real layout, real gestures, real fonts.
const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const ROOT = process.cwd();
const ARTIFACTS = path.join(ROOT, "artifacts/browser");
// The application server these checks read live data from. Started separately, because building
// the display data takes long enough that doing it per check would dominate the run.
const ORIGIN = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:8094";

const TYPES = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

// Root and public-prefix deployments serve the same responsive application.
function documentFor(pathname) {
  if (pathname.startsWith("/ferryTimesMobile/") && pathname !== "/ferryTimesMobile/") {
    return documentFor(pathname.slice("/ferryTimesMobile".length));
  }
  if (pathname === "/map" || pathname === "/map.html") return "/index.html";
  if (pathname === "/ferryTimesMobile/" || pathname === "/") return "/index.html";
  return pathname;
}

async function fromApp(pathname) {
  const response = await fetch(ORIGIN + pathname);
  if (!response.ok) throw new Error(`${ORIGIN}${pathname} answered ${response.status}`);
  return response.text();
}

/**
 * A static server over public/, with /api/ answered by `api` when it has an entry for the path and
 * proxied to the application server otherwise. Handlers may return a string or an object; objects
 * are serialised. Listens on an ephemeral port so checks can run side by side.
 */
async function serve({ api = {}, headers = {} } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const handler = api[url.pathname];
        const body = handler === undefined
          ? await fromApp(request.url)
          : typeof handler === "function" ? await handler(url) : handler;
        response.setHeader("Content-Type", TYPES[".json"]);
        response.end(typeof body === "string" ? body : JSON.stringify(body));
        return;
      }
      const file = documentFor(url.pathname);
      response.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
      response.end(await fs.readFile(path.join(ROOT, "public", file)));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// A phone. Service workers are blocked so a check sees the code on disk rather than whatever an
// earlier run installed, which is the difference between a check that fails and a check that lies.
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block"
};

/**
 * Runs `body({ page, site, errors, save })` against a fresh Chromium phone, then tears everything
 * down and exits non-zero if anything threw or the page logged an uncaught error.
 */
async function check(name, { api = {}, context = {} } = {}, body) {
  const { chromium } = require(path.join(ROOT, "node_modules/playwright"));
  const site = await serve({ api });
  const errors = [];
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ ...PHONE, ...context });
    page.on("pageerror", (error) => errors.push(error.message));
    const save = async (file, data) => {
      await fs.mkdir(ARTIFACTS, { recursive: true });
      await fs.writeFile(path.join(ARTIFACTS, file), `${JSON.stringify(data, null, 2)}\n`);
    };
    const shot = async (file) => {
      await fs.mkdir(ARTIFACTS, { recursive: true });
      return page.screenshot({ path: path.join(ARTIFACTS, file) });
    };
    await body({ page, site, errors, save, shot });
    if (errors.length) throw new Error(`Uncaught page errors: ${errors.join(", ")}`);
    console.log(`${name}: ok`);
  } finally {
    await browser?.close();
    await site.close();
  }
}

// Wraps check() so a failing assertion exits non-zero rather than surfacing as an unhandled
// rejection warning and a zero status.
function main(name, options, body) {
  check(name, options, body).catch((error) => {
    console.error(`${name}: FAILED`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = { ORIGIN, ARTIFACTS, TYPES, documentFor, fromApp, serve, check, main, PHONE };
