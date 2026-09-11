// Bundled, repeatable cartography and 25 stationary vessels; no live feed or server needed.
const fs = require('node:fs/promises');
const path = require('node:path');
let fixture;
module.exports = function mapFixture() {
  return fixture ||= (async () => {
    const { buildHarborMap } = await import('../lib/fleet-map.js');
    const { parseCsv } = await import('./build-data.js');
    const read = file => fs.readFile(path.join(__dirname, '..', file), 'utf8');
    const [routes, trips, shapes, stopsRaw, configRaw, chartRaw] = await Promise.all([
      'gtfs/routes.txt', 'gtfs/trips.txt', 'gtfs/shapes.txt', 'gtfs/stops.txt',
      'config/landings.json', 'content/harbor-chart.json'
    ].map(read));
    const stops = parseCsv(stopsRaw);
    const landings = Object.entries(JSON.parse(configRaw)).flatMap(([id, landing]) => {
      const stop = stops.find(stop => landing.stopIds?.includes(stop.stop_id));
      return stop ? [{ ...landing, id: Number(id), latitude: Number(stop.stop_lat), longitude: Number(stop.stop_lon) }] : [];
    });
    const harbor = buildHarborMap({ routes, trips, shapes, landings, chart: JSON.parse(chartRaw) });
    const boats = Array.from({ length: 25 }, (_, i) => {
      const route = harbor.routes[i % harbor.routes.length];
      const dock = landings[i % landings.length];
      return { id: String(i + 1), name: `Benchmark ${String(i + 1).padStart(2, '0')}`, number: `H-${200 + i}`,
        latitude: 40.64 + (i % 5) * 0.035, longitude: -74.03 + Math.floor(i / 5) * 0.025,
        routeId: route.id, route: route.shortName, routeName: route.name, color: route.color,
        bearing: i * 31 % 360, status: 'in-transit', speedKnots: 12, ageSeconds: 10, stop: dock };
    });
    return { harbor, positions: { available: true, boats } };
  })();
};
