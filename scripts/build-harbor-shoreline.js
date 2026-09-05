// Refresh the bundled shoreline from OSM water polygons in CARTO's vector basemap.
// Run explicitly with npm run build:shoreline; normal startup/build stays offline.
// Source: https://github.com/CartoDB/basemap-styles (OpenMapTiles water layer).
// OSM data: ODbL https://www.openstreetmap.org/copyright
import { writeFile } from "node:fs/promises";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import clipping from "polygon-clipping";

const zoom = 12;
const bounds = { west: -74.23, south: 40.50, east: -73.70, north: 40.92 };
const tileX = (lon) => Math.floor((lon + 180) / 360 * 2 ** zoom);
const tileY = (lat) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom);
const frame = [[[bounds.west, bounds.south], [bounds.east, bounds.south], [bounds.east, bounds.north], [bounds.west, bounds.north], [bounds.west, bounds.south]]];
const water = [];
const streets = [];
const majorStreet = /FDR|Franklin D|West Street|West Side|Henry Hudson|Brooklyn.Queens|Belt Parkway|Long Island Expressway|Grand Central|Cross Bronx|Major Deegan|Broadway|Atlantic Avenue|Flatbush Avenue|Queens Boulevard|Northern Boulevard|Hylan Boulevard|Richmond Terrace|Beach Channel Drive|Shore Parkway|Bruckner|Fulton Street|Ocean Parkway|Jamaica Avenue|Boulevard East|Kennedy Boulevard|Canal Street|Houston Street|14th Street|23rd Street|34th Street|42nd Street|57th Street|59th Street|72nd Street|79th Street|86th Street|90th Street|96th Street|125th Street/i;
const urls = [];
for (let x = tileX(bounds.west); x <= tileX(bounds.east); x++) {
  for (let y = tileY(bounds.north); y <= tileY(bounds.south); y++) {
    urls.push({ x, y, url: `https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/${zoom}/${x}/${y}.mvt` });
  }
}
// Modest request concurrency, with every tile required before replacing the asset.
for (let start = 0; start < urls.length; start += 4) {
  const batch = await Promise.all(urls.slice(start, start + 4).map(async ({ x, y, url }) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Shoreline tile ${response.status}: ${url}`);
    const tile = new VectorTile(new Pbf(new Uint8Array(await response.arrayBuffer())));
    const layer = tile.layers.water;
    const polygons = [];
    for (let i = 0; i < (layer?.length || 0); i++) {
      const feature = layer.feature(i).toGeoJSON(x, y, zoom);
      if (feature.geometry.type === "Polygon") polygons.push(feature.geometry.coordinates);
      else if (feature.geometry.type === "MultiPolygon") polygons.push(...feature.geometry.coordinates);
    }
    const roads = [];
    const names = tile.layers.transportation_name;
    for (let i = 0; i < (names?.length || 0); i++) {
      const feature = names.feature(i).toGeoJSON(x, y, zoom);
      const name = feature.properties.name;
      if (!name || !majorStreet.test(name) || feature.properties.brunnel === "tunnel") continue;
      const paths = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates : [];
      for (const points of paths) roads.push({ name, type: ["motorway", "trunk"].includes(feature.properties.class) ? "highway" : "arterial", points: points.map(([lon, lat]) => [Number(lat.toFixed(6)), Number(lon.toFixed(6))]) });
    }
    return { polygons, roads };
  }));
  for (const tile of batch) { water.push(...tile.polygons); streets.push(...tile.roads); }
}
if (!water.length) throw new Error("No shoreline water geometry returned");
const land = clipping.difference(frame, clipping.union(...water));
// About five metres: retain piers and inlets without shipping sub-pixel coastal detail.
function simplify(points, tolerance = 0.00005) {
  const kept = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax, dy = by - ay;
    let furthest = -1, max = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const [x, y] = points[i];
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (distance > max) { max = distance; furthest = i; }
    }
    if (furthest !== -1) { kept.add(furthest); pending.push([first, furthest], [furthest, last]); }
  }
  const result = [...kept].sort((a, b) => a - b).map((i) => points[i]);
  return result.length >= 4 ? result : points;
}
const area = (ring) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nextX, nextY] = ring[(i + 1) % ring.length];
  return sum + x * nextY - nextX * y;
}, 0) / 2);
const landmass = land.filter((rings) => area(rings[0]) > 0.00000015)
  .sort((a, b) => area(b[0]) - area(a[0]))
  .map((rings, i) => ({
    id: `shore-${i + 1}`,
    name: "Harbor shoreline",
    points: simplify(rings[0]).map(([lon, lat]) => [Number(lat.toFixed(6)), Number(lon.toFixed(6))]),
    holes: rings.slice(1).map((ring) => simplify(ring).map(([lon, lat]) => [Number(lat.toFixed(6)), Number(lon.toFixed(6))]))
  }));
const data = {
  source: "OpenStreetMap contributors / CARTO vector basemap",
  sourceUrl: "https://github.com/CartoDB/basemap-styles",
  license: "ODbL-1.0", licenseUrl: "https://www.openstreetmap.org/copyright",
  generatedAt: new Date().toISOString(), zoom, bounds, landmass,
  streets: streets.map((street, i) => ({ id: `street-${i + 1}`, ...street }))
};
await writeFile(new URL("../content/harbor-shoreline.json", import.meta.url), JSON.stringify(data) + "\n");
console.log(`Bundled ${landmass.length} shoreline polygons from ${urls.length} tiles. Run node scripts/build-harbor-chart.js to publish the chart.`);
