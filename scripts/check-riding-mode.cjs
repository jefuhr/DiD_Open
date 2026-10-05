const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve, ARTIFACTS } = require('./mobile-check-harness.cjs');
const mapFixture = require('./map-browser-fixture.cjs');

async function main() {
  const { buildDisplayData } = await import('../lib/schedule-builder.js');
  const { activeServices, tripIdentityForDate } = await import('../public/assets/schedule.js');
  const { THEMES } = await import('../public/assets/preferences.js');
  const schedule = await buildDisplayData({ landingNumber: 16 });
  const anotherLanding = await buildDisplayData({ landingNumber: 17 });
  const active = activeServices(schedule, '2026-09-24');
  const sailing = schedule.departures.find(d => active.has(d.serviceId) && d.seconds >= 36000 && d.seconds < 40000 && d.routeId === 'ER' && !d.outOfService);
  assert(sailing);
  const liveTripId = tripIdentityForDate(sailing, "2026-09-24") ?? sailing.tripId;
  const { harbor } = await mapFixture();
  const vessel = { id: 'opportunity', name: 'Opportunity', number: 'H-204' };
  const other = { id: 'bay-hopper', name: 'Bay Hopper', number: 'H-120' };
  const now = Date.parse('2026-09-24T14:00:00Z');
  const calls = [{ name: 'Pier 11', landingId: 16, sequence: 1, arrivalSeconds: 36000, departureSeconds: 36060, arrivalAt: now, departureAt: now + 60000, past: true },
    { name: 'DUMBO', landingId: 17, sequence: 2, arrivalSeconds: 36600, departureSeconds: 36660, arrivalAt: now + 720000, departureAt: now + 780000, estimatedArrivalSeconds: 36720, estimatedDepartureSeconds: 36780, current: true }];
  let rides = 0, confirmed = true, delayed = false;
  const payload = id => ({ vessel: id === other.id ? other : vessel, date: '2026-09-24', timezone: 'America/New_York', generatedAt: new Date(now).toISOString(), fetchedAt: new Date(now).toISOString(), stale: false, positionStale: false,
    position: { latitude: 40.703, longitude: -74.006, reportedAt: now, speedKnots: 12.3, status: 'in-transit' }, nextStop: calls[1],
    trips: [{ tripId: sailing.tripId, serviceDate: '2026-09-24', route: 'ER', destination: 'DUMBO', state: 'current', startAt: now, stops: calls }, { tripId: 'earlier', serviceDate: '2026-09-24', route: 'ER', destination: 'Pier 11', state: 'past', startAt: now - 3600000, stops: calls }],
    historyNote: 'Confirmed assignments observed during app use. Earlier and future trips may be missing.' });
  const boats = [vessel,other].map((v,i) => ({ id: String(i+1), vesselId: v.id, ...v, name:v.name, routeId:'ER', route:'ER', routeName:'East River', tripId:liveTripId, latitude:40.703 + i * .015, longitude:-74.006, speedKnots:12.3, ageSeconds:5, status:'in-transit' }));
  const site = await serve({ api: {
    '/api/display-data': url => url.searchParams.get('landingId') === '17' ? anotherLanding : schedule, '/api/landings': { landings: [{id:16, displayName:'Pier 11'}, {id:17, displayName:anotherLanding.meta.landing.displayName}] },
    '/api/alerts': { available:true, alerts:[] }, '/api/changelog': { entries:[] }, '/api/map':harbor,
    '/api/boats': {available:true,stale:false,boats}, '/api/vessels':{vessels:[vessel,other]},
    '/api/realtime': () => ({available:true,stale:false,updates:[],vehicles:confirmed ? [{tripId:liveTripId,boatName:vessel.name,vesselNumber:vessel.number,vesselId:vessel.id}] : []}),
    '/api/connections': () => ({ generatedAt:new Date(now).toISOString(), stops:[] }),
    '/api/ride': async url => { rides++; if (delayed) await new Promise(resolve => setTimeout(resolve, 500)); return payload(url.searchParams.get('vesselId')); }
  } });
  let browser;
  await fs.mkdir(ARTIFACTS, {recursive:true});
  const results = [];
  let lastPage, lastContext;
  try {
    browser = await chromium.launch();
    for (const base of ['/', '/ferryTimesMobile/']) {
      const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow',reducedMotion:'reduce'});
      await context.tracing.start({screenshots:true,snapshots:true,sources:true});
      const page = await context.newPage();
      lastPage = page; lastContext = context;
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
      await page.clock.install({time: new Date(now)});
      await page.clock.setFixedTime(new Date(now));
      await page.goto(site.origin + base);
      await page.waitForSelector(`[data-trip-id="${sailing.tripId}"]`);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.locator(`[data-trip-id="${sailing.tripId}"]`).first().click();
      await page.locator('#tripRide').click();
      await page.waitForSelector('#rideView:not([hidden])');
      await page.waitForFunction(() => document.querySelector('#rideSpeed').textContent === '12.3 kn');
      await page.waitForSelector('#rideMiniMap:not([hidden]) circle');
      assert.match(await page.locator('#rideETA').textContent(), /10:12 estimated/);
      assert.equal(await page.locator('#ridePicker').evaluate(n=>n.open),false);
      await page.locator('#rideTrips a[href*=\"landing=17\"]').first().click();
      await page.waitForFunction(name => document.querySelector('#landingName').textContent === name, anotherLanding.meta.landing.displayName);
      await page.locator('#rideBar').click();
      await page.waitForSelector('#rideView:not([hidden])');
      await page.locator('#rideMinimize').click();
      await page.waitForSelector('#rideBar:not([hidden])');
      await page.locator('#mapButton').click();
      await page.waitForSelector('.boat-row');
      const bounds = await page.evaluate(() => ({map:document.querySelector('#mapView').getBoundingClientRect().bottom,bar:document.querySelector('#rideBar').getBoundingClientRect().top}));
      assert(bounds.map <= bounds.bar + 1, JSON.stringify(bounds));
      await page.locator('.boat-row').last().click();
      assert.equal(await page.locator('#rideBar strong').textContent(),vessel.name);
      await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange')); });
      const callsBefore = rides;
      await page.clock.runFor(31000);
      assert.equal(rides,callsBefore,'ride polling stops in background');
      await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForSelector('#rideView:not([hidden])');
      await page.reload();
      await page.waitForSelector('#rideView:not([hidden])');
      assert.equal(await page.locator('#rideHeading h1').textContent(),vessel.name);
      await page.locator('#rideMinimize').click();
      await page.locator('#mapButton').click();
      await page.locator('.boat-row').last().click();
      await page.locator('[data-ride-boat]').click();
      await page.waitForSelector('#ridePicker[open]');
      assert.match(await page.locator('#ridePickerTitle').textContent(),/Switch/);
      await page.locator('[data-vessel-id="bay-hopper"]').click();
      await page.waitForFunction(() => document.querySelector('#rideHeading h1').textContent === 'Bay Hopper');
      await page.waitForFunction(() => document.querySelector('#rideSpeed').textContent === '12.3 kn');
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector('#rideView:not([hidden])');
      assert.equal(await page.locator('#rideHeading h1').textContent(),other.name);
      assert.match(await page.locator('#rideETA').textContent(), /10:10 scheduled/);
      assert.equal(await page.locator('#rideSpeed').textContent(),'—');
      await context.setOffline(false);
      await page.reload();
      await page.waitForSelector('#rideView:not([hidden])');
      if (base === '/') {
        for (const theme of THEMES) for (const width of [320,390,821,1440]) {
          await page.setViewportSize({width,height:900});
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme.id);
          const metrics = await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,content:document.querySelector('#rideView').scrollWidth>document.querySelector('#rideView').clientWidth}));
          assert(!metrics.overflow && !metrics.content,JSON.stringify({theme:theme.id,width,metrics}));
          results.push({theme:theme.id,width,passed:true});
        }
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(()=>document.documentElement.dataset.theme='nyc-ferry');
        await page.screenshot({path:path.join(ARTIFACTS,'riding-phone.png')});
        await page.evaluate(()=>document.documentElement.style.fontSize='24px');
        assert(await page.evaluate(()=>document.querySelector('#rideView').scrollWidth<=innerWidth));
        await page.evaluate(()=>document.documentElement.style.fontSize='');
        await page.setViewportSize({width:1440,height:900});
        await page.screenshot({path:path.join(ARTIFACTS,'riding-desktop.png')});
      }
      delayed = true;
      const lateResponse = page.waitForResponse(response => response.url().includes('/api/ride?'));
      await page.clock.runFor(15000);
      await page.locator('#rideExit').click();
      await lateResponse;
      delayed = false;
      await page.waitForSelector('#mapView:not([hidden])');
      assert.equal(await page.locator('#rideBar').isVisible(),false);
      assert.equal(await page.evaluate(()=>localStorage.getItem('nyc-ferry-did-ride-v1')),null);
      await page.goto(site.origin + base + 'ride');
      await page.waitForSelector('#boardView:not([hidden])');
      // Without a confirmed assignment the departure opens the picker, never guesses.
      confirmed=false;
      await page.goto(site.origin + base + '?landing=16');
      await page.waitForSelector(`[data-trip-id="${sailing.tripId}"]`);
      await page.locator(`[data-trip-id="${sailing.tripId}"]`).first().click();
      await page.locator('#tripRide').click();
      await page.waitForSelector('#ridePicker[open]');
      await page.locator('#rideSearch').fill('H-204');
      await page.waitForSelector('[data-vessel-id="opportunity"]');
      assert.equal(await page.locator('#rideChoices button').count(),1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#ridePicker').evaluate(n=>n.open),false);
      await page.locator('#mapButton').click();
      await page.locator('#mapMenuButton').click();
      await page.locator('.route-filter-pill').filter({hasText:'East River'}).click();
      await page.locator('#routeRide').click();
      await page.waitForSelector('#ridePicker[open]');
      await page.locator('#ridePickerClose').click();
      confirmed=true;
      assert.deepEqual(errors,[]);
      await context.tracing.stop({path:path.join(ARTIFACTS,`riding-${base === '/' ? 'root' : 'prefix'}-trace.zip`)});
      await context.close();
    }
    await fs.writeFile(path.join(ARTIFACTS,'riding-results.json'),JSON.stringify({passed:true,checks:results},null,2));
    console.log(`Riding mode: passed both deployment paths and ${results.length} theme/viewport combinations`);
  } catch (error) {
    console.error(await lastPage?.locator('body').innerText().catch(()=>''));
    await lastPage?.screenshot({path:path.join(ARTIFACTS,'riding-failure.png')}).catch(()=>{});
    await lastContext?.tracing.stop({path:path.join(ARTIFACTS,'riding-failure-trace.zip')}).catch(()=>{});
    throw error;
  } finally { await browser?.close(); await site.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
