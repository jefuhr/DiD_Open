// Reproduce the installed board's window/web-view mismatch explicitly. An installed iOS board is
// handed a window whose CSS units cover the whole screen and a web view that stops one status bar
// short of it, so the shell has to be sized by what is painted rather than by the window. Ordinary
// phone emulation reports the two as equal and cannot catch a shell that overhangs the edge.
const assert = require("assert");
const { main } = require("./mobile-check-harness.cjs");
const baseline = process.argv.includes("--baseline");

main("installed viewport", { api: {
  "/api/alerts": { available: true, fetchedAt: "2026-09-05T15:27:00Z", alerts: [{
    id: "fixture", agency: "NYC Ferry", header: "Service Alert - Labor Day Schedule - 9/7/26",
    description: "NYC Ferry will operate on a weekend schedule on Monday, September 7th, 2026."
  }] }
} }, async ({ page, site, save, shot }) => {
  if (baseline) {
    const { execFileSync } = require("child_process");
    for (const asset of ["mobile-runtime.js", "mobile-console.css"])
      await page.route(`**/assets/${asset}?*`, (route) => route.fulfill({
        contentType: asset.endsWith(".js") ? "text/javascript" : "text/css",
        body: execFileSync("git", ["show", `4fad843:public/assets/${asset}`])
      }));
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34 } });
  await page.addInitScript(() => {
    // Init scripts precede the viewport meta tag: innerHeight can still use the 980px
    // desktop layout here. The fixture's initial device size is explicitly 390x844.
    // `unpainted` is the part of that window the web view is not drawn in — the phone's screenshot
    // showed 47 of 844, the height of the status bar the translucent style draws the board under.
    window.viewportFixture = { installed: true, layoutHeight: 844, unpainted: 47, height: null, top: 0, scale: 1, display: "browser" };
    Object.defineProperty(navigator, "standalone", { get: () => viewportFixture.installed });
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = realMatchMedia(query);
      if (query.includes("display-mode:")) Object.defineProperty(result, "matches", {
        get: () => viewportFixture.display !== "browser" && query.includes(`display-mode: ${viewportFixture.display}`)
      });
      return result;
    };
    const painted = () => viewportFixture.layoutHeight - viewportFixture.unpainted;
    Object.defineProperty(window, "innerHeight", { configurable: true, get: painted });
    for (const [key, get] of Object.entries({
      height: () => viewportFixture.height ?? painted(),
      offsetTop: () => viewportFixture.top,
      scale: () => viewportFixture.scale
    })) Object.defineProperty(visualViewport, key, { configurable: true, get });
    localStorage.setItem("nyc-ferry-did-selected-landing", "12");
    localStorage.setItem("nyc-ferry-did-sort", "time");
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ["2026-09-05T15:27:00Z"])); }
      static now() { return +new RealDate("2026-09-05T15:27:00Z"); }
    };
  });
  const results = [];
  const change = async (values) => {
    await page.evaluate((values) => {
      Object.assign(viewportFixture, values);
      visualViewport.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    }, values);
    await page.waitForTimeout(50);
  };
  const measure = async (name, selector, expectedBottom) => {
    const value = await page.locator(selector).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height,
        cssHeight: getComputedStyle(node).height, visualHeight: visualViewport.height,
        keyboard: document.documentElement.dataset.keyboard,
        paddingBottom: getComputedStyle(node).paddingBottom,
        scrollHeight: document.documentElement.scrollHeight };
    });
    results.push({ name, expectedBottom, ...value });
    if (!baseline) assert(Math.abs(value.bottom - expectedBottom) < 2,
      `${name}: bottom ${value.bottom}, expected ${expectedBottom}`);
  };
  for (const view of ["board", "map"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${site.origin}${view === "board" ? "/ferryTimesMobile/" : "/map?boat=Opportunity"}`);
    await page.waitForFunction(() => !!window.MobileRuntime);
    if (view === "board") await page.waitForSelector("#serviceAlerts.active");
    await page.waitForTimeout(500);
    const shell = view === "board" ? "#screen" : ".map-body";
    const bottom = view === "board" ? "#serviceAlerts" : "#bottomSheet";
    assert.equal(await page.evaluate(() => visualViewport.height), 797);
    // The window is 844 and 100vh agrees; the last bar has to stop at 797, where the paint does.
    await measure(`${view}: launch with 47px of the window unpainted`, bottom, 797);
    await shot(`viewport-${view}-${baseline ? "before" : "after"}.png`);
    await change({ unpainted: 81 });
    await measure(`${view}: a shorter web view still`, bottom, 763);
    await change({ unpainted: 0 });
    await measure(`${view}: a window that is painted all the way down`, bottom, 844);
    if (view === "board") {
      await page.locator("#menuButton").click();
      await page.waitForTimeout(250);
      await measure("drawer: the same bounds as the board", "#landingMenu", 844);
      await page.locator("#landingSearch").focus();
    } else {
      await page.locator("#sheetHandle").click();
      await page.waitForTimeout(300);
      await page.locator(".search-input").focus();
    }
    await change({ height: 400, top: 20 });
    await measure(`${view}: keyboard`, shell, 420);
    if (view === "board") await measure("drawer: keyboard", "#landingMenu", 420);
    await page.evaluate(() => document.activeElement.blur());
    await change({ height: null, unpainted: 47, top: 0 });
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await measure(`${view}: restored after keyboard/resume`, bottom, 797);
    await change({ height: 390, scale: 2 });
    await measure(`${view}: pinch zoom leaves layout still`, bottom, 797);
    await change({ installed: false, scale: 1, height: 700 });
    await measure(`${view}: ordinary browser toolbar`, bottom, 700);
    // Nothing branches on how the board was launched any more; these prove it stayed that way.
    for (const display of ["standalone", "fullscreen"]) {
      await change({ display, height: null });
      await measure(`${view}: ${display} media query`, bottom, 797);
    }
    for (const size of [{ width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(size);
      await change({ layoutHeight: size.height, unpainted: 21 });
      await measure(`${view}: rotate/resize ${size.width}x${size.height}`, shell, size.height - 21);
    }
  }
  await save(`viewport-${baseline ? "baseline" : "checks"}.json`, results);
});
