# Harbor map

the folded-map button in the heading, next to the location button, opens `/map` — every NYC Ferry
vessel that is currently reporting a position, drawn on the network it is running.

the page loads [`public/styles.css`](../public/styles.css) itself rather than carrying a palette of
its own, so it inherits the board's fonts, its colour variables and all nine themes, and its
header is the board's `.board-heading` with the board's own count and freshness chips in it. that
is deliberate: it is a second screen of the same app, not a second site, and the one thing that
would give that away is a page that stays blue while the board has gone pink. the only fixed
colours on it are the operators' own route colours, which are facts about the routes.

the backdrop is a **bundled, themeable vector shoreline** sourced from OpenStreetMap through
[CARTO's basemap](https://github.com/CartoDB/basemap-styles). It includes piers, islands, inlets and
major roads. Street names stay subtle, with more labels appearing on zoom; landing names avoid
overlapping one another. Bridges, navigation channels, lights and buoys are retained, with finer
marine labels appearing on zoom. The marine information is a service reference, not a navigation
chart or a guarantee of vessel clearance.

The desktop vessel list sits beside the map; on phones it collapses to give the map more room.
Route filters highlight vessels; route lines are hidden to keep the harbor clear. Tapping a landing
marker or its visible name asks for confirmation before opening that landing's departure board. Vessel search and next-stop
information support quick staff lookups. All nine board themes apply, including when the server
blocks inline scripts. Pier C is positioned on the western Navy Yard pier using
[its mapped footprint](https://www.openstreetmap.org/way/700015264).

To refresh the geographic source, run `npm run build:shoreline`, then
`node scripts/build-manhattan-details.js`, then `node scripts/build-harbor-chart.js`.
The first two commands need network access (the shoreline builder also needs development
dependencies). Manhattan's priority street labels and Central Park boundary are bundled in
`content/manhattan-details.json`. Normal builds and startup use the bundled JSON. Source,
date and ODbL license information are stored alongside each geographic dataset.

everything on top of that is this server's own: the route lines come out of `gtfs/shapes.txt` and
the docks out of [`config/landings.json`](../config/landings.json), built once at startup by
[`lib/fleet-map.js`](../lib/fleet-map.js) and served from `/api/map`. the drawing is hand-built SVG
in [`public/assets/map.js`](../public/assets/map.js) — no map library — with pan, pinch-zoom, and
`ctrl`/`⌘` + scroll to zoom on a desktop. plain scrolling is left alone so the page can still be
scrolled past.

If a chart payload has no bundled backdrop, the map falls back to OpenStreetMap and OpenSeaMap
raster tiles:

- **the two tile hosts are the only exception in the Content-Security-Policy**, which is otherwise `default-src 'self'`. they are allowed for `img-src` and nothing else, so nothing off this origin can execute, fetch or style anything.
- **the fallback tiles need a signal.** the normal vector backdrop makes no external tile requests and remains available with cached server data.
- **the projection is Web Mercator**, because that is what raster tiles are cut to. drawn in anything else the route lines sit a few hundred metres off the water they are meant to be on.

attribution is required by the licences and is printed in the corner of the map.

`/api/boats` is the live half. it reads the same cached snapshot `/api/realtime` does, so opening
the map costs nothing extra upstream, and each boat carries:

| field | from |
|---|---|
| position, speed | the NYC Ferry vehicle-position feed. speed is metres per second in the feed and knots on the page. |
| vessel name | matched against [`content/vessels.json`](../content/vessels.json), falling back to the feed's own label (`H204`) when the fleet list does not know it. |
| route, destination, next stop | the trip the feed says it is working, looked up in the static feed. |

things worth knowing about what it can and cannot show:

- **NYC Ferry only.** every partner operator the board carries — NY Waterway, Seastreak, the Staten Island Ferry, NYU Langone, Liberty Landing, the Trust's Governors Island boats — publishes no vessel positions at all. their boats are on the water and not on this map.
- **no heading in the feed.** the vendor sets speed but never `bearing`, so a boat is pointed by comparing where it is now with where it was on the previous poll, and points nowhere until it has actually moved.
- **a fix much older than the feed's own snapshot is dropped**, so a vessel tied up overnight does not sit on the map claiming to be out. ages are measured against the snapshot rather than the clock, so a cache served through an upstream outage keeps showing the harbor as it stood.
- outside service hours the honest answer is an empty harbor, and that is what it draws.

reachable as `/map` at the site root and `/ferryTimesMobile/map` on juliet.nyc, the same two spellings
the stats page answers to.

### from a departure to its boat

tapping a departure already opens its trip — every stop it calls at and what connects from each.
that sheet now carries one more line, above the stops: **see this boat on the map**. the stops
answer where the boat is going; this answers where it is.

the handover is by **vessel name**, `map?boat=Tooth%20Ferry`, and that is deliberate. a sailing an
hour out has no vehicle of its own, so the board predicts its vessel from the boat the workbook
assigns it — and that vessel is out on the water right now working some *other* trip entirely. its
trip id would find nothing; its name finds it. the map accepts the hull number (`H-122`) too.

the link names which of the two it is offering, in the same hand the row uses: a confirmed vessel
plainly, a predicted one with the question mark. a sailing the feed has not named a boat for shows
no link at all rather than an empty promise — the heading's own map button is a tap away for anyone
who wants the whole harbor. on a browsed day it never appears, because there are no boats on the
water to point at.

on the map, a boat named in the query string is selected and zoomed to. if it is not reporting yet
the page says *"McShane is not reporting a position right now"* and keeps looking on every refresh —
until somebody picks a different boat themselves, at which point it stops chasing.
