# nyc ferry did reborn — mobile staff edition

an offline-first departure display for NYC Ferry landings. a local Node server builds scheduled departures from the bundled GTFS feed, overlays NYC Ferry GTFS-Realtime trip updates, and keeps working when the internet drops.

this branch is the **mobile staff variant**: everything the `staff` branch does, reflowed for a phone in an agent's hand. it is the same codebase and the same data, with a phone layout added — open it on a 1080p kiosk screen and you still get the wall board.

- no ad and no header bar — the board gets the whole screen. a slim strip keeps the landing name, clock, route count, and data-freshness chip.
- no slideshow. every route direction is on screen at once; rows compress to fit, so `routesShown` and `slideSeconds` are ignored by the display (the build still validates them).
- each departure squeezes time, countdown, crew boat assignment, boat name, and delay/on-time/LAST status into one compact slot. `departuresShown` still controls how many columns appear (set to `5` here).
- every scheduled boat shows its crew assignment next to the vessel name — `ER5` is East River boat 5. see [boat assignments](#boat-assignments).
- service alerts and SFTP landing notices behave exactly as on the rider display.

## on a phone

below `820px` the board becomes a scrolling stack of route cards. each route direction is one card, and each departure is a full-width row rather than a column:

```text
┌──────────────────────────────────┐
│ [SG] ST. GEORGE                  │
│ Wall St./Pier 11                 │
│ SOUTHBOUND                       │
├──────────────────────────────────┤
│ 7:04 PM  16 min                  │
│ +15 min  SG4  Tooth Ferry        │
├──────────────────────────────────┤
│ 8:12 PM  1 hr 24 min             │
│ ON TIME  SG1  Curiosity          │
└──────────────────────────────────┘
```

what changes on a phone, and nothing else does:

- the landing name, clock, route count and freshness chip stick to the top while the list scrolls.
- the kiosk squishes rows to fit a fixed screen. a phone can't, so cards keep their natural height and the page scrolls.
- `No scheduled trip` padding slots are dropped. they exist to keep the kiosk grid square and are dead weight on a phone.
- turned sideways, cards go two across.
- sizes switch from `vh`/`vw` to `px`, so text stays legible regardless of handset height. nothing renders below `11px`.
- notch and home-indicator clearance via `env(safe-area-inset-*)`, and `apple-mobile-web-app-capable` so "Add to Home Screen" opens it without browser chrome.

## run it

needs Node.js 22 or newer.

```bash
npm ci
npm start
```

open `http://127.0.0.1:8090`.

**to reach it from a phone**, the server has to listen on more than loopback:

```bash
HOST=0.0.0.0 npm start
```

then browse to `http://<the machine's LAN address>:8090` from a handset on the same network. the server has no authentication, so only do this on a trusted network. `Add to Home Screen` gives an app-like launcher; the service worker keeps the last data on screen when the phone loses signal.

```bash
npm test        # run the test suite
npm run build   # rebuild public/data/display-data.json
```

`npm start` rebuilds the display data first, so restart the app after any config change.

## settings

everything lives in [`config/display.json`](./config/display.json):

```json
{
  "landingNumber": 26,
  "slideSeconds": 16,
  "departureWindowMinutes": 500,
  "departuresShown": 5,
  "routesShown": 4,
  "waterwayEnabled": true,
  "busesEnabled": false
}
```

| setting | range | what it does |
|---|---|---|
| `landingNumber` | `2`–`26` | which landing this kiosk shows. `1` is unused. |
| `slideSeconds` | `3`–`300` | unused on the staff board (no paging); still validated. |
| `departureWindowMinutes` | `1`–`1440` | a route only appears if its next departure is within this many minutes. once it qualifies, the board still fills every departure column, even with later trips outside the window. |
| `departuresShown` | `1`–`5` | departure columns per route row. |
| `routesShown` | `1`–`5` | unused on the staff board (every route direction shows); still validated. |
| `waterwayEnabled` | `true` / `false` | merge in NY Waterway departures. see below. |
| `busesEnabled` | `true` / `false` | show connecting shuttle buses. see below. |

the staff board shows every route direction at once and never pages. each departure shows its crew boat assignment, plus the boat name when the live feed has that assignment.

## landings

[`config/landings.json`](./config/landings.json) is the source of truth for which landings exist and which GTFS stops they map to. the build validates against that file, not a hardcoded range, so adding a landing there (plus a matching `overrides/NN.json`) is all it takes.

landings `2` through `24` are alphabetical. `25` and `26` were added later so existing kiosk numbers stayed put. Rockaway (`18`) covers both the ferry landing and the shuttle-bus stop next to it.

## shuttle buses

`busesEnabled: false` drops every bus route (GTFS `route_type` 3) from the board and leaves the ferries. it affects:

- Rockaway (`18`) — removes the Rockaway East and Rockaway West shuttles.
- any landing showing NY Waterway — removes their shuttle-bus routes, keeps their ferries.

leave the key out entirely and it defaults to `true`.

## NY Waterway

landings that share a dock with NY Waterway can show its departures next to NYC Ferry's. the feed lives in [`gtfs/waterway/`](./gtfs/waterway) and is merged at build time by [`scripts/build-data.js`](./scripts/build-data.js).

| landing | NYC Ferry stop | NY Waterway stop |
|---|---|---|
| `16` Wall St / Pier 11 | `87` Wall St/Pier 11 | `2439146` Pier 11 / Wall Street |
| `25` Battery Park City / Brookfield Place | `136` Battery Park City/Vesey St. | `2729332` Brookfield Place/Battery Park City |
| `26` Midtown West / Pier 79 | `138` Midtown West/W 39th St-Pier 79 | `2439145` Midtown / W 39th Street |

two switches control it, and either one off means no waterway data:

- `waterwayEnabled` in `config/display.json` — the whole kiosk.
- `waterwayStopIds` in `config/landings.json` — per landing. only landings with this array populated pull in waterway data.

good to know:

- every departure and route carries an `operator` (`"NY Waterway"` or `"NYC Ferry"`, from each feed's `agency.txt`), and the board prints a small operator label under the route name.
- waterway ids are prefixed `wtr:` internally so they can't collide with NYC Ferry ids.
- waterway routes with no rider-facing short name — just an internal all-digit route id — show the NY Waterway mark ([`public/assets/waterway.png`](./public/assets/waterway.png)) in the route badge. routes with a real short name keep it.
- NY Waterway publishes no realtime feed here, so those rows show scheduled times only: no boat name, no delay badge. that's expected.

to add another landing, find its `stop_id` in [`gtfs/waterway/stops.txt`](./gtfs/waterway/stops.txt) and add a `waterwayStopIds` array to that landing in `config/landings.json`.

## boat assignments

full explanation and the update runbook: [`ferryAssignments.md`](./ferryAssignments.md).

crews refer to a boat by its route and number — "East River 5" — so the staff board prints that
next to the vessel name as a compact `ER5` badge. boat numbers restart per route, so the route
code is part of the label: `ER5` and `AS5` are different boats.

the mapping lives in [`content/boat-assignments.json`](./content/boat-assignments.json), keyed by
GTFS `trip_short_name`. that column in [`gtfs/trips.txt`](./gtfs/trips.txt) holds the same trip
number the published crew schedule uses (`1101`, `4102`), which is what joins the two.

regenerate it when a new seasonal schedule is published, then commit the result:

```bash
pip install openpyxl
python3 scripts/import-boat-assignments.py schedules/summer-2026.xlsx
```

the importer is an offline maintenance step — the kiosk and the Node app never run Python. it
reads every sheet with a `Trip No.` and `Boat` column, tells the two columns apart by magnitude
(trip numbers are four digits, boat numbers are not) because a couple of sheets in the published
workbook fill them in the opposite order, and fails loudly if one trip number claims two boats.

not every trip gets a badge, and that's expected:

- the Rockaway East/West shuttles (`RES`, `RWS`) are buses, not boats.
- the Governors Island shuttle (`GI`) is crewed off-schedule and has no `Boat` column.
- NY Waterway publishes no crew schedule, so those rows stay unlabeled.

the bundled feed and [`schedules/summer-2026.xlsx`](./schedules) cover the same period, and every
other ferry route matches: `AS`, `ER`, `RR`, `SB`, and `SG` at 100%, `RS` at 93 of 96 trips. the
importer prints this coverage per route on every run. a missing or unreadable
`content/boat-assignments.json` is not fatal — the build just omits the badges.

**this has to be redone whenever the GTFS feed changes.** trip numbers are reissued each schedule
period, so an old mapping silently stops matching. [`ferryAssignments.md`](./ferryAssignments.md)
is the step-by-step runbook.

## SFTP landing notices

full file contract and integration notes: [`override.md`](./override.md).

Power Automate never calls the kiosk. it writes a small JSON file to an SFTP server, and each kiosk polls read-only for the one file matching its `landingNumber` — landing 2 reads `/overrides/02.json`, landing 10 reads `/overrides/10.json`.

an active notice hides the departure board, the ad, and the service-alert strip, and replaces them with a full-screen notice panel. a blank message brings the normal display back. the last valid result is cached locally, so an SFTP outage never changes the screen on its own.

### set up the server

1. create `/overrides` on the SFTP server.
2. upload the 25 starter files from [`overrides/`](./overrides) — landings 2 through 26, all blank.
3. give the Power Automate account write access to those files.
4. give each kiosk account read-only access. kiosks must never have write access.
5. record the server's SHA256 host-key fingerprint. from a trusted machine: `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf - -E sha256`. confirm it with the server admin before using it.

then configure [`config/sftp.json`](./config/sftp.json) on each kiosk:

```json
{
  "enabled": true,
  "host": "sftp.example.org",
  "port": 22,
  "username": "nycf-kiosk-readonly",
  "privateKeyPath": "secrets/id_ed25519",
  "privateKeyPassphraseEnv": "NYCF_SFTP_KEY_PASSPHRASE",
  "hostKeySha256": "SHA256:paste_the_verified_server_fingerprint_here",
  "remoteDirectory": "/overrides",
  "pollSeconds": 10,
  "readyTimeoutSeconds": 15,
  "verboseErrors": true
}
```

| key | notes |
|---|---|
| `enabled` | turns notice polling on or off. |
| `privateKeyPath` | absolute, or relative to the project folder. keys belong in the ignored `secrets/` folder — never commit them or bake them into the image. |
| `privateKeyPassphraseEnv` | name of the env var holding the key passphrase. leave the var unset if the key has none. |
| `hostKeySha256` | pins the server identity. required when SFTP is enabled. |
| `pollSeconds` | `5`–`300`. how fast a kiosk sees an update. |
| `readyTimeoutSeconds` | `1`–`60`. |
| `verboseErrors` | adds the underlying stack to the Node console. the health endpoint is always credential-safe either way. |

restart Node after editing SFTP config. notices themselves apply without a restart.

### build the Power Automate flow

1. create an **instant cloud flow** with **manually trigger a flow**.
2. add a **number** input `landingId` and a **text** input `message`.
3. reject anything outside landings 2 through 26 — terminate the flow as failed.
4. add a **compose** action `File name`: `formatNumber(int(<landingId>), '00')` then append `.json`, so landing 2 gives `02.json`.
5. add a **compose** action `Notice` with three properties, filled from the trigger (`updatedAt` uses `utcNow()`):

   ```json
   {
     "landingId": 10,
     "message": "Landing temporarily closed.",
     "updatedAt": "2026-08-06T14:30:00Z"
   }
   ```

6. add **SFTP - SSH: get file metadata using path**, path `/overrides/` + the `File name` output.
7. add **SFTP - SSH: update file**, using that file id and `string(outputs('Notice'))` as the content.
8. save and test. the kiosk updates within `pollSeconds`.

to clear a notice, run the same flow with an empty `message` — don't delete the file:

```json
{
  "landingId": 10,
  "message": "",
  "updatedAt": "2026-08-06T14:35:00Z"
}
```

messages can be up to 2,000 characters. a malformed file, wrong landing id, failed host-key check, or unreachable server is ignored, and the cached state stays on screen.

## offline behavior

- the schedule, landing map, fonts, and display code all live on the device.
- the last good realtime response is written atomically to `state/realtime.json`.
- live vehicle assignments are matched against the local vessel roster to get boat names.
- the alert strip uses the live GTFS-Realtime alert feed and caches to `state/service-alerts.json`.
- the last valid SFTP notice is stored in `state/manual-overrides.json` and survives restarts.
- the service worker caches the shell and API responses; the browser also keeps a last snapshot in local storage.
- if realtime is unavailable, the board falls back to the saved snapshot, then to bundled scheduled times.

## updating the schedule

replace the files in [`gtfs/`](./gtfs) (or [`gtfs/waterway/`](./gtfs/waterway)) when a new feed is published, then restart. the board only ever reads the bundled feed, so deployments stay reproducible and nothing is downloaded at boot.

any edit to `public/index.html` or `public/sw.js` must bump their shared cache-busting version (currently `31`) in both files — `test/display-contract.test.js` checks that they agree.

## Docker

```bash
docker compose up --build -d
```

the service restarts on its own and keeps snapshots in `./state`. with SFTP enabled, mount the private key read-only at the path in `config/sftp.json`:

```yaml
volumes:
  - ./state:/app/state
  - ./secrets/id_ed25519:/app/secrets/id_ed25519:ro
```

if the key is encrypted, pass `NYCF_SFTP_KEY_PASSPHRASE` in through the deployment's secret management.
