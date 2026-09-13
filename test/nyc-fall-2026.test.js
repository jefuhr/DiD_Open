import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDisplayData, parseCsv } from '../scripts/build-data.js';
import { activeServices, createConnectionIndex, nextDepartures, tripConnections } from '../lib/connections.js';
import { calendarTurnaroundLayovers } from '../scripts/out-of-service.js';
import { holidayDepartures } from '../scripts/nyc-fall-2026.js';

const root = new URL('../', import.meta.url);
const csv = async (name) => parseCsv(await readFile(new URL(`gtfs/${name}.txt`, root), 'utf8'));
const source = JSON.parse(await readFile(new URL('schedules/sukkot-2026.json', root), 'utf8'));
const pier11 = await buildDisplayData({ landingNumber: 16, busesEnabled: true });
const index = createConnectionIndex(new Map([[16, pier11]]));
const trips = await csv('trips');
const activeTrips = (date) => trips.filter(t => activeServices(index, date).has(t.service_id));
const count = (date, route) => activeTrips(date).filter(t => t.route_id === route).length;

test('fall switches on September 14 and expires after November 1', () => {
  assert.equal(count('2026-09-13', 'ER'), 103);
  assert.equal(count('2026-09-14', 'ER'), 94);
  assert.equal(count('2026-09-20', 'ER'), 98);
  const weekday = activeTrips('2026-09-14');
  for (const [route, expected] of Object.entries({ ER:94, RS:39, SB:38, AS:39, SG:44, RES:26, RWS:26 })) {
    assert.equal(weekday.filter(t => t.route_id === route).length, expected, route);
  }
  assert.equal(weekday.some(t => ['GI','RR'].includes(t.route_id)), false);
  assert.ok(activeTrips('2026-11-01').length > 0);
  assert.equal(activeTrips('2026-11-02').length, 0);
});

test('modified South Brooklyn service runs only on the ten published cruise dates', async () => {
  const dates = new Set(['2026-09-19','2026-09-26','2026-09-27','2026-10-03','2026-10-10','2026-10-11','2026-10-17','2026-10-24','2026-10-31','2026-11-01']);
  for (let day = new Date('2026-09-14T12:00:00Z'); day <= new Date('2026-11-01T12:00:00Z'); day.setUTCDate(day.getUTCDate()+1)) {
    if (![0,6].includes(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0,10);
    assert.equal(count(date, 'SB'), dates.has(date) ? 51 : 30, date);
  }
  const stopTimes = await csv('stop_times');
  for (const service of ['7','8']) {
    const shuttle = trips.filter(t => t.service_id === service);
    assert.equal(shuttle.length,21);
    const departures = [];
    for (const trip of shuttle) {
      const calls = stopTimes.filter(s => s.trip_id === trip.trip_id).sort((a,b) => +a.stop_sequence - +b.stop_sequence);
      assert.deepEqual(calls.map(s => s.stop_id).sort(),['24','87'], 'Red Hook–Pier 11 point-to-point shuttle');
      departures.push(calls[0].departure_time);
    }
    departures.sort();
    assert.equal(departures[0],'07:22:00');
    assert.equal(departures.at(-1),'12:22:00');
  }
});

test('all active fall ferry trips have captain boat assignments', async () => {
  const { assignments } = JSON.parse(await readFile(new URL('content/boat-assignments.json', root), 'utf8'));
  for (const date of ['2026-09-14','2026-09-19','2026-09-20','2026-09-26']) {
    for (const trip of activeTrips(date).filter(t => !['GI','RES','RWS'].includes(t.route_id))) {
      assert.ok(Number.isInteger(assignments[trip.trip_short_name]), `${date}: ${trip.route_id} ${trip.trip_short_name}`);
    }
  }
});

test('Sukkot replaces all ordinary NYC Ferry services only on its five dates', () => {
  for (const date of source.dates) {
    assert.equal(activeTrips(date).length, 0, date);
    assert.ok(activeServices(index,date).has('nyc:sukkot:2026'));
  }
  for (const date of ['2026-09-27','2026-10-03','2026-11-02']) assert.equal(activeServices(index,date).has('nyc:sukkot:2026'),false);
  assert.equal(count('2026-10-03','ER'),98);
});

test('holiday departure columns preserve all printed boarding times without fabricating trips', async () => {
  const stopsById = new Map((await csv('stops')).map(s => [s.stop_id,s]));
  const rows = holidayDepartures({ source, selectedStops: new Set(stopsById.keys()), stopsById, agency:'NYC Ferry', busesEnabled:true });
  for (const [route, expected] of Object.entries({ ER:578, SB:230, RS:301, AS:222, SG:215, GI:52, RES:117, RWS:91 })) {
    assert.equal(rows.filter(r => r.routeId === route).length,expected,route);
  }
  assert.equal(new Set(rows.map(r => r.tripId)).size,rows.length);
  for (const row of rows) {
    assert.ok(row.scheduleOnly && row.timetableOnly);
    assert.equal(row.boatAssignment,null);
    assert.equal(row.nextStop,null);
    assert.ok(row.seconds >= 4*3600 && row.seconds < 24*3600);
  }
  const has = (route,stop,time) => rows.some(r => r.routeId===route && r.stopId===stop && r.departureTime===time);
  assert.ok(has('ER','4','06:06:00'), 'partial first sailing from Hunters Point');
  assert.ok(has('ER','18','07:05:00'), 'do not drop Greenpoint when the printed arrival column is blank');
  assert.ok(has('SB','87','07:07:00'));
  assert.equal(has('SB','87','07:03:00'),false,'Pier 11 arrival is not boarding');
  assert.ok(has('GI','87','16:26:00'),'PDF time preserved despite conflicting blog prose');
  assert.ok(has('GI','111','17:15:00'));
  assert.ok(has('RES','16','15:29:00'));
  assert.ok(has('RWS','16','19:06:00'));
});

test('holiday rows cannot acquire live estimates, vessels or through-trip connections', () => {
  const row = pier11.departures.find(r => r.scheduleOnly && r.seconds > 12*3600);
  assert.ok(row);
  const result = nextDepartures({ index, stopId:'87', now:new Date('2026-09-28T16:00:00Z'), limit:10000,
    updates:new Map([[`${row.tripId}|87`,{delaySeconds:600}]]),
    vehicles:new Map([[row.tripId,{boatName:'Wrong hull'}]]) });
  const found = result.find(r => r.tripId === row.tripId);
  assert.ok(found);
  assert.equal(found.hasLiveTiming,false);
  assert.equal(found.boatName,null);
  assert.equal(found.predictedBoatName,null);
  assert.equal(tripConnections({index,tripId:row.tripId}),null);
});

test('unconfirmed crew data generates a notice but no operational claims', async () => {
  for (const landingNumber of [8,16,17,18,22,27]) {
    const data = await buildDisplayData({landingNumber});
    assert.equal(data.meta.crewScheduleStatus.message,'Crew shifts / Pier C shuttles: UNCONFIRMED');
    assert.equal(data.departures.some(r => r.crewShuttle || r.endsShift || r.tripId.startsWith('oos:') || r.fromHomePort),false);
    if (landingNumber===27) assert.equal(data.departures.length,0);
  }
});

test('holiday bus departures respect the existing bus switch', async () => {
  const on = await buildDisplayData({landingNumber:18,busesEnabled:true});
  const off = await buildDisplayData({landingNumber:18,busesEnabled:false});
  assert.equal(on.departures.filter(r => r.scheduleOnly && r.mode==='bus').length,26);
  assert.equal(off.departures.some(r => r.mode==='bus'),false);
});

test('turnarounds merge simultaneous services and reject date-dependent next trips', () => {
  const cal = (id, start='20260914', end='20260915') => ({service_id:id,start_date:start,end_date:end,monday:'1',tuesday:'1'});
  const run = (tripId, serviceId, start, end) => ({tripId,serviceId,routeId:'ER',boat:1,startSeconds:start,endSeconds:end,startStopId:'87',endStopId:'87'});
  const a=run('a','1',3600,4000),b=run('b','2',4300,4600),c=run('c','1',5000,5400);
  const runs=new Map([['1',[a,c]],['2',[b]]]);
  const links=calendarTurnaroundLayovers({runs,calendars:[cal('1'),cal('2')]});
  assert.equal(links.get('a').nextTripId,'b');
  assert.equal(links.get('b').nextTripId,'c');
  const varying=calendarTurnaroundLayovers({runs,calendars:[cal('1'),cal('2','20260914','20260914')]});
  assert.equal(varying.has('a'),false,'the next trip differs on Tuesday');
});
