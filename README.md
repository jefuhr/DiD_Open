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

### switching landings

the hamburger in the top left opens a drawer listing every landing in
[`config/landings.json`](./config/landings.json), sorted by name with its landing number beside
it. tap one and the board switches; the choice is saved on the device and survives a reload, so
an agent who works one landing sets it once. `Done`, the Escape key, or a tap outside the drawer
all close it.

this is the one place the mobile branch changes the server. the build still bakes
`config/display.json`'s `landingNumber` into `public/data/display-data.json`, and
`/api/display-data` with no parameters still serves exactly that file — the kiosk contract is
untouched. `/api/display-data?landingId=NN` builds that landing on demand instead (about 25ms)
and caches the result for the life of the process, and `/api/landings` supplies the menu. nothing
is prebuilt for the other 24 landings, which would have cost about 5 MB on disk.

one limitation worth knowing: **SFTP landing notices still follow the landing this kiosk is
configured for**, not the one selected in the menu. the poller fetches a single landing's file.
switching to another landing shows its departures, but a notice posted for that landing will not
appear. an unpolled landing returns an inactive notice rather than a stale one, so the failure
mode is a missing notice, never a wrong one.

### the rest

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
  "seastreakEnabled": true,
  "nyuEnabled": true,
  "libertyEnabled": true,
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
| `seastreakEnabled` | `true` / `false` | merge in Seastreak departures. see below. |
| `nyuEnabled` | `true` / `false` | merge in NYU Langone ferry departures. see below. |
| `libertyEnabled` | `true` / `false` | merge in Liberty Landing Ferry departures. see below. |
| `busesEnabled` | `true` / `false` | show connecting shuttle buses. see below. |

the staff board shows every route direction at once and never pages. each departure shows its crew boat assignment, plus the boat name when the live feed has that assignment.

## landings

[`config/landings.json`](./config/landings.json) is the source of truth for which landings exist and which GTFS stops they map to. the build validates against that file, not a hardcoded range, so adding a landing there is all it takes. if that landing is meant to receive SFTP notices, it also needs a file of its own on the SFTP server — see *SFTP landing notices*.

landings `2` through `24` are alphabetical. `25` and `26` were added later so existing kiosk numbers stayed put, and `28` through `31` later still for the same reason. `1` is unused and `27` (Pier C) is the virtual home-port landing. Rockaway (`18`) covers both the ferry landing and the shuttle-bus stop next to it.

Governors Island is two landings because it is two piers a walk apart: `11` Yankee Pier takes NYC Ferry's South Brooklyn boat and the Trust's Red Hook and Brooklyn Bridge Park boats, `29` Soissons Landing takes the Trust's Manhattan boat from the Battery Maritime Building. `28` Whitehall is the Manhattan end of that crossing, shared with the Staten Island Ferry, Seastreak and the Statue of Liberty boats from Battery Park a couple of hundred metres away. `30` Liberty Island and `31` Ellis Island are the far end of that last one. none of `28`, `29`, `30` or `31` is an NYC Ferry stop — see *partner operators* below.

## shuttle buses

`busesEnabled: false` drops every bus route (GTFS `route_type` 3) from the board and leaves the ferries. it affects:

- Rockaway (`18`) — removes the Rockaway East and Rockaway West shuttles.
- any landing showing NY Waterway — removes their shuttle-bus routes, keeps their ferries.

leave the key out entirely and it defaults to `true`.

## out of service, Pier C and crew shuttles

NYC Ferry only, and staff-facing: the board shows what a boat does once it stops carrying passengers.

- **`DROP OFF ONLY`** on a departure — the trip a boat works before it stops, whether that is the end of its day or a shift ending mid-morning. it will drop off and go out of service rather than turn round. not the same as `LAST`: a boat can finish while its route keeps running for hours, and that is precisely the case an agent cannot otherwise see.
- **`DROP OFF?`** — the same, inferred from a gap long enough that nobody should board but short enough that the boat is probably tied up where it is rather than gone. no Pier C row is drawn for these.
- **a `Pier C` card marked `Out of service`** — the home-port run, at the landing where the boat finishes. `NO PICKUP`.
- **a `Pier C` card marked `Crew shuttle`** — a mid-day crew change, shown as a window (`2:35 – 3:05 PM`) because the shuttle waits for its boats to sail. one departure carries the relieved crews off every boat it names, and those boats keep running.

the first three are derived from the boat assignments: group the trips by boat and a boat going out of service becomes a hole in its own day. it works because layovers and shift breaks are cleanly separated in this schedule — layovers reach 44 minutes, the next gap up is 90 — so the two thresholds in `config/crew-shuttles.json` sit in an empty valley. that valley is a property of the schedule, not a law, so re-check them when it changes. routes with no boat number get nothing (Governors Island is crewed off-schedule; the Rockaway shuttles are buses), and partner operators never do, because none of them publishes a crew schedule.

the crew shuttles are derived from nothing at all — neither the GTFS feed nor the schedule workbook mentions them. they live in [`config/crew-shuttles.json`](./config/crew-shuttles.json), are maintained by hand, and **go stale exactly when the schedule changes**. holidays matter here: `gtfs/calendar_dates.txt` is empty, so the feed runs an ordinary weekday on a holiday and the `holidays.dates` list is the only thing that switches the shuttles to the weekend pattern. see [ferryAssignments.md](./ferryAssignments.md).

nothing in this feature edits a published time. every row is an addition.

## partner operators

landings that share a dock with another ferry operator can show its departures next to NYC Ferry's. each operator ships its own GTFS directory, merged at build time by [`scripts/build-data.js`](./scripts/build-data.js).

| operator | feed | id prefix | mark |
|---|---|---|---|
| NY Waterway | [`gtfs/waterway/`](./gtfs/waterway) | `wtr:` | [`public/assets/waterway.png`](./public/assets/waterway.png) |
| Seastreak | [`gtfs/seastreak/`](./gtfs/seastreak) — transcribed, see below | `sea:` | [`public/assets/seastreak.png`](./public/assets/seastreak.png) |
| NYU Langone Ferry | [`gtfs/nyu/`](./gtfs/nyu) — generated, see below | `nyu:` | [`public/assets/nyu.png`](./public/assets/nyu.png) |
| Liberty Landing Ferry | [`gtfs/liberty/`](./gtfs/liberty) — transcribed, see below | `lib:` | [`public/assets/cityferry.png`](./public/assets/cityferry.png) |
| IKEA Brooklyn Ferry | [`gtfs/ikea/`](./gtfs/ikea) — transcribed, see below | `ike:` | text badge, `IKEA` |
| The Trust for Governors Island | [`gtfs/gi/`](./gtfs/gi) — transcribed, see below | `gi:` | [`public/assets/gi.png`](./public/assets/gi.png) |
| Staten Island Ferry | [`gtfs/siferry/`](./gtfs/siferry) — NYC DOT download | `sif:` | text badge, `SIF` |
| Statue City Cruises | [`gtfs/statue/`](./gtfs/statue) — NPS download, seasonal | `sta:` | text badge, route id |

which landings pull which operator:

| landing | NYC Ferry stop | partner stop |
|---|---|---|
| `8` East 34th Street | `17` East 34th Street | Seastreak `168` East 35th St., NYC · NYU `13138` East 34th Street |
| `16` Pier 11 / Wall St | `87` Wall St/Pier 11 | NY Waterway `2439146` Pier 11 / Wall Street · IKEA `pier11` Pier 11 / Wall Street |
| `24` Sunset Park / BAT | `118` Sunset Park/BAT | NYU `13139` Brooklyn Army Terminal |
| `25` Battery Park City / Brookfield Place | `136` Battery Park City/Vesey St. | NY Waterway `2729332` Brookfield Place/Battery Park City · Liberty Landing `2557122` Brookfield Place Terminal |
| `26` Midtown West / Pier 79 | `138` Midtown West/W 39th St-Pier 79 | NY Waterway `2439145` Midtown / W 39th Street · IKEA `midtown` Midtown / W 39th Street |
| `11` Governors Island / Yankee Pier | `111` Governors Island | Trust `govisland` Governors Island / Yankee Pier |
| `28` Battery / Whitehall | none — NYC Ferry does not call here | Staten Island Ferry `whitehall` Whitehall Ferry Terminal · Seastreak `170` Battery Maritime Building Slip 5 · Trust `bmb` Battery Maritime Building / Slip 7 |
| `29` Governors Island / Soissons Landing | none — NYC Ferry does not call here | Trust `soissons` Governors Island / Soissons Landing |
| `22` St. George | `137` St. George | Staten Island Ferry `stgeorge` St. George Ferry Terminal |
| `30` Liberty Island / Statue of Liberty | none — NYC Ferry does not call here | Statue City Cruises `LI` Liberty Island |
| `31` Ellis Island | none — NYC Ferry does not call here | Statue City Cruises `EI` Ellis Island |

each operator has two switches, and either one off means none of its data is read:

- `waterwayEnabled` / `seastreakEnabled` / `nyuEnabled` / `libertyEnabled` / `ikeaEnabled` / `giEnabled` / `siferryEnabled` / `statueEnabled` in `config/display.json` — the whole kiosk.
- `waterwayStopIds` / `seastreakStopIds` / `nyuStopIds` / `libertyStopIds` / `ikeaStopIds` / `giStopIds` / `siferryStopIds` / `statueStopIds` in `config/landings.json` — per landing. only landings with the array populated pull that operator in.

a missing `...Enabled` key means **on**, not off. `config/display.json` is the one file a deploy never overwrites — it holds the box's own `landingNumber` — so a release that adds an operator arrives with its switch absent from the live config, and reading that as off hid the new operator on the very deploy that shipped it, silently. defaulting to on is safe because the switch is not what decides where an operator appears: the per-landing `...StopIds` arrays do, and those live in `config/landings.json`, which every deploy ships. to turn an operator off, say `false` — omitting the key no longer does it.

good to know:

- every departure and route carries an `operator` taken from its feed's `agency.txt`, and the board prints a small operator label under the route name. one feed overrides it: NYC DOT publishes the Staten Island Ferry under the department's legal name, so `operatorName` in `PARTNER_FEEDS` labels those rows `Staten Island Ferry` instead. the override lives in code so a fresh download can't undo it.
- a landing does not have to be an NYC Ferry stop. `28` Whitehall and `29` Soissons Landing are real docks NYC Ferry does not serve, so they carry an empty `stopIds` plus their own `latitude`/`longitude` and are built entirely from partner feeds. a landing with no `stopIds` and no coordinates is rejected by the build.
- partner ids are namespaced with the prefix above so they can't collide with NYC Ferry ids or each other.
- partner badges show the operator's mark instead of the GTFS short name, because those short names are useless to riders — NY Waterway publishes internal all-digit route ids, Seastreak names every route "Seastreak", and NYU and Liberty Landing publish no short name at all. a partner route with a real short name (W44, Greenwich) keeps it.
- Seastreak's headsigns only name a region ("Manhattan", "New Jersey"), so its rows show the trip's last stop instead — Highlands NJ, Atlantic Highlands NJ, Battery Maritime Building. NY Waterway headsigns already name the terminal and are used as published.
- four NY Waterway routes are tagged `route_type` 3 (bus) in the Trillium feed although they are ferries: `19750` Edgewater – Brookfield Place, `19751` Edgewater – Pier 11, `74376` Port Liberte – Pier 11 and `76080` Hoboken/14th St – Pier 11. with `busesEnabled: false` that dropped them from the board entirely — about a third of NY Waterway's service at Pier 11. `WATERWAY_FERRIES_TYPED_AS_BUS` in [`scripts/build-data.js`](./scripts/build-data.js) reclassifies exactly those four. it changes no times, and it lives in code so that dropping in a fresh feed can't quietly reintroduce the bug. everything else typed as a bus in that feed really is one.
- a feed can list the same sailing under two trip ids, which used to render as two identical rows. the build drops a departure only when another one already matches it on service, route, stop, minute *and* destination — a duplicate row, never a time.
- NY Waterway, Seastreak, Liberty Landing, the IKEA boat, the Trust and the Staten Island Ferry publish no realtime feed here, so their rows show scheduled times only: no boat name, no delay badge. that's expected. NYU does have live estimates — see below.
- the Statue of Liberty boats run loops — Battery Park, Liberty Island, Ellis Island, Battery Park, and the mirror of that from Liberty State Park — so a trip's last stop is also its first. rows show the `stop_headsign` NPS puts on each call, naming the island that call is bound for, rather than the trip's final stop, which would tell someone at Battery Park the boat is going to Battery Park. `30` Liberty Island and `31` Ellis Island are landings of their own; Battery Park shares `28` with the Whitehall terminal a couple of hundred metres away.
- **known bad, upstream:** NPS spells Liberty State Park correctly on sixteen calls and `Libery State Park` on one. `headsignFixes` in `PARTNER_FEEDS` corrects that one destination label. it is the only text correction in the build and it touches nothing else — no time, no route, no stop — and a headsign that is merely terse is left as published.
- **known bad, upstream:** the Staten Island Ferry feed has fifteen trips that leave St. George and arrive at St. George twenty-five minutes later — the Whitehall crossing with the wrong stop id on the far end. all fifteen sit on the `threeboat` service, whose calendar is all zeros with no exception dates, so nothing renders them today. the build drops any leg whose next stop is the stop it just left, so St. George cannot advertise boats to itself if a fresh download turns that service on. no published time is changed and no far end is guessed at.
- the Staten Island Ferry feed carries no vehicle data at all: `block_id`, `trip_headsign` and `direction_id` are empty on all 416 trips, and NYC DOT publishes no GTFS-realtime for it. destinations fall through to each trip's final stop, which is what the terminal signs say anyway.
- **known bad, upstream:** at Brookfield Place the board shows the South Amboy boat leaving at 6:50 AM, 7:55 AM, 3:50 PM and 4:50 PM. NY Waterway publishes 6:25 AM, 7:30 AM, 3:25 PM and 4:25 PM. route `77347` in the bundled feed carries a stale set of trips that put Brookfield Place *after* Pier 11 rather than before it; the current trips alongside them are right, and Pier 11's own times are right, so the two afternoon ones are also the duplicates the build now drops there. this is not patched here — correcting it means editing published times, and the real fix is a fresher NY Waterway feed. the bundled one is `UTC: 07-Oct-2025`. check for a newer Trillium release before trusting Brookfield Place's South Amboy rows.
- a partner feed only contributes departures whose service is in effect today. if a third-party feed lapses, its rows silently vanish, so the build prints a `WARNING: the <operator> feed ... expired on <date>` line rather than leaving you to debug an empty row.

to add a partner at another landing, find its `stop_id` in that feed's `stops.txt` and add the matching `...StopIds` array to the landing in `config/landings.json`.

the Seastreak feed is **transcribed, not downloaded** — regenerate it with `node scripts/build-seastreak-gtfs.js`. it used to be the operator's own GTFS (via [transit.land `f-drk-seastreak`](https://www.transit.land/feeds/f-drk-seastreak), published at `https://seastreak.com/api/transit/google_transit.zip`), which carried a 2020 `feed_start_date`, times that no longer matched the printed schedule, and — because every sailing appears in both of Seastreak's printed tables — the same boat offered as two separate boardings at the same pier at the same minute, eighteen times over at the three piers this board watches.

it is now read from the operator's weekday schedule PDF, currently *Effective August 10, 2026*. two things about that source are worth knowing before re-reading it:

- **the tables are headed `Departures` on the boarding side and `Arrivals` on the far side, and that is taken literally.** on a New Jersey departure the Manhattan calls are drop-off only; on a New York departure the New Jersey calls are. this is what stops one boat being advertised as two. it is *not* true that the New York table reprints every Manhattan call the New Jersey table makes — the morning Belford boats run Battery Maritime, Brookfield, Paulus Hook and West 39th in sequence with no return working, and the timetable never offers a seat from one Manhattan pier to another on them.
- **times printed in red do not run on Fridays.** colour does not survive a text extraction, so those rows are read out of the PDF's content stream and carried as a second calendar (`ss-mon-thu`). thirteen of the forty-three sailings are Monday-to-Thursday only.

the feed is **weekday-only**, as the download it replaced also was — that feed had no Saturday or Sunday sailing on this route either. Seastreak's Massachusetts routes (New Bedford, Nantucket, Martha's Vineyard) were in the download and are deliberately not here: no landing on this board is within two hundred miles of them. the calendar runs `20260810`–`20271231` and then lapses, so a transcription cannot quietly outlive the timetable it came from.

the Statue of Liberty ferry feed is the National Park Service's, published at `https://www.nps.gov/external-resources/gtfs/stli/statue-of-liberty-ferries.zip` and listed on [NPS developer resources](https://www.nps.gov/subjects/developer/gtfs.htm). the bundled copy is feed version `20260601`, and it is **seasonal**: its only calendar runs `20260523`–`20260907`, so its rows stop appearing after that until a fresh copy is dropped in. the badge shows the feed's route id (`NY`, `NJ`, `LIBP`, `EILILSP`) because NPS publishes no route short names and no operator mark ships with this repo — the route's full name sits beside it.

the Staten Island Ferry feed is NYC DOT's own, published at `https://www.nyc.gov/html/dot/downloads/misc/siferry-gtfs.zip` and listed on [NYC Open Data](https://data.cityofnewyork.us/Transportation/Staten-Island-Ferry-Schedule-General-Transit-Feed-/b57i-ri22). the bundled copy is `siferry-gtfs_2026.1`, feed version `18`, covering `20260101`–`20280117`. it is a plain download: drop in a fresh one and restart.

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

## the IKEA Brooklyn ferry is transcribed, and seasonal

**NY Waterway runs it; their GTFS doesn't mention it.** [`gtfs/waterway/`](./gtfs/waterway) has no IKEA route, no Red Hook stop, and no weekend service on any Pier 11 route. the only place the operator publishes this timetable is [nywaterway.com/ikea.aspx](https://www.nywaterway.com/ikea.aspx), and there only as a **JPEG of a table**. so [`scripts/build-ikea-gtfs.js`](./scripts/build-ikea-gtfs.js) transcribes it, the same way Liberty Landing is handled.

- free, Saturdays and Sundays only, between Midtown / W 39th St, Pier 11 / Wall St and the pier behind the store at 1 Beard Street.
- six sailings each way. the last one out of Midtown (5:55 PM) is printed with its Pier 11 cell blacked out — it runs non-stop, so Pier 11 sees five southbound boats and Midtown six.
- the badge reads `IKEA` rather than an operator mark: NY Waterway's other routes are all commuter runs across the Hudson, so the mark would tell a rider less than the name does.

two things to know before trusting it:

- **the operator's "Arrive Midtown" column is not usable.** it prints five minutes after the Pier 11 arrival on every row, for a leg the same page gives as thirty minutes southbound — and on the 2:20 PM sailing it prints an arrival at Midtown *before* the boat reaches Pier 11. every departure is transcribed as published; that one terminal arrival is derived as Pier 11 + 30 min. it is never shown, because a trip's last stop is never a departure.
- **it expires on purpose.** the service pauses over the winter and NY Waterway reissues the image under a new filename every month or two, with no end date on the page. `SEASON_DAYS` bounds the generated calendar to 90 days so the feed lapses loudly — the build warns and the IKEA rows stop — rather than advertising sailings that don't run. re-read the page and re-run the script when `SOURCE_CHECKED_ON` gets old.

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

an active notice hides the departure board and the service-alert strip, and replaces them with a full-screen notice panel. a blank message brings the normal display back. the last valid result is cached locally, so an SFTP outage never changes the screen on its own.

### set up the server

1. create `/overrides` on the SFTP server.
2. create one file per landing that should be able to receive a notice, named for its landing number — `02.json` through `31.json`. each starts blank: `{"landingId": 2, "message": ""}`. (these no longer ship in the repo; a blank file is the whole format.)
3. give the Power Automate account write access to those files.
4. give each kiosk account read-only access. kiosks must never have write access.
5. record the server's SHA256 host-key fingerprint. from a trusted machine: `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf - -E sha256`. confirm it with the server admin before using it.

then configure `config/sftp.json` on each kiosk. it carries a host, a username and a key path, so it is deployment secrets rather than source and is **not committed** — create it on the box. with no such file the poller stays off and the rest of the board runs normally; a file that exists and is malformed still fails loudly, because that is a kiosk that was meant to receive notices and cannot.

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

**the service worker does not run on juliet.nyc.** the board is proxied at `/ferryTimesMobile/`, and the proxy forwards only `/ferryTimesMobile/`, `/app.js`, `/styles.css`, `/assets/` and `/api/` to this server — everything else at the root belongs to the landing page. `app.js` registers the worker from `/sw.js`, which is not one of those paths, so it 404s and the worker has never installed there. the cache-busting version bumps are real for a board served at the root and ceremonial on juliet.nyc.

two lines of nginx fix it, alongside the existing `location = /app.js` rules:

```nginx
location = /sw.js { proxy_pass http://ferry_did; include /etc/nginx/snippets/juliet-proxy.conf; }
```

the precache list also names `/` and `/index.html`, which under that host are the landing page rather than the board, so those entries need to become `/ferryTimesMobile/` before `cache.addAll` can succeed. until both are done, offline means the browser's own cache and nothing more.

the web app manifest is served from `/assets/` precisely because of this: it is a path the proxy already forwards.

- the schedule, landing map, fonts, and display code all live on the device.
- the last good realtime response is written atomically to `state/realtime.json`.
- live vehicle assignments are matched against the local vessel roster to get boat names.
- the alert strip uses the live GTFS-Realtime alert feed and caches to `state/service-alerts.json`. tapping it opens the full list, grouped by whose service each alert belongs to.
- alongside NYC Ferry's own alerts the strip carries **major MTA subway closures** — suspensions and part-suspensions only, active now or starting within 24 hours, from MTA's public `camsys/subway-alerts` feed (no key). delays, reroutes, skipped stops and station notices are deliberately excluded. **NYC Ferry alerts always come first**, and a subway feed going down can never make the ferry's own alerts unavailable.
- **Staten Island Ferry alerts are wired but dormant.** NYC DOT publishes no realtime feed and siferry.com renders its status in the browser, so 511NY is the only machine-readable source and it needs a free key. set `SIFERRY_ALERTS_KEY` in the environment and the source activates on the next poll; without it the source reports `disabled` rather than failing. the 511NY normaliser has never been run against a live response — see `lib/transit-alerts.js`.
- the last valid SFTP notice is stored in `state/manual-overrides.json` and survives restarts.
- the service worker caches the shell and API responses; the browser also keeps a last snapshot in local storage.
- if realtime is unavailable, the board falls back to the saved snapshot, then to bundled scheduled times.

## updating the schedule

replace the files in [`gtfs/`](./gtfs) — or in a partner's directory, `gtfs/waterway/` and `gtfs/siferry/` — when a new feed is published, then restart. five directories have no upstream file to drop in and are regenerated instead: `gtfs/nyu/` with `node scripts/fetch-nyu-gtfs.js`, `gtfs/liberty/` with `node scripts/build-liberty-gtfs.js`, `gtfs/ikea/` with `node scripts/build-ikea-gtfs.js`, `gtfs/gi/` with `node scripts/build-gi-gtfs.js`, and `gtfs/seastreak/` with `node scripts/build-seastreak-gtfs.js` (re-read the operator's page or PDF first — those last four are transcriptions). the board only ever reads the bundled feed, so deployments stay reproducible and nothing is downloaded at boot.

any edit to `public/index.html`, `public/sw.js`, `public/app.js` or `public/styles.css` must bump the shared cache-busting version (currently `57`) in `index.html` and `sw.js` — `test/display-contract.test.js` checks that they agree.

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
