// Optional online refresh. Normal startup uses the bundled result.
import { writeFile } from "node:fs/promises";
import shoreline from "../content/harbor-shoreline.json" with { type: "json" };

function inside([lat, lon], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ay, ax] = ring[i], [by, bx] = ring[j];
    if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}
const manhattan = shoreline.landmass.find((land) => inside([40.75, -73.99], land.points));
if (!manhattan) throw new Error("Manhattan shoreline is missing");
const names = ["Canal", "Houston", "14th", "23rd", "34th", "42nd", "57th", "59th", "72nd", "79th", "86th", "90th", "96th", "125th"];
const query = `[out:json][timeout:60];(way[highway][name~"^(East |West )?(${names.join("|")}) Street$"](40.70,-74.025,40.825,-73.925);way(427818536););out geom;`;
const response = await fetch("https://overpass-api.de/api/interpreter", {
  headers: { "User-Agent": "FerryStaffMap/1.0", "Accept": "application/json" },
  method: "POST", body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(90000)
});
if (!response.ok) throw new Error(`OSM details returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
const { elements } = await response.json();
const streets = elements.filter((way) => way.tags?.highway && way.geometry?.some((p) => inside([p.lat, p.lon], manhattan.points)))
  .map((way) => ({
    id: `osm-${way.id}`, name: way.tags.name,
    labelName: way.tags.name.replace(/^(East |West )/, "").replace(" Street", " St"),
    type: "arterial", priority: true,
    points: way.geometry.map((p) => [p.lat, p.lon])
  })).sort((a, b) => {
    const length = (road) => road.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - road.points[i][0], p[1] - road.points[i][1]), 0);
    return length(b) - length(a);
  });
for (const name of names) {
  if (!streets.some((street) => street.labelName === `${name} St`)) throw new Error(`Missing ${name} Street`);
}
const park = elements.find((way) => way.id === 427818536);
if (!park?.geometry?.length) throw new Error("Central Park boundary is missing");
const data = {
  source: "OpenStreetMap contributors", sourceUrl: "https://www.openstreetmap.org/way/427818536",
  license: "ODbL-1.0", generatedAt: new Date().toISOString(), streets,
  parks: [{ id: "central-park", name: "Central Park", points: park.geometry.map((p) => [p.lat, p.lon]) }]
};
await writeFile(new URL("../content/manhattan-details.json", import.meta.url), JSON.stringify(data) + "\n");
console.log(`Bundled ${streets.length} segments covering all ${names.length} streets and Central Park's boundary.`);
