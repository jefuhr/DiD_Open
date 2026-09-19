// Exercise real date navigation against local builds, with live network feeds stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { serve } = require('./mobile-check-harness.cjs');

(async () => {
  const { buildDisplayData } = await import('./build-data.js');
  const boards = new Map(await Promise.all([9,16,17,27].map(async n=>[n,await buildDisplayData({landingNumber:n})])));
  const site = await serve({ api: {
    '/api/display-data': url => boards.get(Number(url.searchParams.get('landingId')) || 27),
    '/api/landings': { landings:[], operators:[] },
    '/api/realtime': { available:true, stale:true, updates:[], vehicles:[] },
    '/api/alerts': { available:true, alerts:[] },
    '/api/override': {},
    '/api/changelog': { entries:[] }
  }});
  let browser;
  const results=[];
  try {
    browser = await chromium.launch({headless:true});
    await fs.mkdir('docs/schedule-comparison',{recursive:true});
    for (const width of [390,1440]) {
      for (const landing of [27,16,17,9]) {
        const context = await browser.newContext({ viewport:{width,height:900}, serviceWorkers:'block' });
        const page = await context.newPage(), errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(() => {
          const Real=Date;
          globalThis.Date=class extends Real { constructor(...args){super(...(args.length?args:['2026-09-19T04:00:00Z']));} static now(){return +new Real('2026-09-19T04:00:00Z');} };
          localStorage.setItem('nyc-ferry-did-sort','time');
        });
        await page.route('**/app.js*', async route => route.fulfill({contentType:'text/javascript',
          body: await fs.readFile('public/app.js','utf8') + '\n' +
            'globalThis.__weekendCheck = () => ({date:viewFrame().dateKey, rows:routeDirectionGroups(new Date(),Infinity).flatMap(g=>g.departures)});'
        }));
        await page.goto(`${site.origin}/?landing=${landing}`);
        await page.waitForFunction(()=>document.querySelector('#boardNote').textContent.includes('Weekend crew schedule loaded'));
        await page.evaluate(()=>document.fonts.ready);
        const read = () => page.evaluate(()=>({
          ...globalThis.__weekendCheck(),
          overflow:document.documentElement.scrollWidth>innerWidth,
          note:document.querySelector('#boardNote').textContent
        }));
        for (let offset=0;offset<9;offset++) {
          const state=await read();
          assert.equal(state.overflow,false,`${width} ${landing} ${state.date}`);
          const weekend=['2026-09-19','2026-09-20','2026-09-26','2026-09-27'].includes(state.date);
          const cruise=['2026-09-19','2026-09-26','2026-09-27'].includes(state.date);
          if (landing===27 && weekend) {
            assert.equal(state.rows.filter(r=>r.crewShuttle).length,5,state.date);
            assert.equal(state.rows.filter(r=>r.routeId==='SB'&&r.boatAssignment===3).length,cruise?1:0,state.date);
          }
          if (weekend) assert.match(state.note,/Weekend crew schedule loaded/);
          if (landing===17 && weekend) assert.equal(state.rows.filter(r=>r.routeId==='SB'&&r.boatAssignment===3).length,cruise?11:0,state.date);
          if (landing===9 && weekend) assert.equal(state.rows.filter(r=>r.crewShuttle).length,1,state.date);
          if (landing===16 && weekend) assert.equal(state.rows.filter(r=>r.crewShuttle).length,4,state.date);
          if (offset===0 || offset===1 || offset===7) results.push({width,landing,date:state.date,rows:state.rows.length,overflow:state.overflow});
          if (offset===0) await page.screenshot({path:`docs/schedule-comparison/weekend-${landing}-${width}.png`,fullPage:true});
          if (offset<8) {
            await page.click('#dateNext');
            await page.waitForFunction(date=>globalThis.__weekendCheck().date!==date,state.date);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          }
        }
        assert.deepEqual(errors,[]);
        await context.close();
      }
    }
    await fs.writeFile('docs/schedule-comparison/weekend-browser-checks.json',JSON.stringify(results,null,2)+'\n');
    console.log(`Passed ${results.length} recorded browser checks across four landings and two viewport sizes.`);
  } finally { await browser?.close(); await site.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
