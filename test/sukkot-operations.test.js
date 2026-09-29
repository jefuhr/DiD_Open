import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDisplayData } from '../scripts/build-data.js';
import { activeServices, timelineDepartures } from '../public/assets/schedule.js';

const root = new URL('../', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const [live, crew, board] = await Promise.all([
  json('schedules/sukkot-2026-live.json'), json('schedules/sukkot-2026-crew.json'), json('schedules/sukkot-2026-board.json')
]);
const boards = new Map(await Promise.all([8,9,11,16,18,26,27].map(async landingNumber => [landingNumber, await buildDisplayData({ landingNumber })])));
const holidayRows = landing => boards.get(landing).departures.filter(row => row.serviceId === 'nyc:sukkot:2026');
const working = row => `${row.routeId}${row.boatAssignment}`;

test('holiday trip enrichment retains its exact operator feed and board provenance', async () => {
  assert.equal(createHash('sha256').update(await readFile(new URL(live.source, root))).digest('hex'), live.sourceSha256);
  assert.equal(live.boardWorkbookSha256, board.workbookSha256);
  assert.equal(crew.workbookSha256, board.workbookSha256);
  assert.equal(live.feedVersion, '20260928');
  assert.equal(live.counts.matched, 2072);
  assert.equal(live.publishedDwells, 65);
  assert.deepEqual(live.dates, ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02']);
});

test('published Pier 11 arrivals preserve the distinct South Brooklyn and Rockaway dwells', () => {
  const data = boards.get(16);
  for (const [route, arrival, departure, duration] of [
    ['SB', '07:03:00', '07:07:00', 240],
    ['RS', '06:00:00', '06:05:00', 300],
    ['RS', '06:02:00', '06:10:00', 480]
  ]) {
    const row = holidayRows(16).find(row => row.routeId === route && row.departureTime === departure && !row.outOfService);
    assert.ok(row?.liveTripId, `${route} ${departure} matches a feed trip`);
    assert.equal(row.timetableOnly, false);
    const schedule = data.tripSchedules[row.tripId];
    assert.equal(schedule.liveTripId, row.liveTripId);
    const call = schedule.stops.find(call => call.stopId === '87' && call.departureSeconds === row.seconds);
    const seconds = value => value.split(':').map(Number).reduce((sum, item) => sum * 60 + item, 0);
    assert.equal(call.arrivalSeconds, seconds(arrival));
    assert.equal(call.departureSeconds - call.arrivalSeconds, duration);
    assert.equal(call.feedArrivalSeconds, seconds(departure), 'relative feed delay retains the original GTFS arrival basis');
    assert.ok(call.arrivalSource, 'the arrival comes from the paired PDF column');
  }
});

test('verified holiday trips retain full stop order; unmatched printed rows do not acquire through trips', () => {
  const data = boards.get(16);
  let verified = 0, unmatched = 0;
  for (const row of holidayRows(16).filter(row => row.scheduleOnly)) {
    const schedule = data.tripSchedules[row.tripId];
    if (row.timetableOnly === false) {
      verified++;
      assert.ok(schedule.stops.length >= 2);
      assert.deepEqual(schedule.stops, live.trips[row.liveTripId].stops);
      assert.equal(row.boatAssignment, live.trips[row.liveTripId].boatAssignment);
      for (let i=1; i<schedule.stops.length; i++) {
        assert.ok(schedule.stops[i].sequence > schedule.stops[i-1].sequence);
        assert.ok(schedule.stops[i].arrivalSeconds >= schedule.stops[i-1].departureSeconds);
      }
    } else {
      unmatched++;
      assert.equal(schedule.timetableOnly, true);
      assert.equal(schedule.stops.length, 1);
      assert.equal(schedule.stops[0].departureSeconds, row.seconds);
    }
  }
  assert.ok(verified > 100 && unmatched > 0);
});

test('holiday crew pickups and four shuttles appear on each confirmed date only', () => {
  const data = boards.get(27);
  for (const row of holidayRows(27)) assert.ok(data.routes[row.routeId]?.name, `Pier C route ${row.routeId} retains its name`);
  for (const date of [...live.dates, '2026-09-27', '2026-10-03', '2026-11-02']) {
    const active = activeServices(data, date);
    const rows = holidayRows(27).filter(row => active.has(row.serviceId));
    if (!live.dates.includes(date)) { assert.equal(rows.length, 0, date); continue; }
    assert.equal(rows.filter(row => row.fromHomePort && !row.crewShuttle).length, 38, date);
    assert.deepEqual(rows.filter(row => row.crewShuttle).map(row => row.departureTime), ['12:20:00','13:05:00','13:30:00','13:45:00']);
    assert.ok(rows.every(row => row.fromHomePort && row.approximate), 'the times are first pickups, not fabricated Pier C departure clocks');
    assert.ok(rows.filter(row => !row.crewShuttle).every(row => row.predictTripId && !row.liveTripId));
  }
  assert.equal(holidayRows(27).find(row => working(row) === 'ER3' && row.departureTime === '14:18:00')?.destination, 'East 34th Street');
  assert.equal(holidayRows(27).find(row => working(row) === 'SB2' && row.departureTime === '06:46:00')?.destination, 'East 34th Street');
});

test('crew shuttles also show collecting-landing pickup windows and never send relieved boats home', () => {
  assert.deepEqual(holidayRows(16).filter(row => row.crewShuttle).map(row => [row.departureTime,row.departureTimeEnd,row.crewBoats]), [
    ['12:20:00','12:52:00',['RS1','RS4']],
    ['13:05:00','13:37:00',['RS2','RS5']],
    ['13:45:00','14:17:00',['RS3','RS6','ER6']]
  ]);
  assert.deepEqual(holidayRows(8).filter(row => row.crewShuttle).map(row => [row.departureTime,row.departureTimeEnd,row.crewBoats]), [
    ['13:30:00','14:02:00',['SB1']]
  ]);
  for (const shuttle of crew.shuttles.holiday) for (const boat of shuttle.boats) {
    assert.equal(holidayRows(shuttle.landing).some(row => working(row) === boat && row.outOfService && !row.endsDay), false, boat);
    assert.equal(holidayRows(27).some(row => working(row) === boat && row.fromHomePort && row.seconds >= 12*3600), false, boat);
  }
});

test('verified last drops create correctly identified return-to-Pier-C rows and final-run markers', () => {
  const rows = holidayRows(16);
  for (const [boat, departureTime, endsDay, liveTripId] of [
    ['AS1','10:42:00',false,'1014'], ['AS1','21:18:00',true,'1277'], ['GI2','17:06:00',true,'1438']
  ]) {
    const row = rows.find(row => working(row) === boat && row.departureTime === departureTime && row.outOfService);
    assert.ok(row, `${boat} ${departureTime}`);
    assert.equal(row.destination, 'Pier C');
    assert.equal(row.liveTripId, liveTripId);
    assert.equal(row.endsDay, endsDay);
    assert.equal(boards.get(16).tripSchedules[row.tripId].liveTripId, liveTripId, 'return details cannot read a colliding curated trip ID');
    const passengerRows = [...boards.keys()].flatMap(holidayRows).filter(candidate => !candidate.outOfService && candidate.liveTripId === liveTripId && candidate.seconds < row.seconds);
    assert.ok(passengerRows.length > 0);
    assert.ok(passengerRows.every(candidate => candidate.endsShift === 'certain'));
  }
});

test('withheld and unresolved final drops remain explicit and never become invented Pier C returns', () => {
  assert.equal(Object.values(crew.shifts.holiday).flat().filter(shift => shift.endTripId).length, 40);
  // Dispatch withheld these six on 2026-09-28, including RS4's otherwise exact 21:30 Pier 11 drop.
  assert.deepEqual(crew.withheldDrops.map(note => note.source).sort(),
    ['Board!A10','Board!A26','Board!C26','Board!D10','Board!F26','Board!L10']);
  assert.deepEqual(crew.withheldDrops.map(note => note.boat).sort(), ['ER1','ER3','ER6','GI1','RS1','RS4']);
  assert.deepEqual(crew.unresolvedEnds, []);
  const rows = [...boards.keys()].flatMap(holidayRows);
  for (const note of [...crew.withheldDrops, ...crew.unresolvedEnds]) {
    assert.equal(rows.some(row => working(row) === note.boat && row.outOfService && row.endsDay), false, note.boat);
  }
  assert.match(boards.get(27).meta.crewScheduleStatus.confirmedHolidays.message, /^6 Pier C returns await dispatch confirmation\.$/);
});

test('holiday turnarounds use verified adjacent workings and preserve actual realtime IDs', () => {
  const schedules = boards.get(16).tripSchedules;
  const entries = Object.values(schedules).filter(schedule => schedule.serviceId === 'nyc:sukkot:2026' && schedule.turnaround);
  assert.ok(entries.length > 20);
  for (const schedule of entries) {
    const turn = schedule.turnaround, next = live.trips[turn.nextLiveTripId];
    const last = schedule.stops.at(-1), first = next.stops[0];
    assert.equal(turn.nextTripId, `nyc:sukkot:trip:${turn.nextLiveTripId}`);
    assert.equal(last.stopId, first.stopId);
    assert.equal(turn.scheduledLayoverSeconds, first.departureSeconds-last.arrivalSeconds);
    assert.equal(schedule.boatAssignment, next.boatAssignment);
    assert.equal(schedule.routeId, next.routeId);
  }
});

test('matched holiday departures consume live aliases while tomorrow remains scheduled', () => {
  const data = boards.get(16);
  const row = holidayRows(16).find(row => row.routeId === 'SB' && row.departureTime === '07:07:00' && !row.outOfService);
  const realtime = {stale:false, available:true, updates:[{tripId:row.liveTripId,stopId:row.stopId,delaySeconds:120}],
    vehicles:[{tripId:row.liveTripId,boatName:'Verified vessel',boat:`SB${row.boatAssignment}`}]};
  for (const [viewDate, isLive] of [[null,true],['2026-09-29',false]]) {
    const visible = timelineDepartures({data,realtime,viewDate,now:new Date('2026-09-28T11:00:00Z'),limitPerGroup:1000})
      .find(item=>item.departure.tripId===row.tripId).departure;
    assert.equal(visible.delay,isLive?120:0);
    assert.equal(visible.boatName,isLive?'Verified vessel':null);
    assert.equal(visible.hasLiveTiming,isLive);
  }
});
