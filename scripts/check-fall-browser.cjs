// Run against a local application server, e.g. FALL_TEST_ORIGIN=http://127.0.0.1:8096.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const origin = process.env.FALL_TEST_ORIGIN || 'http://127.0.0.1:8090';
(async () => {
  const browser = await chromium.launch({headless:true});
  const results = [];
  await fs.mkdir('docs/schedule-comparison',{recursive:true});
  try {
    for (const scenario of [
      {name:'fall-desktop',date:'2026-09-14T12:00:00Z',landing:16,width:1440,height:1000},
      {name:'fall-mobile',date:'2026-09-14T12:00:00Z',landing:16,width:390,height:844},
      {name:'sukkot-mobile',date:'2026-09-28T16:00:00Z',landing:16,width:390,height:844},
      {name:'pier-c-mobile',date:'2026-09-14T12:00:00Z',landing:27,width:390,height:844},
    ]) {
      const context = await browser.newContext({viewport:{width:scenario.width,height:scenario.height},serviceWorkers:'block'});
      const page = await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({date}) => {
        const Real = Date;
        globalThis.Date = class extends Real { constructor(...args){super(...(args.length ? args : [date]));} static now(){return +new Real(date);} };
      },scenario);
      await page.route('**/api/realtime*',route=>route.fulfill({json:{available:true,stale:true,updates:[],vehicles:[]}}));
      await page.route('**/api/alerts*',route=>route.fulfill({json:{available:true,alerts:[]}}));
      await page.goto(`${origin}/?landing=${scenario.landing}`);
      await page.waitForFunction(() => document.querySelector('#boardNote').textContent.includes('UNCONFIRMED'));
      if (scenario.landing !== 27) await page.waitForSelector('#departures [data-trip-id]');
      const state=await page.evaluate(() => ({
        note:document.querySelector('#boardNote').textContent,
        overflow:document.documentElement.scrollWidth > innerWidth,
        rows:document.querySelectorAll('#departures [data-trip-id]').length,
        hasFinal:!!document.querySelector('.drop-off-badge'),
        text:document.querySelector('#departures').textContent
      }));
      assert.equal(state.overflow,false,scenario.name);
      assert.equal(state.hasFinal,false,scenario.name);
      assert.match(state.note,/Crew shifts \/ Pier C shuttles: UNCONFIRMED/);
      if (scenario.landing === 27) {
        assert.equal(state.rows,0);
        assert.match(state.text,/CREW TIMES UNCONFIRMED/);
        assert.doesNotMatch(state.text,/concluded/);
      }
      if (scenario.name==='sukkot-mobile') {
        assert.match(state.note,/Sukkot/);
        const row=page.locator('#departures [data-trip-id^="nyc:sukkot:"]').first();
        await row.click();
        await page.waitForSelector('#tripMenu:not([hidden])');
        assert.match(await page.locator('#tripStops').textContent(),/Trip connections and arrival estimates are unavailable/);
        assert.equal(await page.locator('#tripMapLink').isVisible(),false);
        await page.locator('#tripMenuClose').click();
        await page.waitForFunction(() => document.querySelector('#tripMenu').hidden);
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({path:`docs/schedule-comparison/${scenario.name}.png`,fullPage:true});
      assert.deepEqual(errors,[],scenario.name);
      results.push({scenario:scenario.name,note:state.note,rows:state.rows,overflow:state.overflow});
      await context.close();
    }
    await fs.writeFile('docs/schedule-comparison/browser-checks.json',JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
