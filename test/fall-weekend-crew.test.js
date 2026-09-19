import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDisplayData } from '../scripts/build-data.js';
import { activeServices, createConnectionIndex } from '../lib/connections.js';

const source = JSON.parse(await readFile(new URL('../schedules/fall-2026-weekend-crew.json', import.meta.url)));
const boards = new Map(await Promise.all([8,9,11,16,17,26,27].map(async landing => [landing, await buildDisplayData({ landingNumber: landing })])));
const index = createConnectionIndex(boards);
const rows = (landing, date) => boards.get(landing).departures.filter(r => activeServices(index, date).has(r.serviceId));

test('weekend import keeps verified fields and records conflicting notes without substituting guesses', () => {
  assert.equal(Object.values(source.shifts.weekend).flat().length, 36);
  assert.deepEqual(source.rejected.map(r => [r.boat, r.field]).sort(), [['RS1','end'],['SG3','start']]);
  assert.equal(source.shifts.weekend.RS1.find(r => r.shift === 'PM').endTime, undefined);
  assert.equal(source.shifts.weekend.SG3.find(r => r.shift === 'PM').startTime, undefined);
  assert.equal(source.shifts.weekend.RS5[0].endTime, '14:54', 'cell E2 controls identity despite copied RWSV4 heading');
  assert.equal(source.shifts.weekend.RS5[0].endNoteTime, '14:46');
  assert.equal(source.shifts.weekend.ER2.find(r=>r.shift==='PM').startTime, '14:36', 'comment matches timetable; summary cell 14:06 does not');
});

test('five afternoon crew shuttles recur on every confirmed weekend, including non-cruise Sundays', () => {
  for (let day = new Date('2026-09-19T12:00:00Z'); day <= new Date('2026-11-01T12:00:00Z'); day.setUTCDate(day.getUTCDate()+1)) {
    if (![0,6].includes(day.getUTCDay())) continue;
    const date=day.toISOString().slice(0,10);
    assert.deepEqual(rows(27,date).filter(r=>r.crewShuttle).map(r=>r.departureTime), ['14:05:00','14:35:00','14:55:00','15:00:00','16:00:00'], date);
    assert.equal(rows(16,date).filter(r=>r.crewShuttle).length,4,date);
    assert.equal(rows(9,date).filter(r=>r.crewShuttle).length,1,date);
    assert.ok(rows(27,date).filter(r=>r.fromHomePort).every(r=>r.approximate));
  }
  for (const row of rows(16,'2026-09-19').filter(r=>r.crewShuttle)) assert.ok(row.secondsEnd >= row.seconds);
  assert.deepEqual(rows(9,'2026-09-19').find(r=>r.crewShuttle).crewBoats,['AS1']);
});

test('Red Hook passenger shuttle and its Pier C movements appear on exactly ten dates', () => {
  for (let day=new Date('2026-09-19T12:00:00Z'); day<=new Date('2026-11-02T12:00:00Z'); day.setUTCDate(day.getUTCDate()+1)) {
    const date=day.toISOString().slice(0,10), cruise=source.cruiseDates.includes(date);
    const working = landing => rows(landing,date).filter(r=>r.routeId==='SB' && r.boatAssignment===3);
    assert.equal(working(17).filter(r=>!r.outOfService).length, cruise?11:0,date);
    assert.equal(working(16).filter(r=>!r.outOfService).length, cruise?10:0,date);
    assert.equal(working(27).length,cruise?1:0,date);
    if (!cruise) continue;
    assert.equal(working(17)[0].departureTime,'07:22:00');
    assert.equal(working(27)[0].departureTime,'07:22:00');
    const end=working(16).find(r=>r.outOfService);
    assert.equal(end.departureTime,'12:32:00');
    assert.equal(end.endsDay,true);
    assert.equal(working(17).at(-1).endsShift,'certain');
    assert.equal(working(17).some(r=>r.crewShuttle),false);
    assert.ok(activeServices(index,date).has(working(27)[0].serviceId));
    assert.ok(working(27)[0].predictTripId);
    assert.equal(rows(17,date)[0].tripId, working(27)[0].predictTripId);
  }
});

test('shuttled handovers create neither deadheads nor replacement Pier C starts', () => {
  const day='2026-09-19';
  for (const shuttle of source.shuttles.weekend) {
    for (const boat of shuttle.boats) {
      const isBoat = r => `${r.routeId}${r.boatAssignment}`===boat;
      assert.equal(rows(shuttle.landing,day).some(r=>isBoat(r)&&r.outOfService&&r.seconds>=12*3600&&r.seconds<18*3600),false,boat);
      assert.equal(rows(27,day).some(r=>isBoat(r)&&r.fromHomePort&&!r.crewShuttle&&r.seconds>=12*3600),false,boat);
    }
  }
});

test('unshuttled changes remain visible, including RS2 at an intermediate Pier 11 call', () => {
  const date='2026-09-19';
  for (const [landing,boat,time] of [[8,'ER1','14:03:00'],[8,'ER2','14:31:00'],[8,'SB1','15:09:00'],[11,'SB2','15:10:00'],[26,'SG1','15:26:00'],[16,'RS2','15:47:00']]) {
    assert.ok(rows(landing,date).some(r=>r.outOfService&&`${r.routeId}${r.boatAssignment}`===boat&&r.departureTime===time),boat);
  }
  const handover=rows(16,date).find(r=>r.outOfService&&r.routeId==='RS'&&r.boatAssignment===2&&r.departureTime==='15:47:00');
  assert.equal(rows(16,date).find(r=>r.tripId===handover.liveTripId).endsShift,null,'continuing passenger departure is not a final crew segment');
  assert.ok(rows(27,date).some(r=>r.routeId==='RS'&&r.boatAssignment===2&&r.departureTime==='15:47:00'));
});
