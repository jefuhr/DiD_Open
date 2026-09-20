// Run both revisions on this machine: npm run benchmark:map -- --baseline <git-ref>
// Instrumentation is injected here; none is shipped in map.js. Camera time is inclusive,
// outermost applyView JS time. Frame intervals include browser style/layout/paint and scheduling.
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { serve, PHONE } = require('./mobile-check-harness.cjs');
const { instrumentMap, mapEvaluate } = require("./map-test-scope.cjs");
const fixture = require('./map-browser-fixture.cjs');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const runs = Number(option('--runs', 5));
const baseline = option('--baseline', null);
const output = option('--output', 'artifacts/browser/map-performance.json');
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] || 0;
(async () => {
  const { harbor, positions } = await fixture();
  const site = await serve({ api: { '/api/map': harbor, '/api/boats': positions } });
  let browser;
  const results = [];
  try {
    browser = await chromium.launch();
    const current = await fs.readFile('public/assets/map.js', 'utf8');
    const versions = baseline ? [
      ['before', execFileSync('git', ['show', `${baseline}:public/assets/map.js`], { encoding: 'utf8' })],
      ['after', current]
    ] : [['after', current]];
    for (const [viewportName, viewport] of [['phone', PHONE.viewport], ['desktop', { width: 1280, height: 800 }]]) {
      for (const rate of [1, 4]) for (let run = 1; run <= runs; run++) {
        // Alternate execution order to reduce warm-machine/order bias.
        for (const [version, source] of run % 2 ? versions : [...versions].reverse()) {
          const context = await browser.newContext({ ...PHONE, viewport, isMobile: viewportName === 'phone', hasTouch: viewportName === 'phone' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.route('**/assets/map.js*', route => route.fulfill({ contentType: 'text/javascript', body: instrumentMap(source) }));
          await page.route(/^https:\/\//, route => route.abort());
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate });
          await page.goto(`${site.origin}/map`);
          await page.waitForSelector('.boat');
          await page.evaluate(async () => {
            await document.fonts.ready;
            const text = document.createRange();
            text.selectNodeContents(document.querySelector('#zoomFit'));
            if (text.getBoundingClientRect().width < 10) throw new Error('Browser fonts are unavailable; configure fontconfig before benchmarking');
          });
          await page.waitForTimeout(200);
          const samples = await mapEvaluate(page, async () => {
            const chart = document.querySelector('#chart');
            const original = applyView;
            let recording = null, depth = 0;
            applyView = function (...args) {
              const outer = depth++ === 0;
              const start = performance.now();
              try { return original(...args); }
              finally { depth--; if (outer && recording) recording.js.push(performance.now() - start); }
            };
            // Synthetic samples run in the page to avoid measuring automation round trips.
            const capture = chart.setPointerCapture.bind(chart);
            chart.setPointerCapture = id => { try { capture(id); } catch {} };
            const frame = () => new Promise(requestAnimationFrame);
            const pointer = (type, id, x, y) => chart.dispatchEvent(new PointerEvent(type,
              { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y }));
            const waitFrames = async (duration, step = () => {}) => {
              const start = performance.now();
              let prev = await frame();
              while (performance.now() - start < duration) {
                const now = await frame();
                if (recording) recording.frames.push(now - prev);
                prev = now;
                step(Math.min(1, (now - start) / duration));
              }
            };
            const reset = async (zoom = 5) => {
              cancelCameraAnimation();
              setView({ x: base.width * .3, y: base.height * .25, width: base.width / zoom });
              await waitFrames(130);
            };
            const samples = {};
            const record = async (name, action) => {
              recording = { js: [], frames: [] };
              await action();
              samples[name] = recording;
              recording = null;
            };
            const box = chart.getBoundingClientRect();
            const x = box.x + box.width / 2, y = box.y + box.height / 2;
            await reset();
            await record('drag', async () => {
              pointer('pointerdown', 1, x, y);
              await waitFrames(600, t => pointer('pointermove', 1, x + 80 * t, y + 20 * t));
              pointer('pointercancel', 1, x + 80, y + 20);
              await frame();
            });
            await reset();
            await record('pinch', async () => {
              pointer('pointerdown', 1, x - 45, y);
              pointer('pointerdown', 2, x + 45, y);
              await waitFrames(600, t => {
                pointer('pointermove', 1, x - 45 - 60 * t, y);
                pointer('pointermove', 2, x + 45 + 60 * t, y);
              });
              pointer('pointercancel', 2, x + 105, y);
              pointer('pointercancel', 1, x - 105, y);
              await frame();
            });
            await reset();
            pointer('pointerdown', 1, x, y);
            pointer('pointermove', 1, x - 120, y);
            // A throttled browser may deliver too few pointer samples for a real flick.
            // Seed the same two-sample velocity in each revision, then use its normal
            // release handler and glide. This measures inertia, never an idle viewport.
            const releaseTime = Date.now();
            pointerHistory = [{ x, y, time: releaseTime - 60 }, { x: x - 120, y, time: releaseTime }];
            await record('inertia', async () => {
              pointer('pointerup', 1, x - 120, y);
              if (!cameraAnimation) throw new Error('The inertia fixture did not start a glide');
              await waitFrames(950);
            });
            await reset(2);
            await record('threshold-zoom', async () => {
              animateTo({ x: view.x, y: view.y, width: base.width / 3 }, 360);
              await waitFrames(400);
              animateTo({ x: view.x, y: view.y, width: base.width / 2 }, 360);
              await waitFrames(400);
            });
            await reset(1);
            await record('selection', async () => {
              select(boats[12].id);
              await waitFrames(450);
            });
            return { samples, elements: chart.querySelectorAll('*').length, labels: chart.querySelectorAll('.street-label').length };
          });
          if (errors.length) throw new Error(errors.join('\n'));
          for (const [scenario, data] of Object.entries(samples.samples)) {
            if (!data.js.length || (scenario === 'inertia' && data.js.length < 5)) throw new Error(`Insufficient camera work measured for ${scenario}`);
            results.push({ version, viewport: viewportName, rate, run, scenario, elements: samples.elements,
              labels: samples.labels, cameraMedianMs: percentile(data.js, .5), cameraP95Ms: percentile(data.js, .95),
              frameP95Ms: percentile(data.frames, .95), cameraSamples: data.js, frameSamples: data.frames });
          }
          await context.close();
          console.log(`${version} ${viewportName} ${rate}x run ${run}/${runs}`);
        }
      }
    }
    const summary = [];
    for (const version of [...new Set(results.map(r => r.version))]) for (const viewport of ['phone', 'desktop']) for (const rate of [1, 4]) {
      const rows = results.filter(r => r.version === version && r.viewport === viewport && r.rate === rate);
      summary.push({ version, viewport, rate, cameraMedianMs: percentile(rows.flatMap(r => r.cameraSamples), .5),
        frameP95Ms: percentile(rows.flatMap(r => r.frameSamples), .95) });
    }
    await fs.mkdir(require('node:path').dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify({ date: new Date().toISOString(), baseline, runs, browser: browser.version(),
      platform: `${process.platform}/${process.arch}`, cpu: require('node:os').cpus()[0]?.model, summary, results },
      (_key, value) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value, 2) + '\n');
    console.table(summary);
  } finally { await browser?.close(); await site.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
