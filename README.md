#ferry did OPEN

an offline-first `16:9` departure display for Ferry landings. a local Node server builds scheduled departures from the bundled GTFS feed, overlays NYC Ferry GTFS-Realtime trip updates, and keeps working when the internet drops.

## run it

needs Node.js 22 or newer.

```bash
npm ci
npm start
```

open `http://127.0.0.1:8090`. the kiosk launches Chromium at that address. the server binds to loopback only unless you set `HOST=0.0.0.0`.

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
  "departuresShown": 3,
  "routesShown": 4,
  "waterwayEnabled": true,
  "seastreakEnabled": true,
  "nyuEnabled": true,
  "libertyEnabled": true,
  "busesEnabled": false
}
```

| setting | range | what it does |
|---|---|---|
| `landingNumber` | `2`–`26` | which landing this kiosk shows. `1` is unused. |
| `slideSeconds` | `3`–`300` | how long each page of routes stays on screen. |
| `departureWindowMinutes` | `1`–`1440` | a route only appears if its next departure is within this many minutes. once it qualifies, the board still fills every departure column, even with later trips outside the window. |
| `departuresShown` | `1`–`5` | departure columns per route row. |
| `routesShown` | `1`–`5` | route rows per page. |
| `waterwayEnabled` | `true` / `false` | merge in NY Waterway departures. see below. |
| `seastreakEnabled` | `true` / `false` | merge in Seastreak departures. see below. |
| `nyuEnabled` | `true` / `false` | merge in NYU Langone ferry departures. see below. |
| `libertyEnabled` | `true` / `false` | merge in Liberty Landing Ferry departures. see below. |
| `busesEnabled` | `true` / `false` | show connecting shuttle buses. see below. |

the board pages through every route direction on its own, then starts over. each departure shows its boat name when the live feed has that assignment.

## landings

[`config/landings.json`](./config/landings.json) is the source of truth for which landings exist and which GTFS stops they map to. the build validates against that file, not a hardcoded range, so adding a landing there (plus a matching `overrides/NN.json`) is all it takes.

landings `2` through `24` are alphabetical. `25` and `26` were added later so existing kiosk numbers stayed put. Rockaway (`18`) covers both the ferry landing and the shuttle-bus stop next to it.

## shuttle buses

`busesEnabled: false` drops every bus route (GTFS `route_type` 3) from the board and leaves the ferries. it affects:

- Rockaway (`18`) — removes the Rockaway East and Rockaway West shuttles.
- any landing showing NY Waterway — removes their shuttle-bus routes, keeps their ferries.

leave the key out entirely and it defaults to `true`.

## partner operators

landings that share a dock with another ferry operator can show its departures next to NYC Ferry's. each operator ships its own GTFS directory, merged at build time by [`scripts/build-data.js`](./scripts/build-data.js).

| operator | feed | id prefix | mark |
|---|---|---|---|
| NY Waterway | [`gtfs/waterway/`](./gtfs/waterway) | `wtr:` | [`public/assets/waterway.png`](./public/assets/waterway.png) |
| Seastreak | [`gtfs/seastreak/`](./gtfs/seastreak) | `sea:` | [`public/assets/seastreak.png`](./public/assets/seastreak.png) |
| NYU Langone Ferry | [`gtfs/nyu/`](./gtfs/nyu) — generated, see below | `nyu:` | [`public/assets/nyu.png`](./public/assets/nyu.png) |
| Liberty Landing Ferry | [`gtfs/liberty/`](./gtfs/liberty) — transcribed, see below | `lib:` | [`public/assets/cityferry.png`](./public/assets/cityferry.png) |

which landings pull which operator:

| landing | NYC Ferry stop | partner stop |
|---|---|---|
| `8` East 34th Street | `17` East 34th Street | Seastreak `168` East 35th St., NYC · NYU `13138` East 34th Street |
| `16` Wall St / Pier 11 | `87` Wall St/Pier 11 | NY Waterway `2439146` Pier 11 / Wall Street |
| `24` Sunset Park / BAT | `118` Sunset Park/BAT | NYU `13139` Brooklyn Army Terminal |
| `25` Battery Park City / Brookfield Place | `136` Battery Park City/Vesey St. | NY Waterway `2729332` Brookfield Place/Battery Park City · Liberty Landing `2557122` Brookfield Place Terminal |
| `26` Midtown West / Pier 79 | `138` Midtown West/W 39th St-Pier 79 | NY Waterway `2439145` Midtown / W 39th Street |

each operator has two switches, and either one off means none of its data is read:

- `waterwayEnabled` / `seastreakEnabled` / `nyuEnabled` / `libertyEnabled` in `config/display.json` — the whole kiosk.
- `waterwayStopIds` / `seastreakStopIds` / `nyuStopIds` / `libertyStopIds` in `config/landings.json` — per landing. only landings with the array populated pull that operator in.

good to know:

- every departure and route carries an `operator` taken from its feed's `agency.txt`, and the board prints a small operator label under the route name.
- partner ids are namespaced with the prefix above so they can't collide with NYC Ferry ids or each other.
- partner badges show the operator's mark instead of the GTFS short name, because those short names are useless to riders — NY Waterway publishes internal all-digit route ids, Seastreak names every route "Seastreak", and NYU and Liberty Landing publish no short name at all. a partner route with a real short name (W44, Greenwich) keeps it.
- Seastreak's headsigns only name a region ("Manhattan", "New Jersey"), so its rows show the trip's last stop instead — Highlands NJ, Atlantic Highlands NJ, Battery Maritime Building. NY Waterway headsigns already name the terminal and are used as published.
- NY Waterway, Seastreak and Liberty Landing publish no realtime feed here, so their rows show scheduled times only: no boat name, no delay badge. that's expected. NYU does have live estimates — see below.
- a partner feed only contributes departures whose service is in effect today. if a third-party feed lapses, its rows silently vanish, so the build prints a `WARNING: the <operator> feed ... expired on <date>` line rather than leaving you to debug an empty row.

to add a partner at another landing, find its `stop_id` in that feed's `stops.txt` and add the matching `...StopIds` array to the landing in `config/landings.json`.

the Seastreak feed comes from [transit.land `f-drk-seastreak`](https://www.transit.land/feeds/f-drk-seastreak), published at `https://seastreak.com/api/transit/google_transit.zip`.

## the Liberty Landing Ferry timetable is transcribed

Liberty Landing Ferry crosses between Liberty Landing Marina and Warren Street in Jersey City and Brookfield Place Terminal, whose dock is ~35 m from NYC Ferry's Battery Park City/Vesey St. — so it belongs at landing `25`.

**the ferry runs; its GTFS does not.** the operator rebranded to Liberty Landing City Ferry under Statue City Cruises/Hornblower and moved to [libertylandingcityferry.com](https://www.libertylandingcityferry.com/), leaving the old domain in the feed's `agency.txt` dead. the only GTFS ever published — [transit.land `f-libertylandingferry~ny~us`](https://www.transit.land/feeds/f-libertylandingferry~ny~us), via Trillium — was last modified **30 Aug 2019** and its calendar lapsed on **2020-08-01**.

that feed is not reused, and its dates were not rolled forward. service went hourly in 2020, so the 2019 half-hourly feed would have put **16 sailings a weekday on the board that do not exist** — every `:15` departure plus the 20:45. that is the static-schedule version of an early departure, and [`gtfsferry.md`](./gtfsferry.md) covers it.

instead [`scripts/build-liberty-gtfs.js`](./scripts/build-liberty-gtfs.js) generates `gtfs/liberty/` from the timetable the operator publishes today:

```
node scripts/build-liberty-gtfs.js
```

| | departs Liberty Landing | departs Warren St | departs Brookfield Place | departs Warren St |
|---|---|---|---|---|
| weekdays | `:30`, 6:30am–7:30pm | `:32` | `:45`, 6:45am–7:45pm | `:55` |
| weekends | `:30`, 9:30am–7:30pm | `:32` | `:45`, 9:45am–7:45pm | `:55` |

**this one is a transcription, not a download** — there is no machine-readable source, so it carries obligations the other feeds don't:

- re-check it against the operator's page when `SOURCE_CHECKED_ON` in the script gets old. the generated calendar is deliberately bounded to 180 days so it expires loudly (the build warns on a lapsed partner feed) rather than drifting silently.
- the operator publishes departure times only. the two arrivals it doesn't print are derived from the 2019 feed's running times, which still hold exactly: 6:30 +2 = 6:32, +13 = 6:45, +10 = 6:55 reproduces every printed time.
- the operator says "weekdays except major holidays" but publishes no list, so **no holiday exceptions are encoded** and a holiday will show sailings that don't run. `overrides/25.json` is the way to cover a known closure.
- stop ids are carried over from the Trillium feed unchanged so `config/landings.json` keeps working; only `2557122` was renamed, World Financial Center → Brookfield Place.

## the NYU Langone ferry

NYU runs a weekday ferry between East 34th Street and the Brooklyn Army Terminal, so it shows up at landings `8` and `24` — opposite ends of the same crossing. it is the only partner here that publishes no GTFS at all: the service exists only inside its [Passio GO](https://nyu.passiogo.com) app, and Passio's own `google_transit.zip` export is access-denied.

so `gtfs/nyu/` is **generated, not downloaded**. [`scripts/fetch-nyu-gtfs.js`](./scripts/fetch-nyu-gtfs.js) reconstructs an equivalent static feed from Passio's JSON backend and writes the `.txt` files, which are committed so a build never touches the network:

```
node scripts/fetch-nyu-gtfs.js
```

it probes a full week to see which days actually run rather than assuming, which is how the Mon–Fri calendar and the 30-minute crossing in the feed were derived. re-run it when NYU changes its timetable. no API key is involved — Passio's `deviceId` parameter is a client id, not a credential.

live estimates come from the same backend via [`lib/nyu-realtime.js`](./lib/nyu-realtime.js) and ride along in `/api/realtime` under the same `nyu:` ids, so the board matches both operators through one lookup. two things about that feed are worth knowing:

- Passio predicts when a boat **arrives** at a terminal, and a ferry that ties up early then waits for its timetable is not an early departure. the [no-early-departure rule](./gtfsferry.md) applies to NYU exactly as it does to NYC Ferry.
- Passio's `solidEta.scheduledDeparture` names the *block's* first sailing, not the one the boat is about to work — a 09:22 arrival comes back tagged `06:00`. it is deliberately ignored; the sailing is resolved from the timetable instead. see the comments in `lib/nyu-realtime.js`.

if Passio is unreachable the board falls back to the last snapshot, then to published times. NYU rows never block NYC Ferry's own estimates and vice versa.

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

- the schedule, landing map, fonts, logo, display code, and ad all live on the device.
- the last good realtime response is written atomically to `state/realtime.json`.
- live vehicle assignments are matched against the local vessel roster to get boat names.
- the alert strip uses the live GTFS-Realtime alert feed and caches to `state/service-alerts.json`.
- the last valid SFTP notice is stored in `state/manual-overrides.json` and survives restarts.
- the service worker caches the shell, the ad, and API responses; the browser also keeps a last snapshot in local storage.
- if realtime is unavailable, the board falls back to the saved snapshot, then to bundled scheduled times.

the ad artwork is [`public/assets/ad.jpg`](./public/assets/ad.jpg), cached offline with everything else.

## updating the schedule

replace the files in [`gtfs/`](./gtfs) — or in a partner's directory, `gtfs/waterway/`, `gtfs/seastreak/` and `gtfs/liberty/` — when a new feed is published, then restart. `gtfs/nyu/` is the exception: it has no upstream file to drop in, so regenerate it with `node scripts/fetch-nyu-gtfs.js`. the board only ever reads the bundled feed, so deployments stay reproducible and nothing is downloaded at boot.

any edit to `public/index.html` or `public/sw.js` must bump their shared cache-busting version (currently `28`) in both files — `test/display-contract.test.js` checks that they agree.

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
