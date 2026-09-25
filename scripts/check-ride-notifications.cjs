const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve, ARTIFACTS } = require('./mobile-check-harness.cjs');

async function main() {
  const { buildDisplayData } = await import('../lib/schedule-builder.js');
  const schedule = await buildDisplayData({ landingNumber: 16 });
  let notification = null;
  const writes = [], vessel = { id: 'opportunity', name: 'Opportunity', number: 'H-204' };
  const site = await serve({ api: {
    '/api/display-data': schedule, '/api/landings': { landings: [{id:16,displayName:'Pier 11'}] },
    '/api/alerts': {available:true,alerts:[]}, '/api/changelog': {entries:[]}, '/api/realtime': {available:false,updates:[]}, '/api/connections': {stops:[]},
    '/api/map': { bounds:{south:40,north:41,west:-75,east:-73}, routes:[], landings:[] }, '/api/vessels': {vessels:[vessel]}, '/api/boats': {boats:[]},
    '/api/ride': { vessel, date:'2026-09-24', timezone:'America/New_York', stale:true, positionStale:true, trips:[] },
    '/api/ride-notifications/config': {available:true,publicKey:'AQID'},
    '/api/ride-notifications': async (url, request) => {
      if (request.method === 'PUT') { let body=''; for await (const chunk of request) body += chunk; const data=JSON.parse(body); notification={enabled:true,vesselId:data.vesselId}; writes.push(data); }
      if (request.method === 'DELETE') notification=null;
      return {notification};
    }
  }});
  await fs.mkdir(ARTIFACTS,{recursive:true});
  const browser = await chromium.launch();
  const results = [];
  let lastPage, lastContext;
  try {
    for (const base of ['/', '/ferryTimesMobile/']) {
      const context = await browser.newContext({viewport:{width:390,height:844},permissions:['notifications']});
      await context.tracing.start({screenshots:true,snapshots:true,sources:true});
      const errors = [];
      await context.addInitScript(({base,vessel}) => {
        if (!localStorage.getItem('notification-test-started')) {
          localStorage.setItem('notification-test-started','1');
          localStorage.setItem('nyc-ferry-did-ride-v1',JSON.stringify({version:1,vesselId:vessel.id,name:vessel.name,number:vessel.number,returnURL:base}));
        }
        // This headless build reports Notification.permission as denied even after a granted
        // Playwright permission override. Keep the permission and push-registration doubles
        // consistent; physical permission prompts and lock-screen delivery need device testing.
        Object.defineProperty(Notification, 'permission', {configurable:true,get:()=>localStorage.getItem('mock-denied') ? 'denied' : 'granted'});
        Notification.requestPermission = async () => Notification.permission;
        const sub = { toJSON: () => ({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{}}), unsubscribe: async () => {localStorage.removeItem('mock-push');return true;} };
        PushManager.prototype.getSubscription = async function() {return localStorage.getItem('mock-push') ? sub : null;};
        PushManager.prototype.subscribe = async function() {localStorage.setItem('mock-push','1');return sub;};
      },{base,vessel});
      const page = await context.newPage();
      lastPage = page; lastContext = context;
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(site.origin+base+'ride');
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await page.waitForSelector('#rideNotifications:not([disabled])');
      assert.equal(await page.locator('#rideNotifications').getAttribute('aria-pressed'),'false');
      await page.locator('#rideNotifications').click();
      await page.waitForSelector('#rideNotifications[aria-pressed="true"]:not([disabled])');
      assert.equal(writes.at(-1).base,base);
      await page.locator('#rideMinimize').click();
      await page.waitForSelector('#rideBar:not([hidden])');
      assert.equal(notification.vesselId,vessel.id,'minimizing keeps the subscription');
      await page.reload();
      await page.waitForSelector('#rideNotifications[aria-pressed="true"]:not([disabled])');
      await page.screenshot({path:path.join(ARTIFACTS,`ride-notifications-${base==='/'?'root':'prefix'}.png`)});
      for (const width of [320,390,821,1440]) {
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await page.locator('#rideNotifications').click();
      await page.waitForSelector('#rideNotifications[aria-pressed="false"]:not([disabled])');
      assert.equal(notification,null);
      await page.evaluate(()=>localStorage.setItem('mock-denied','1'));
      await page.locator('#rideNotifications').click();
      await page.waitForFunction(()=>document.querySelector('#rideNotificationNote').textContent.includes('settings'));
      assert.equal(notification,null,'denied permission never subscribes');
      await page.evaluate(()=>localStorage.removeItem('mock-denied'));
      await page.locator('#rideNotifications').click();
      await page.waitForSelector('#rideNotifications[aria-pressed="true"]:not([disabled])');
      await page.locator('#rideExit').click();
      await page.waitForSelector('#boardView:not([hidden])');
      assert.equal(notification,null,'exit removes the server subscription');
      assert.equal(await page.evaluate(()=>localStorage.getItem('mock-push')),null);
      assert.deepEqual(errors,[]);
      results.push({base,passed:true});
      await context.tracing.stop({path:path.join(ARTIFACTS,`ride-notifications-${base==='/'?'root':'prefix'}-trace.zip`)});
      await context.close();
    }
    await fs.writeFile(path.join(ARTIFACTS,'ride-notifications-results.json'),JSON.stringify({passed:true,transport:'Permission and push registration mocked; real app and service worker installed',checks:results},null,2));
    console.log('Departure notification controls passed both deployment paths, persistence, minimize, off, exit, and four viewport sizes.');
  } catch (error) {
    console.error(await lastPage?.locator('#rideNotificationNote').textContent().catch(()=>''));
    await lastPage?.screenshot({path:path.join(ARTIFACTS,'ride-notifications-failure.png')}).catch(()=>{});
    await lastContext?.tracing.stop({path:path.join(ARTIFACTS,'ride-notifications-failure-trace.zip')}).catch(()=>{});
    throw error;
  } finally {await browser.close();await site.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
