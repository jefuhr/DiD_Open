# NYC Ferry Staff Board

An offline-capable staff app for ferry departures, crew assignments, trip connections, service alerts, and vessel positions. One responsive interface serves phones, tablets, and desktops.

The [fall schedule](docs/schedule-comparison/fall-2026-update.md) and
[weekend crew notes](docs/schedule-comparison/fall-weekend-2026.md) are integrated.
See [feed maintenance](docs/data-maintenance.md) for the September 20 refresh and preserved calendar corrections.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open http://127.0.0.1:8090. Use `npm run dev` for server watch mode. The default host is loopback; set `HOST` and `PORT` for deployment.

Startup builds the configured landing's fallback file, then the server builds every active landing in memory from bundled schedules. Realtime and alerts are optional enrichments: published schedules remain usable when upstream services fail.

## Using the app

Choose a landing from the drawer or desktop sidebar. The choice, favorites, operator filters, theme, sort order, and clock format persist on the device. Browse dates within the bundled service calendars, or open a departure for its stops and connections. The map shows reporting NYC Ferry vessels.

The responsive staff layout is identical at the root and under the existing `/ferryTimesMobile/` deployment prefix. The fixed-screen kiosk mode has been retired.

## Configuration and data

- `config/display.json`: default landing, lookahead window, departure count, and operator switches.
- `config/landings.json`: active landing IDs and operator stop mappings.
- `gtfs/`: bundled operator feeds; `content/` and `config/crew-shuttles.json`: fleet and operational data.
- `state/`: runtime feed snapshots and aggregate statistics. Keep this directory persistent.

After updating feeds or configuration, run `npm run build` and restart the server. Maintain transcribed feeds and crew assignments using the procedures in [Schedule and operator maintenance](docs/data-maintenance.md). Geographic refresh procedures and attribution are in [Harbor map](docs/harbor-map.md).

## Offline behavior

Previously loaded landing schedules remain available and departures are recalculated as time advances. Live timings become stale when refreshes fail; browsing another date never applies today's realtime updates. A landing that has never been saved needs a connection first. Coverage is limited to the bundled calendars and exceptions.

The service worker caches the board, map, modules, and API snapshots. It updates independently of the device's saved preferences. After changing shipped assets, run `npm run stamp:bump`.

SFTP landing notices and `/api/override` have been removed. Official service alerts and crew notices remain. Existing SFTP configuration, credentials, and notice state files are no longer read; this migration does not delete files from deployed systems.

## Development and verification

```sh
npm test
npm run test:staff-app
npm run test:mobile-route-layout
npm run test:mobile-viewport
npm run test:map-selection
npm run test:map-rendering
```

Browser checks require installed Playwright browsers and a running app. Set `MOBILE_TEST_ORIGIN` to its origin (default `http://127.0.0.1:8094`). Reports and screenshots go to ignored `artifacts/browser/`. Historical screenshots remain in `docs/mobile-upgrade/`.

The browser uses native ES modules with no bundler. Backend schedule construction lives in `lib/`; scripts are maintenance entrypoints. [Architecture and native-client preparation](docs/architecture.md) describes the boundaries, offline rules, and portable fixtures. The existing API is documented in [OpenAPI](docs/api.openapi.json).

## Deployment

```sh
docker compose up --build -d
```

Compose persists `./state`, binds port 8090 to loopback, and checks `/healthz`. Keep the existing reverse-proxy forwarding for `/ferryTimesMobile/`, `/api/`, `/assets/`, `/app.js`, `/styles.css`, and `/sw.js`. The deployed web manifest retains its existing prefix and installation identity. See [Deployment](docs/deployment.md).

Product changes are maintained in `content/changelog.json`.
