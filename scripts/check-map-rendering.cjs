// Behavior requiring real retained DOM nodes, SVG transforms, and animation frames.
const assert = require('node:assert/strict');
const { check } = require('./mobile-check-harness.cjs');
const { instrumentMap, mapEvaluate, mapWaitFor } = require("./map-test-scope.cjs");
const fixture = require('./map-browser-fixture.cjs');
(async () => {
  const { harbor, positions } = await fixture();
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await check(`map rendering ${viewport.width}`, {
      context: { viewport }, api: { '/api/map': harbor, '/api/boats': positions }
    }, async ({ page, site }) => {
      await page.route(/^https:\/\//, route => route.fulfill({ contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
      await page.route("**/assets/map.js*", async route => {
        const source = await require("node:fs/promises").readFile("public/assets/map.js", "utf8");
        await route.fulfill({ contentType: "text/javascript", body: instrumentMap(source) });
      });
      await page.goto(`${site.origin}/map`);
      await page.waitForSelector('.boat');
      await page.evaluate(() => document.fonts.ready);
      const result = await mapEvaluate(page, async () => {
        const expect = (condition, message) => { if (!condition) throw new Error(message); };
        const frame = () => new Promise(requestAnimationFrame);
        const settle = () => new Promise(resolve => setTimeout(resolve, 140));
        const chart = document.querySelector('#chart');
        let renders = 0;
        const originalApply = applyView;
        applyView = (...args) => { renders++; return originalApply(...args); };
        let layouts = 0;
        const originalLayout = layoutStreetLabels;
        layoutStreetLabels = (...args) => { layouts++; return originalLayout(...args); };
        await settle();
        setView({ x: base.width * .3, y: base.height * .3, width: base.width / 4 });
        await frame();
        const start = renders;
        setView({ ...view, x: view.x + 1 });
        setView({ ...view, x: view.x + 1 });
        setView({ ...view, x: view.x + 1 });
        expect(renders === start, 'camera writes wait for a frame');
        await frame();
        expect(renders === start + 1, 'multiple camera changes coalesce into one render');

        let scaleWrites = 0;
        const observer = new MutationObserver(records => {
          scaleWrites += records.filter(r => r.attributeName === 'transform' && r.target.classList.contains('scaler')).length;
        });
        observer.observe(chart, { subtree: true, attributes: true });
        setView({ ...view, x: view.x + .01 });
        await frame();
        await Promise.resolve();
        observer.disconnect();
        expect(scaleWrites === 0, 'panning does not rewrite unchanged marker scales');

        // A new gesture can begin while the previous camera change is still queued.
        const capture = chart.setPointerCapture.bind(chart);
        chart.setPointerCapture = id => { try { capture(id); } catch {} };
        const gestureBox = chart.getBoundingClientRect();
        setView({ ...view, width: base.width / 6 });
        const queuedX = view.x;
        const queuedUnits = Math.max(renderedView.width / viewport.width, renderedView.height / viewport.height) *
          view.width / renderedView.width;
        chart.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 6,
          clientX: gestureBox.x + 100, clientY: gestureBox.y + 100 }));
        chart.dispatchEvent(new PointerEvent('pointermove', { pointerId: 6,
          clientX: gestureBox.x + 110, clientY: gestureBox.y + 100 }));
        expect(Math.abs(view.x - (queuedX - 10 * queuedUnits)) < .02, 'queued zoom does not make a new drag jump');
        chart.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 6 }));
        await frame();

        // Cancel before the cadence permits another street pass, then verify the final pass.
        const box = chart.getBoundingClientRect();
        chart.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, clientX: box.x + 100, clientY: box.y + 100 }));
        forceStreetLayout = false;
        lastStreetLayout = performance.now();
        let before = layouts;
        setView({ ...view, x: view.x + 1 });
        await frame();
        expect(layouts === before, 'street layout is throttled during gestures');
        chart.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 5 }));
        await frame();
        expect(layouts === before + 1, 'pointer cancellation forces final street placement');
        animateTo({ ...view, x: view.x + 10 }, 1000);
        await frame();
        before = layouts;
        cancelCameraAnimation();
        await frame();
        expect(layouts === before + 1, 'animation cancellation forces final street placement');
        chart.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1,
          clientX: box.x + 100, clientY: box.y + 100 }));
        await frame();
        before = layouts;
        await settle();
        expect(layouts > before && wheelTimer === null, 'wheel quiet period forces final street placement');

        // Hidden marker caches may have an old scale; returning markers must never paint it.
        setView({ x: 0, y: 0, width: base.width / 16 });
        await frame();
        const hidden = streetLabels.find(entry => !entry.feature.visible);
        expect(hidden, 'offscreen street labels are culled');
        const culled = features.filter(feature => !feature.visible).length;
        expect(features.some(f => !f.visible && !f.scaler), 'static paths are culled too');
        const width = base.width / 8;
        const height = width * base.height / base.width;
        view = { x: hidden.x - width / 2, y: hidden.y - height / 2, width, height };
        scheduleView();
        await frame();
        const scale = Math.max(view.width / viewport.width, view.height / viewport.height).toFixed(3);
        expect(hidden.feature.visible && hidden.feature.nodes[0].style.display !== 'none', 'offscreen marker returns');
        expect(hidden.feature.scaler.getAttribute('transform') === `scale(${scale})`, 'returning marker has current scale');
        const area = visibleArea(Number(scale));
        const matrix = chart.getScreenCTM().inverse();
        const corner = new DOMPoint(box.left, box.top).matrixTransform(matrix);
        expect(Math.abs(corner.x - area.left) < 1 && Math.abs(corner.y - area.top) < 1,
          'culling area includes actual letterboxed SVG area');

        // Threshold crossing changes marker details, without touching the card or roster.
        select(boats[0].id, { recentre: false });
        await frame();
        const row = document.querySelector('.boat-row');
        const boat = document.querySelector('.boat');
        const scaler = boat.querySelector('.scaler');
        row.focus();
        const card = document.querySelector('#vesselCard');
        let cardWrites = 0, listWrites = 0;
        const cardObserver = new MutationObserver(records => cardWrites += records.length);
        const listObserver = new MutationObserver(records => listWrites += records.length);
        cardObserver.observe(card, { subtree: true, attributes: true, childList: true, characterData: true });
        listObserver.observe(document.querySelector('#boats'), { subtree: true, attributes: true, childList: true, characterData: true });
        setView({ ...base, width: base.width / 2 });
        await frame();
        setView({ ...base, width: base.width / 3 });
        await frame();
        cardObserver.disconnect(); listObserver.disconnect();
        expect(cardWrites === 0 && listWrites === 0, 'threshold crossing leaves the card and roster intact');
        expect(boat === document.querySelector('.boat'), 'threshold crossing retains boat identity');
        expect(boat.querySelector('.boat-number').style.display === '', 'close vessels have hull numbers');
        const scroll = document.querySelector('.sheet-scrollable');
        scroll.scrollTop = 70;
        const scrollTop = scroll.scrollTop;
        applyPositions({ available: true, boats: boats.map((b, i) => ({ ...b, latitude: b.latitude + .0001 * (i + 1) })) });
        await frame();
        expect(boat === document.querySelector('.boat') && scaler === fleetScalers[0], 'polling caches reference retained markers');
        expect(document.activeElement === row && scroll.scrollTop === scrollTop, 'polling preserves focus and scroll');
        expect(boat.querySelector('.boat-halo') && !card.hidden, 'polling preserves selection');
        setView({ ...view, width: base.width / 5 });
        await frame();
        expect(scaler.getAttribute('transform') === `scale(${Math.max(view.width / viewport.width, view.height / viewport.height).toFixed(3)})`,
          'retained fleet scaler receives subsequent zoom updates');

        // Geometry changes invalidate every static reference and redraw the current fleet.
        const oldFeatures = features;
        harbor = { ...harbor, chart: { ...harbor.chart, generatedAt: 'cache-refresh-test' } };
        drawHarbor();
        await frame();
        expect(oldFeatures.every(f => f.nodes.every(node => !node.isConnected)), 'old geometry is detached');
        expect(features.every(f => f.nodes.every(node => node.isConnected)), 'geometry caches contain current nodes');
        expect(streetLabels.every(e => e.label.isConnected) && dockLabels.every(e => e.label.isConnected), 'label caches refresh with geometry');
        expect(fleetScalers.length === boats.length && fleetScalers.every(node => node.isConnected), 'geometry refresh redraws the fleet');
        return { culled, renders, layouts };
      });
      assert(result.culled > 0);
      await page.setViewportSize({ width: viewport.width + 80, height: viewport.height - 80 });
      await mapWaitFor(page, () => {
        const box = chart.getBoundingClientRect();
        return Math.abs(viewport.width - box.width) < 1 && Math.abs(viewport.height - box.height) < 1 &&
          fleetScalers.every(node => node.getAttribute('transform') ===
            `scale(${Math.max(view.width / viewport.width, view.height / viewport.height).toFixed(3)})`);
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert(await mapEvaluate(page, async () => {
        animateTo({ ...base, width: base.width / 5 });
        await new Promise(requestAnimationFrame);
        return cameraAnimation === null && view.width === base.width / 5;
      }), 'reduced motion applies the destination without animation');
      assert(await mapEvaluate(page, async () => {
        harbor = { ...harbor, chart: null };
        drawHarbor();
        await new Promise(requestAnimationFrame);
        return !chartBackdrop && tileLayer.querySelectorAll('image').length > 0 && fleetScalers.every(node => node.isConnected);
      }), 'raster fallback still draws tiles and boats');
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
