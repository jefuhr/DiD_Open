// Self-contained layout regression for a home-screen board with a minimized ride.
// Chromium's safe-area override exercises real env() values. Viewport and keyboard
// fixtures cover installed web views without requiring a live feed or app server.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve, ARTIFACTS, PHONE } = require('./mobile-check-harness.cjs');

async function main() {
  const { buildDisplayData } = await import('../lib/schedule-builder.js');
  const schedule = await buildDisplayData({ landingNumber: 16 });
  const { harbor } = await require('./map-browser-fixture.cjs')();
  const vessel = { id: 'jewel-of-the-harbor', name: 'Jewel of the Harbor' };
  const now = '2026-09-25T14:27:00Z';
  const site = await serve({ api: {
    '/api/display-data': schedule,
    '/api/landings': { landings: [{ id: 16, displayName: 'Pier 11 / Wall St' }] },
    '/api/realtime': { available: false, stale: true, updates: [], vehicles: [] },
    '/api/alerts': { available: true, fetchedAt: now, alerts: [{
      id: 'wind', agency: 'NYC Ferry', header: 'Service Alert - All Routes - Wind/Storms - Sep 25 & 26',
      description: 'New York City is anticipating high winds and storms. Allow additional travel time.'
    }] },
    '/api/changelog': { entries: [] }, '/api/connections': { stops: [] },
    '/api/map': harbor, '/api/boats': { available: true, boats: [] },
    '/api/vessels': { vessels: [vessel] },
    '/api/ride': { vessel, date: '2026-09-25', timezone: 'America/New_York',
      stale: false, positionStale: false, trips: [],
      position: { latitude: 40.703, longitude: -74.006, status: 'in-transit', speedKnots: 12, reportedAt: Date.parse(now) },
      nextStop: { name: 'Soundview', arrivalAt: Date.parse('2026-09-25T14:43:00Z') } },
    '/api/ride-notifications/config': { available: false }
  } });
  const results = [], errors = [];
  let browser, context, page;
  await fs.mkdir(ARTIFACTS, { recursive: true });
  const save = (file, data) => fs.writeFile(path.join(ARTIFACTS, file), JSON.stringify(data, null, 2) + '\n');
  try {
    browser = await chromium.launch();
    for (const base of ['/', '/ferryTimesMobile/']) {
      context = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await context.addInitScript(({ base, vessel }) => {
        Object.defineProperty(navigator, 'standalone', { get: () => true });
        localStorage.setItem('nyc-ferry-did-selected-landing', '16');
        localStorage.setItem('nyc-ferry-did-sort', 'time');
        localStorage.setItem('nyc-ferry-did-theme', 'hello-kitty');
        localStorage.setItem('nyc-ferry-did-ride-v1', JSON.stringify({
          version: 1, vesselId: vessel.id, name: vessel.name, returnURL: base
        }));
        window.viewportFixture = { height: null, top: 0, scale: 1 };
        Object.defineProperty(visualViewport, 'height', { get: () => viewportFixture.height ?? innerHeight });
        Object.defineProperty(visualViewport, 'offsetTop', { get: () => viewportFixture.top });
        Object.defineProperty(visualViewport, 'scale', { get: () => viewportFixture.scale });
      }, { base, vessel });
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date(now) });
      await page.clock.setFixedTime(new Date(now));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34 } });
      await page.setViewportSize({ width: 390, height: 797 });
      await page.goto(site.origin + base);
      await page.locator('#rideMinimize').click();
      await page.waitForSelector('#serviceAlerts.active');
      await page.waitForSelector('.timeline-row');
      await page.screenshot({ path: path.join(ARTIFACTS, 'installed-ride-initial.png') });

      // Small editable text triggers Safari's focus zoom. Check every search
      // field, including the picker, at smaller and larger user text settings.
      for (const font of [14, 16, 17, 20, 24]) {
        await page.evaluate(px => { document.documentElement.style.fontSize = px + 'px'; }, font);
        const inputs = await page.locator('input').evaluateAll(nodes => nodes.map(node => ({
          id: node.id, font: parseFloat(getComputedStyle(node).fontSize)
        })));
        for (const input of inputs) assert(input.font >= Math.max(16, font),
          `${input.id}: ${input.font}px at ${font}px root text risks focus zoom or ignores larger text`);
        results.push({ base, label: 'search font sizes', rootFont: font, inputs });
      }
      const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
      assert(!/user-scalable\s*=\s*no|maximum-scale\s*=/i.test(viewportMeta), 'Keep user pinch zoom available');

      const measure = async (label, safeBottom, minimized = true) => {
        // env() changes from CDP are applied lazily. Wait for actual layout and
        // the shell's ResizeObserver, not an arbitrary delay before first layout.
        await page.waitForFunction(() => {
          const view = document.querySelector('#mapView').hidden ? '#boardView' : '#mapView';
          return Math.abs(document.querySelector('.app-header').getBoundingClientRect().bottom -
            document.querySelector(view).getBoundingClientRect().top) < 2;
        });
        const value = await page.evaluate(() => {
          const box = selector => {
            const node = document.querySelector(selector), rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return { top: rect.top, bottom: rect.bottom, height: rect.height,
              paddingBottom: parseFloat(style.paddingBottom), paddingTop: parseFloat(style.paddingTop) };
          };
          const map = !document.querySelector('#mapView').hidden;
          const bar = document.querySelector('#rideBar');
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            viewportBottom: visualViewport.offsetTop + visualViewport.height,
            header: box('.app-header'), view: box(map ? '#mapView' : '#boardView'),
            lower: box(map ? '#bottomSheet' : '#serviceAlerts'), map,
            bar: bar.hidden ? null : box('#rideBar'),
            text: [...bar.querySelectorAll('strong, span')].map(node => {
              const rect = node.getBoundingClientRect();
              const range = document.createRange(); range.selectNodeContents(node);
              const text = range.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom, textTop: text.top, textBottom: text.bottom };
            }) };
        });
        results.push({ base, label, safeBottom, minimized, ...value });
        assert(value.scrollWidth <= value.width, `${label}: horizontal page overflow`);
        assert(Math.abs(value.header.bottom - value.view.top) < 2, `${label}: header/view gap`);
        const bottom = minimized ? value.bar.top : value.viewportBottom;
        assert(Math.abs(value.view.bottom - bottom) < 2, `${label}: view overlaps or leaves a gap above the bottom bar`);
        assert(Math.abs(value.lower.bottom - bottom) < 2, `${label}: bottom strip outside view`);
        assert.equal(value.lower.paddingBottom, value.map ? (minimized ? 0 : safeBottom) : Math.max(8, minimized ? 0 : safeBottom),
          `${label}: only the bottommost surface should reserve the safe area`);
        if (minimized) {
          assert(Math.abs(value.bar.bottom - value.viewportBottom) < 2, `${label}: ride bar outside viewport`);
          assert.equal(value.bar.paddingBottom, 10 + safeBottom, `${label}: ride bar safe-area padding`);
          for (const text of value.text) {
            assert(text.textTop >= text.top - 2 && text.textBottom <= text.bottom + 2, `${label}: ride text clipped`);
            assert(text.top >= value.bar.top + value.bar.paddingTop - 1, `${label}: text above ride bar`);
            assert(text.bottom <= value.bar.bottom - value.bar.paddingBottom + 1, `${label}: text overlaps safe area`);
          }
        }
      };

      const cases = [
        { width: 390, height: 797, top: 0, bottom: 34 }, // Below the installed status bar.
        { width: 390, height: 844, top: 47, bottom: 34 },
        { width: 375, height: 667, top: 0, bottom: 0 },
        { width: 320, height: 740, top: 0, bottom: 34 },
        { width: 844, height: 390, top: 0, bottom: 21 },
        { width: 768, height: 1024, top: 0, bottom: 20 },
        { width: 1440, height: 900, top: 0, bottom: 0 }
      ];
      for (const size of cases) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: size.top, bottom: size.bottom } });
        for (const font of [16, 20, 24]) {
          await page.evaluate(px => { document.documentElement.style.fontSize = px + 'px'; }, font);
          await measure(`${size.width}x${size.height}, ${font}px text`, size.bottom);
        }
      }
      await page.setViewportSize({ width: 390, height: 797 });
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34 } });
      await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
      await measure('installed board', 34);
      await page.screenshot({ path: path.join(ARTIFACTS, 'installed-ride-board.png') });
      await page.locator('#departures').evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert(await page.locator('#departures').evaluate(node => {
        const list = node.getBoundingClientRect(), last = node.lastElementChild.getBoundingClientRect();
        return last.bottom <= list.bottom + 2;
      }), 'Last departure must remain reachable above the footer');
      await page.locator('#mapButton').click();
      await page.waitForSelector('#chart path');
      await measure('installed map', 34);
      await page.locator('#sheetHandle').click();
      await page.locator('#boatSearch').focus();
      await page.evaluate(() => {
        Object.assign(viewportFixture, { height: 400, top: 20 });
        visualViewport.dispatchEvent(new Event('resize'));
      });
      await measure('keyboard open', 0);
      await page.evaluate(() => {
        document.activeElement.blur();
        Object.assign(viewportFixture, { height: null, top: 0 });
        window.dispatchEvent(new Event('pageshow'));
      });
      await measure('restored after keyboard', 34);
      const unzoomedBounds = await page.locator('#mapView').boundingBox();
      await page.evaluate(() => {
        Object.assign(viewportFixture, { height: 398.5, top: 30, scale: 2 });
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      assert.deepEqual(await page.locator('#mapView').boundingBox(), unzoomedBounds, 'Pinch zoom must not reflow the app');
      await page.evaluate(() => {
        Object.assign(viewportFixture, { height: null, top: 0, scale: 1 });
        visualViewport.dispatchEvent(new Event('resize'));
      });
      await measure('restored after pinch zoom', 34);
      await page.locator('#rideBar').click();
      await page.locator('#rideExit').click();
      await page.waitForSelector('#mapView:not([hidden])');
      await measure('map after ending ride', 34, false);
      await page.locator('#boardButton').click();
      await measure('board after ending ride', 34, false);
      await page.locator('.timeline-row[data-trip-id]').first().click();
      await page.locator('#tripRide').click();
      await page.waitForSelector('#ridePicker[open]');
      await page.locator('#rideSearch').fill('Jewel');
      await page.waitForSelector('[data-vessel-id="jewel-of-the-harbor"]');
      await page.screenshot({ path: path.join(ARTIFACTS, 'installed-ride-search.png') });
      await page.locator('#ridePickerClose').click();
      await context.tracing.stop({ path: path.join(ARTIFACTS, `installed-ride-${base === '/' ? 'root' : 'prefix'}-trace.zip`) });
      await context.close(); context = null;
    }
    assert.deepEqual(errors, [], 'Uncaught page errors');
    console.log(`Installed ride layout: ${results.length} checks passed`);
  } catch (error) {
    await page?.screenshot({ path: path.join(ARTIFACTS, 'installed-ride-failure.png') }).catch(() => {});
    await context?.tracing.stop({ path: path.join(ARTIFACTS, 'installed-ride-failure-trace.zip') }).catch(() => {});
    throw error;
  } finally {
    await save('installed-ride-results.json', { results, errors });
    await browser?.close();
    await site.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
