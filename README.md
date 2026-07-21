# NYC Ferry DiD Reborn

An offline-first, landscape `16:9` departure display for NYC Ferry landings. It runs from a local Node server, calculates scheduled departures from the bundled GTFS feed, overlays NYC Ferry GTFS-Realtime trip updates, and keeps working when internet service is interrupted.

The Ferry Mart artwork is stored locally at [`public/assets/ad.jpg`](./public/assets/ad.jpg) and is included in the offline application cache.

## Choose the landing

Edit the single number in [`config/display.json`](./config/display.json):

```json
{
  "landingNumber": 16,
  "slideSeconds": 12,
  "departureWindowMinutes": 180,
  "departuresShown": 4,
  "routesShown": 4
}
```

Use a number from `2` through `24`. Number `1` is intentionally unused. The landing names and GTFS stop mappings live in [`config/landings.json`](./config/landings.json). Rockaway (`18`) includes the ferry landing and the connected shuttle-bus stop.

`slideSeconds` controls how long each set of route directions remains on screen. It accepts values from `3` through `300` seconds.

`departureWindowMinutes` controls whether a route-direction group appears. Its next departure must be within that many minutes. Once the group qualifies, the board displays the configured number of remaining departures even when later departures fall outside the window. The default `180` means three hours; accepted values are `1` through `1440`.

`departuresShown` controls how many departure columns appear in each route row. `routesShown` controls how many route-and-destination rows appear on each slideshow page. Both settings accept whole numbers from `1` through `5`; they can be set independently.

The board automatically advances until every direction has been shown. Each group contains its configured number of departure times and the assigned boat name when that assignment is available from the live feed.

After changing the number, restart the app. The `prestart` script rebuilds the local display data automatically.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm start
```

Open `http://127.0.0.1:8090`. The device can launch Chromium at that address in kiosk mode. The server binds only to loopback unless `HOST=0.0.0.0` is set explicitly.

Run validation with:

```bash
npm test
npm run build
```

## Local resilience

- The complete schedule, landing map, fonts, logo, display code, and advertisement live on the device.
- The last successful realtime trip-update response is written atomically to `state/realtime.json`.
- Live vehicle assignments are matched to the local vessel roster so the display can show boat names beside departure times.
- The bottom strip uses the live NYC Ferry GTFS-Realtime alert feed and saves the last successful alert snapshot to `state/service-alerts.json`.
- The service worker caches the screen shell, advertisement, and API responses.
- The browser keeps a final schedule and realtime snapshot in local storage.
- If NYC Ferry realtime is unavailable, the display continues using the saved live snapshot and then the local scheduled times.

Replace the files in [`gtfs/`](./gtfs) when a new published schedule is issued, then restart the app. The display shows schedule data only from the bundled feed, so deployments remain reproducible and do not depend on downloading GTFS at boot.

## Docker

```bash
docker compose up --build -d
```

The compose service restarts automatically and stores realtime snapshots in the local `./state` directory.
