// Deterministic native UI fixtures derive their schedule from the shared contract fixture.
// This is a development command; neither the app nor the server invokes it at runtime.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile(new URL('../test/fixtures/schedule-contract.json', import.meta.url)));
const output = new URL('../ios/FerryBoard/PreviewData/', import.meta.url);
await mkdir(output, { recursive: true });
const at = '2026-09-04T12:50:00Z', now = Date.parse(at);
const landings = [
  { id: 16, name: 'Pier 11', displayName: 'Pier 11 / Wall St', latitude: 40.703161, longitude: -74.006144 },
  { id: 26, name: 'Pier 79', displayName: 'Midtown West / Pier 79', latitude: 40.760323, longitude: -74.004075 }
];
const vessels = [{ id: 'opportunity', name: 'Opportunity', number: 'H-204' }, { id: 'bay-hopper', name: 'Bay Hopper', number: 'H-120' }];
const stops = [
  { stopId: '1', name: 'Pier 11', landingId: 16, sequence: 1, arrivalSeconds: 32400, departureSeconds: 32460, arrivalAt: now + 600000, departureAt: now + 660000, skipped: false, current: false, past: false },
  { stopId: '2', name: 'DUMBO', landingId: 17, sequence: 2, arrivalSeconds: 33000, departureSeconds: 33060, estimatedArrivalSeconds: 33120, estimatedDepartureSeconds: 33180, arrivalAt: now + 1320000, departureAt: now + 1380000, skipped: false, current: true, past: false }
];
const data = {
  landings: { configured: 16, landings, operators: ['NYC Ferry', 'NY Waterway'] },
  realtime: { available: true, stale: false, fetchedAt: at, updates: [{ tripId: 'nine', stopId: '1', delaySeconds: 0 }], vehicles: [{ tripId: 'nine', boat: 'ER1', boatName: 'Opportunity', vesselId: 'opportunity', updatedAtEpochSeconds: now / 1000 }] },
  map: { bounds: { minLatitude: 40.5, maxLatitude: 40.85, minLongitude: -74.2, maxLongitude: -73.7 }, landings,
    routes: [{ id: 'ER', shortName: 'ER', name: 'East River', color: '#0070AB', paths: [] }], chart: { bridges: [], seamarks: [] } },
  boats: { available: true, stale: false, fetchedAt: at, boats: vessels.map((vessel, i) => ({ ...vessel, vesselId: vessel.id, tripId: 'nine', routeId: 'ER', route: 'ER', routeName: 'East River', color: '#0070AB', latitude: 40.71 + i * 0.01, longitude: -74.00, destination: 'DUMBO', speedKnots: 12.3, ageSeconds: 5, status: 'in-transit' })) },
  vessels: { vessels },
  alerts: { available: true, stale: false, fetchedAt: at, alerts: [{ id: 'fixture', header: 'Service update', description: 'Allow extra time when boarding.', agency: 'NYC Ferry' }] },
  changelog: { entries: [{ version: '1', date: '4 September 2026', title: 'Ferry Board', notes: ['Native iPhone preview.'] }] },
  connections: { tripId: 'nine', generatedAt: at, serviceDate: '2026-09-04', stale: false, stops: stops.map(stop => ({ ...stop, limit: 3, connections: [] })) }
};
for (const landing of landings) {
  const schedule = structuredClone(fixture.schedule);
  Object.assign(schedule.meta, { landingNumber: landing.id, landing: { ...landing, stopIds: ['1'] }, generatedAt: at });
  schedule.routes.ER = { id: 'ER', name: 'East River', shortName: 'ER', color: '#0070AB', textColor: '#FFFFFF', operator: 'NYC Ferry' };
  schedule.stops = { '1': { name: 'Pier 11', landingId: 16 }, '2': { name: 'DUMBO', landingId: 17 } };
  schedule.tripSchedules.nine = { stops: stops.map(({ stopId, sequence, arrivalSeconds, departureSeconds }) => ({ stopId, sequence, arrivalSeconds, departureSeconds })) };
  data['schedule-' + landing.id] = schedule;
}
for (const vessel of vessels) {
  data['ride-' + vessel.id] = { vessel, date: '2026-09-04', timezone: 'America/New_York', generatedAt: at, fetchedAt: at,
    stale: false, positionStale: false, position: { vesselId: vessel.id, latitude: 40.71, longitude: -74, reportedAt: now, speedKnots: 12.3, status: 'in-transit' },
    nextStop: stops[1], trips: [{ tripId: 'nine', serviceDate: '2026-09-04', state: 'current', route: 'ER', routeId: 'ER', destination: 'DUMBO', startAt: now + 600000, confirmedAt: now, stops }],
    historyNote: 'Confirmed assignments observed during app use. Earlier and future trips may be missing.' };
}
for (const [name, value] of Object.entries(data)) await writeFile(new URL(name + '.json', output), JSON.stringify(value, null, 2) + '\n');
console.log(`Wrote ${Object.keys(data).length} native UI fixture responses.`);
