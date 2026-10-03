import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplayData } from '../lib/schedule-builder.js';
import { activeServices } from '../public/assets/schedule.js';

test('NY Waterway departures continue after the October 1 feed rollover', async () => {
  for (const [landingNumber, date] of [[26,'2026-10-03'],[25,'2026-10-04'],[16,'2026-10-05']]) {
    const data = await buildDisplayData({landingNumber});
    const active = activeServices(data,date);
    const rows = data.departures.filter(row=>row.routeId.startsWith('wtr:') && active.has(row.serviceId));
    assert.ok(rows.length > 10, `${landingNumber} has NY Waterway ferries on ${date}`);
    assert.ok(rows.every(row=>row.mode==='ferry'));
  }
});
