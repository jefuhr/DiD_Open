// Real SVG layout is needed to catch boats hidden behind their details card.
const assert = require('node:assert/strict');
const { check } = require('./mobile-check-harness.cjs');
const boat = { id: '19', name: 'Opportunity', number: 'H-204', latitude: 40.72, longitude: -73.99, status: 'in-transit', speedKnots: 12, ageSeconds: 10 };
const harbor = {
  bounds: { minLatitude: 40.6, maxLatitude: 40.8, minLongitude: -74.05, maxLongitude: -73.95 },
  routes: [], landings: [], chart: { land: [], streets: [], bridges: [], seamarks: [] }
};
async function visible(page) {
  await page.waitForTimeout(500);
  const bounds = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return { boat: rect('.boat-hull'), card: rect('#vesselCard'), map: rect('#chart') };
  });
  const { boat: b, card: c, map: m } = bounds;
  assert(b.left >= m.left && b.right <= m.right && b.top >= m.top && b.bottom <= m.bottom, JSON.stringify(bounds));
  assert(b.right < c.left || b.left > c.right || b.bottom < c.top || b.top > c.bottom, JSON.stringify(bounds));
}
(async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    for (const latitude of [40.72, 40.6, 40.8]) {
      await check(`boat framing ${viewport.width} / ${latitude}`, {
        context: { viewport },
        api: { '/api/map': harbor, '/api/boats': { available: true, boats: [{ ...boat, latitude }] } }
      }, async ({ page, site }) => {
        await page.goto(`${site.origin}/map`);
        await page.locator('.boat-row').click();
        await visible(page);
        await page.locator('#vesselCard .card-close').click();
        await page.locator('.boat-hull').click();
        await visible(page);
        await page.goto(`${site.origin}/map?boat=Opportunity`);
        await page.waitForSelector('.boat-hull');
        await visible(page);
      });
    }
  }
})().catch(error => { console.error(error); process.exit(1); });
