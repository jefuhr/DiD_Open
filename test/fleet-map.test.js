import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHarborMap, buildTripIndex, describeBoats, routeIndex, shapePaths } from "../lib/fleet-map.js";

const ROUTES = [
  "route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color",
  '"ER",1,"ER","East River",4,00839C,FFFFFF',
  '"SB",1,"SB","South Brooklyn",4,FFD100,FFFFFF',
  // route_type 3: the Rockaway shuttle really is a bus, and this feed carries it.
  '"RWS",1,"RWS","Rockaway West",3,00A1E1,FFFFFF'
].join("\n");

const TRIPS = [
  "route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id",
  '"ER",1,305,"East 34th Street",1101,1,11,10',
  // The same water in the other direction, drawn from a shape that is shape 10 reversed.
  '"ER",1,306,"Wall St./Pier 11",1102,0,11,11',
  '"SB",1,900,"Bay Ridge",2201,0,12,20',
  '"RWS",1,700,"Beach 116th Street",3301,0,13,30'
].join("\n");

const STOPS = [
  "stop_id,stop_code,stop_name,stop_lat,stop_lon,wheelchair_boarding",
  '17,"1","East 34th Street",40.743912,-73.970731,1',
  '87,"2","Wall St/Pier 11",40.703161,-74.006144,1',
  '23,"3","Bay Ridge",40.639858,-74.038130,1'
].join("\n");

const SHAPES = [
  "shape_id,shape_pt_lon,shape_pt_lat,shape_pt_sequence",
  // Out of order on purpose: the sequence column is the order, not the row order.
  "10,-74.006144,40.703161,2",
  "10,-73.970731,40.743912,1",
  "11,-73.970731,40.743912,2",
  "11,-74.006144,40.703161,1",
  "20,-74.006144,40.703161,1",
  "20,-74.038130,40.639858,2",
  "30,-73.820000,40.587000,1",
  "30,-73.790000,40.590000,2"
].join("\n");

const STOP_TIMES = [
  "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
  "305,08:00:00,08:00:00,87,1",
  "305,08:22:00,08:22:00,17,2",
  "900,09:00:00,09:00:00,87,1",
  "900,09:30:00,09:30:00,23,2"
].join("\n");

const LANDINGS = [
  { id: 17, name: "East 34th Street", displayName: "East 34th Street / Midtown", latitude: 40.743912, longitude: -73.970731 },
  { id: 4, name: "Bay Ridge", displayName: "Bay Ridge / Veterans Memorial Pier", latitude: 40.639858, longitude: -74.03813 },
  // Pier C is virtual and has no feed row of its own, and a landing with no position at all cannot
  // be drawn anywhere.
  { id: 30, name: "Pier C", displayName: "Pier C", latitude: 40.7, longitude: -74.03 },
  { id: 99, name: "Nowhere", displayName: "Nowhere" }
];

const harbor = () => buildHarborMap({ routes: ROUTES, trips: TRIPS, shapes: SHAPES, landings: LANDINGS });

test("shapes become polylines in sequence order", () => {
  const paths = shapePaths(SHAPES);
  assert.deepEqual(paths.get("10"), [[40.74391, -73.97073], [40.70316, -74.00614]]);
  assert.equal(paths.size, 4);
});

test("a bus route is kept as a route but is not drawn on the water", () => {
  const routes = routeIndex(ROUTES);
  assert.equal(routes.get("RWS").mode, "bus");
  assert.equal(routes.get("ER").mode, "ferry");
  // Named so a vehicle that turns out to be a coach on Beach Channel Drive can say so.
  assert.equal(routes.get("RWS").name, "Rockaway West");
  assert.equal(routes.get("ER").color, "#00839C");

  assert.deepEqual(harbor().routes.map((route) => route.id), ["ER", "SB"]);
});

test("a route drawn twice over the same water is drawn once", () => {
  // Shapes 10 and 11 are the same two points in opposite order, which on a static picture is one
  // line and one line's worth of payload.
  const [eastRiver] = harbor().routes;
  assert.equal(eastRiver.paths.length, 1);
});

test("the bounds hold every line and every dock that has a position", () => {
  const map = harbor();
  assert.deepEqual(map.bounds, {
    minLatitude: 40.63986, maxLatitude: 40.74391,
    minLongitude: -74.03813, maxLongitude: -73.97073
  });
  // The Rockaway bus shape is well east of this, and is not in it.
  assert.ok(map.bounds.maxLongitude < -73.79);
  // A landing with no coordinates is left off rather than drawn at zero, zero.
  assert.deepEqual(map.landings.map((dock) => dock.name), ["Bay Ridge", "East 34th Street", "Pier C"]);
});

test("a trip knows its route, its destination and the stops it calls at", () => {
  const trips = buildTripIndex({ trips: TRIPS, stopTimes: STOP_TIMES, stops: STOPS });
  const trip = trips.get("305");
  assert.equal(trip.routeId, "ER");
  assert.equal(trip.destination, "East 34th Street");
  assert.deepEqual(trip.stops.map((stop) => stop.sequence), [1, 2]);
  assert.equal(trip.stops[1].name, "East 34th Street");
  // Carried so the map can match a next stop to a dock by position rather than by spelling.
  assert.equal(trip.stops[1].latitude, 40.743912);
});

test("a boat is described by the trip it is working", () => {
  const trips = buildTripIndex({ trips: TRIPS, stopTimes: STOP_TIMES, stops: STOPS });
  const asOf = Date.parse("2026-09-01T12:00:30Z");
  const [boat] = describeBoats([{
    id: "19", tripId: "305", latitude: 40.7203, longitude: -73.99123,
    bearing: null, speed: 9, status: "in-transit", stopSequence: 2,
    boatName: "Waves of Wonder", vesselNumber: "H-101",
    updatedAtEpochSeconds: Date.parse("2026-09-01T12:00:00Z") / 1000
  }], { trips, routes: routeIndex(ROUTES), asOf });

  assert.equal(boat.route, "ER");
  assert.equal(boat.color, "#00839C");
  assert.equal(boat.destination, "East 34th Street");
  assert.deepEqual(boat.stop, { id: "17", name: "East 34th Street", latitude: 40.74391, longitude: -73.97073 });
  // The feed reports metres per second, which is checkable against the distance a boat covers
  // between two fixes. Nobody talks about a ferry in metres per second.
  assert.equal(boat.speedKnots, 17.5);
  assert.equal(boat.ageSeconds, 30);
});

test("a boat with no trip is still a boat", () => {
  const [boat] = describeBoats([{
    id: "60", tripId: null, latitude: 40.7, longitude: -74.01,
    bearing: null, speed: 0, status: "stopped", stopSequence: null,
    boatName: "Tooth Ferry", vesselNumber: "H-122", updatedAtEpochSeconds: 1_788_000_000
  }], { trips: new Map(), routes: routeIndex(ROUTES), asOf: 1_788_000_000_000 });

  assert.equal(boat.name, "Tooth Ferry");
  assert.equal(boat.route, null);
  assert.equal(boat.destination, null);
  assert.equal(boat.stop, null);
  assert.equal(boat.mode, "ferry");
});

// A vessel tied up for the night sits in the feed where it moored, and drawing it is claiming there
// is a boat out there. Age is measured against the snapshot rather than against now, so a cache
// being served through an outage keeps showing the harbor as it stood.
test("a fix much older than the snapshot is not a boat on the water", () => {
  const positions = [
    { id: "1", tripId: null, latitude: 40.7, longitude: -74.01, bearing: null, speed: 0, status: "stopped", stopSequence: null, boatName: "Moored", vesselNumber: "H-1", updatedAtEpochSeconds: 1_000_000 },
    { id: "2", tripId: null, latitude: 40.7, longitude: -74.02, bearing: null, speed: 0, status: "stopped", stopSequence: null, boatName: "Working", vesselNumber: "H-2", updatedAtEpochSeconds: 1_003_500 }
  ];
  const boats = describeBoats(positions, { asOf: 1_003_600_000 });
  assert.deepEqual(boats.map((boat) => boat.name), ["Working"]);

  // The same feed read at its own moment keeps both.
  assert.equal(describeBoats(positions, { asOf: 1_000_030_000 }).length, 2);
});

// The whole point of the page is that it draws the real network, so the real feed has to make it
// through the real code and come out looking like the harbor.
test("the bundled feed builds a harbor with routes, docks and bounds over New York", async () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const map = buildHarborMap({
    routes: await read("gtfs/routes.txt"),
    trips: await read("gtfs/trips.txt"),
    shapes: await read("gtfs/shapes.txt"),
    landings: LANDINGS
  });
  assert.ok(map.routes.length >= 5, "the feed should draw most of the network");
  for (const route of map.routes) {
    assert.ok(route.paths.length > 0);
    assert.ok(route.paths.every((path) => path.length >= 2), `${route.id} has a path of one point`);
    assert.match(route.color, /^#[0-9A-F]{6}$/);
  }
  assert.ok(map.bounds.minLatitude > 40.5 && map.bounds.maxLatitude < 41);
  assert.ok(map.bounds.minLongitude > -74.5 && map.bounds.maxLongitude < -73.5);
});
