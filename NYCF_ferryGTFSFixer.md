# NYCF Ferry GTFS Fixer

How a boat gets predicted onto the board, from `stop_times.txt` to the words `+7 min`.

[`gtfsferry.md`](./gtfsferry.md) states the operating rule and the obligations it puts on any implementation. This document is the mechanism: every transformation applied to NYC Ferry's GTFS-Realtime feed between the wire and the screen, why each one exists, and what breaks without it. [`NYCF_ferryGTFSFixer.example.js`](./NYCF_ferryGTFSFixer.example.js) is the companion — every function named here, in one runnable file, in pipeline order.

```bash
node NYCF_ferryGTFSFixer.example.js
```

No dependencies, no network. All output quoted in this document comes from that file.

Scope: NYC Ferry's own prediction path only. Partner operators sharing a landing are a separate concern, covered in [`README.md`](./README.md). Stages 1–6 are the realtime pipeline as this branch runs it; [Scheduled boat prediction](#scheduled-boat-prediction) documents the workbook-derived vessel data from a newer version of the project, whose code is not in this branch.

## Why "fixer"

A raw GTFS-Realtime feed is not a departure board. It is a stream of assertions about vehicles, in a schema general enough to describe systems that behave nothing like NYC Ferry, encoded in a format whose defaults are indistinguishable from silence. Between that and a rider standing on a platform there are about a dozen specific corrections, and none of them are inferable from the feed itself.

| The feed says | A naive consumer shows | What the fixer does | Where |
|---|---|---|---|
| `delay: -240` | A departure 4 minutes early | Clamps to 0 — boats arrive early, they don't leave early | `riderDepartureDelaySeconds` |
| Nothing (protobuf default `delay: 0`) | `ON TIME` for a boat nobody has heard from | `Object.hasOwn` distinguishes silence from an assertion | `eventDelaySeconds`, `timingEvent` |
| A predicted `arrival` | A departure pulled forward to the docking time | Arrival is a floor on departure, never an advance | `timingEvent` + clamp |
| An epoch timestamp | A time that is right only on an ET machine, and wrong twice a year | Converts through `Intl` in the agency's timezone | `localSecondsOfDay` |
| `departure_time: 25:10:00` | An invalid clock reading, or a trip that vanishes after midnight | Seconds-of-service-day throughout; two service dates walked | `timeToSeconds`, `routeDirectionGroups` |
| No update at this landing | `SCHEDULED`, discarding a delay it already knows | Falls back to trip-level, then upstream-stop delay | `normalizeTripUpdates` |
| No stop update at all for a trip | The trip disappears | Target stops come from the local schedule, not the message | `landingStopsByTrip` |
| `H101` / `HB0101` / `H-101` | Three different boats, or no boat name | Folds hull-number forms to one identity | `identityForms` |
| A boat name only in the trip-update feed | A blank column for the boat at the dock | Reads vehicle descriptors from both feeds | `normalizeVehicleAssignments` |
| Nothing at all (producer down) | A blank board, or yesterday's delays | Last snapshot, marked stale → published times | `createRealtimeService` |

## The rule everything serves

```text
rider_departure = max(static_departure, realtime_predicted_departure)
effective_delay = max(0, realtime_delay)
```

Realtime may move a departure later, cancel it, or reveal which boat is working it. It may never move a departure earlier. GTFS-Realtime permits negative delay because the spec serves systems whose vehicles run ahead of schedule; NYC Ferry is not one, and a generic consumer cannot infer that from the feed. So it is enforced, explicitly, at every boundary that can supply a delay:

- `lib/realtime.js:50` — `riderDepartureDelaySeconds`, before any update reaches `/api/realtime`.
- `public/app.js:116` — again while building departure groups, because a delay can also arrive from `localStorage` or an older server snapshot.

Two layers is not redundancy; it is two different sources of a delay, each responsible for itself. `gtfsferry.md` lists a third, at the boundary of the one partner feed that carries live estimates.

## The pipeline

```
gtfs/*.txt ──► scripts/build-data.js ──► public/data/display-data.json
                                              │  departures[] + tripSchedules{}
                                              ▼
connexionz /tripupdate ─────┐          ┌─ normalizeTripUpdates ──► updates[]
                            ├─► lib/   │       (delay ladder + clamp)
connexionz /vehicleposition ┘  realtime │
                                        └─ normalizeVehicleAssignments ──► vehicles[]
                                                (fleet identity match)
                                              │
                              server.js ──────┴──► /api/realtime  (15s TTL, single-flight)
                                              │        state/realtime.json
                                              ▼
                              public/app.js ─────► routeDirectionGroups ──► the board
                                                     (clamp again, 15s poll)
```

Two things travel down this pipe and they are kept strictly separate: **timing** (a clamped delay per trip+stop) and **identity** (which hull is working the trip). They come from different feeds, fail independently, and neither one failing may take the other down.

---

## Stage 1 — the static schedule is the ground truth

The board only ever reads the GTFS bundled in [`gtfs/`](./gtfs), so deployments stay reproducible and nothing is downloaded at boot. `scripts/build-data.js` reads that feed and writes `public/data/display-data.json`. Two structures in that file are what make prediction possible at all.

**`departures[]`** — one row per (trip, landing stop) a rider can board. Built by walking each trip's `stop_times` in `stop_sequence` order and taking every stop that is one of this landing's stops, is not `pickup_type: 1` (no pickup), and is not the trip's final stop — the last call of a trip is an arrival, not a boardable departure.

**`tripSchedules{}`** — every stop of every one of those trips, *including the stops this landing does not serve*, each with `arrivalSeconds` and `departureSeconds`.

That second structure is easy to mistake for dead weight. It is the reason a delay observed three stops upstream can be shown here. An absolute prediction is only convertible into a delay if you know what that stop was scheduled for; without `tripSchedules` the upstream rung of the delay ladder has nothing to difference against and silently returns `null`.

Times are stored as **seconds since the start of the service day**, never as epoch instants. GTFS hours run past 24 — `25:10:00` is 1:10 am on the next calendar day, still belonging to the previous service day — and keeping that representation end to end is what makes the whole pipeline DST-proof. Nothing in the prediction path ever adds 86400 to a wall clock.

Which landing gets built comes from `landingNumber` in [`config/display.json`](./config/display.json), validated against [`config/landings.json`](./config/landings.json) — the source of truth for which landings exist and which GTFS stops each maps to. A landing can map to more than one stop, which is why the realtime layer treats "this landing's stops" as a set rather than a single id.

Relevant functions: `parseCsv`, `timeToSeconds`, `isoDate`, `buildScheduleShapes` (§1 of the example file).

## Stage 2 — ingest

Two protobuf feeds, both from NYC Ferry's Connexionz producer:

| Feed | URL | Carries |
|---|---|---|
| Trip updates | `.../gtfsrealtime.aspx/tripupdate` | Delays, cancellations, and — importantly — vehicle descriptors |
| Vehicle positions | `.../gtfsrealtime.aspx/vehicleposition` | Vehicle descriptors, generally for boats underway |

Both are overridable with `NYCF_TRIP_UPDATES_URL` / `NYCF_VEHICLE_POSITIONS_URL`.

`fetchFeed` applies three guards, each for a failure that has a real consequence on a kiosk:

- **7-second abort** via `AbortController` — a hung producer must not stall the poll loop, because a stalled loop means a frozen board.
- **Non-2xx throws** before decoding — an HTML error page decoded as protobuf yields garbage entities, which is worse than no data.
- **5 MB cap** on the response — a runaway response cannot exhaust an unattended device's memory.

The vehicle-positions fetch is wrapped in `.catch(() => null)`. Losing boat names must never cost the board its delays.

## Stage 3 — resolving a delay

This is the core of the fixer. `normalizeTripUpdates` turns the whole feed into one clamped update per (trip, landing stop).

### 3.1 Two indexes first

```js
schedule:            "tripId|stopId" → scheduled seconds   // departures[] ∪ tripSchedules{}
landingStopsByTrip:  tripId → Set(this landing's stops on that trip)
```

`landingStopsByTrip` is built from the **local schedule**, not from the message. The set of trips this landing boards is known locally, so a producer that omits this landing's stop from a message cannot make the trip disappear from the board. Only if the trip is unknown locally does the code fall back to whatever stops the message happens to carry.

A trip with no target stops is skipped entirely.

### 3.2 Picking the event: departure beats arrival

```js
timingEvent(stopUpdate)  // departure if populated, else arrival, else null
```

A rider wants to know when the boat *leaves*. An arrival is consulted only when there is no departure event at all, and even then it can only push a departure later — never pull it earlier. A boat that ties up at 09:02 for a 09:30 sailing is waiting on its timetable, not departing 28 minutes early.

### 3.3 The `Object.hasOwn` subtlety

This one line is load-bearing in a way that is invisible on inspection:

```js
if (Object.hasOwn(event, "delay")) return number(event.delay);
```

A decoded protobuf message **inherits `delay: 0` from its prototype**. A plain `event.delay` read therefore cannot distinguish "the producer says on time" from "the producer sent no delay field at all" — and reading the inherited zero would stamp `ON TIME` on a boat nobody has heard from, which is the single most misleading thing a departure board can do. It asserts knowledge that does not exist.

Only an *own* property is a real assertion. Absent that, the code falls through to the absolute timestamp. `timingEvent` applies the same test when deciding whether a departure/arrival event is populated at all.

### 3.4 Absolute timestamp → delay

When the producer sends `time` instead of `delay`:

```js
delay = localSecondsOfDay(predicted, timeZone) - (scheduledSeconds % 86400)
if (delay >  43200) delay -= 86400
if (delay < -43200) delay += 86400
```

Three separate corrections in four lines:

- **`localSecondsOfDay`** converts the epoch instant through `Intl.DateTimeFormat` in the *agency's* timezone, not the process's. The answer is correct on a kiosk set to UTC, and correct on both sides of a DST change.
- **`% 86400`** folds a past-midnight GTFS time (`25:10:00`) back onto a wall clock so it can be differenced against a wall-clock reading.
- **The ±12h correction** resolves the ambiguity that folding creates. A raw difference near ±86400 is a midnight wrap, not a half-day delay. Without it, a 00:05 sailing predicted at 00:07 reads as 23 hours and 58 minutes early.

### 3.5 The delay ladder

Per landing stop, in order, each rung a weaker claim than the one above:

1. **The stop's own delay** — the producer spoke about this stop specifically.
2. **The trip-level `delay`** — the whole boat is running late. Also `Object.hasOwn`-guarded.
3. **The nearest predicted stop** — the first stop anywhere on the trip with a usable delay, in feed order. Feed order is roughly route order, so this is the most recent thing known about the boat.

```js
const predictedDelay = landingUpdate?.delaySeconds ?? tripDelaySeconds ?? nearestStopDelay;
```

`??` and not `||`, so a genuine `0` (on time) at a stronger rung is not discarded in favor of a weaker one.

All three rungs are clamped identically. **A fallback may delay a departure; it may never advance one.** An inherited delay is a guess about a stop the producer did not speak about, and a guess is not grounds for telling a rider their boat leaves earlier than published.

### 3.6 Cancellation

```js
canceled: number(tripUpdate.trip?.scheduleRelationship) === 3
```

`ScheduleRelationship 3` is `CANCELED`. This is orthogonal to the clamp and is always honored: a canceled trip is removed from the board, not displayed as very late. Note the ordering consequence on the client — the cancellation check runs *before* the staleness check, so a feed outage does not resurrect a sailing that was canceled while the feed was up.

### 3.7 The output shape

```js
{ tripId, stopId, delaySeconds, predictedEpochSeconds, canceled }
```

`delaySeconds` is clamped and rider-facing. `predictedEpochSeconds` is the raw, *unclamped* prediction — retained for diagnostics, read by nothing rider-facing.

## Stage 4 — which boat is it

Identity is a separate problem with a separate failure mode, and it is the one place the pipeline does fuzzy matching. Each departure shows its boat name whenever the live feed carries that assignment; the roster it matches against is [`content/vessels.json`](./content/vessels.json), on the device.

The feeds identify a vessel with a `VehicleDescriptor` — some combination of `label`, `id`, `licensePlate`. The same hull appears as `H-101` in the roster, `H101` in one feed's label, `HB0101` in an AVL id, and `NYCF HB0101` when someone decorated it.

```js
normalizeIdentity("H-101")   // "h101"     — strip accents, case, punctuation
identityForms("HB0101")      // ["hb0101", "h101"]   — /^hb?0*(\d+)$/ folds the B and zero padding
```

`matchFleetVessel` then scores every candidate form against every roster form:

| Matched against | Score | Why |
|---|---|---|
| `vessel.number` (hull) | 90 | The operator's own identifier for the hull. Most trustworthy. |
| `vessel.name` | 80 | Reliable, but a name can incidentally appear inside another string. |
| `vessel.id` (internal slug) | 70 | Local convention, weakest claim. |

Containment counts (`candidate.includes(identity)`), because labels arrive decorated. The highest score wins, so a hull-number hit is never displaced by an incidental name substring.

Two details that matter more than the scoring:

**Both feeds are read for descriptors.** `entity.vehicle || entity.tripUpdate` is not a typo. NYC Ferry's producer attaches a vehicle descriptor to trip updates too, and for a boat sitting at its terminal that is frequently the only place the assignment appears — the vehicle-positions feed may not carry it until the boat is underway. Reading both is the difference between naming the *next* departure's boat and only naming the one after it.

**Merge order encodes freshness, not feed preference.**

```js
vehicleFeed ? merge(tripUpdates, positions)        // positions fresher → win
            : merge(cachedPositions, tripUpdates)  // cache is older → fresh trip updates win
```

Last source wins per trip id. When the vehicle feed is up, its positions are authoritative. When it is down, the *cached* positions are merged first so today's fresh trip-update assignments overwrite yesterday's remembered ones.

An unmatched descriptor still yields its raw label rather than nothing — a rider gains more from `H109` than from a blank space.

Everything above is feed-derived: a boat gets a name only once the producer has said something about its trip. A newer version of this project predicts the vessel *before* the feed reaches the sailing, from the seasonal crew workbook — see [Scheduled boat prediction](#scheduled-boat-prediction) below.

## Stage 5 — cache, serve, degrade

`createRealtimeService` holds the polling contract:

- **15-second TTL.** One snapshot serves every caller, so N kiosks and N browser tabs remain one upstream request.
- **Single-flight.** An `inflight` promise collapses concurrent cache misses into one fetch.
- **Atomic persistence.** The snapshot is written to `state/realtime.json` via temp file + `rename()`, so a kiosk losing power mid-write cannot leave a truncated file that poisons the next boot.
- **Never worse than stale.** A failed refresh returns the last good snapshot with `stale: true`. Only a cold cache reports `available: false`, and `/api/realtime` then answers `503` instead of `200`.

`stale` is not cosmetic. It is a contract with the client: *stop trusting these delays*. The client honors it by discarding every delay and showing published times.

## Stage 6 — the board

`public/app.js` polls `/api/realtime` every 15 seconds, mirrors each response to `localStorage`, and falls back to that copy (marked `stale`) when the local server is unreachable — `loadRealtime` in §5 of the example file. The service worker caches the shell and API responses, so the whole board survives a network drop on locally held data. `routeDirectionGroups` then does the final assembly, and re-derives the safety properties rather than assuming them.

**Two service days are walked** (`offset` from `-1` to `0`). A 00:30 sailing is `24:30:00` on the *previous* service day and would be invisible after midnight if only today were considered. `addDays(serviceDate, Math.floor(seconds / 86400))` then drops rows whose calendar date is not today.

**Service selection** is `calendar.txt` windows for the weekday, with `calendar_dates.txt` exceptions layered on top — additions add, removals delete.

**Staleness is all-or-nothing.**

```js
const hasLiveTiming = !realtime.stale && update?.delaySeconds != null && Number.isFinite(liveDelay);
const delay = hasLiveTiming ? Math.max(0, liveDelay) : 0;
```

A stale payload is not partially trusted. Every delay is dropped and the row shows its published time. The board degrades to the timetable, never to a guess. And the clamp is applied here regardless, because this value may have come from `localStorage` or an older server.

**One number drives everything.**

```js
delta = offset * 86400 + departure.seconds + delay - now.seconds
```

`delta` determines sort order, the countdown, the `Boarding` state (`delta <= 90`), and removal (`delta < -60`, a 60-second grace after the delayed departure). Deriving all four from one signed number is what makes it structurally impossible for them to disagree — a board that sorts by predicted time but counts down from scheduled time is the classic bug here.

**`LAST` is computed before the removal filter**, over the whole service day, so it marks the day's final sailing rather than the last one still on screen. It is computed after the cancellation filter, so it names the last boat that will actually run — in the worked example below, `LAST` sits on 18:35 because the 18:50 is canceled. South Brooklyn carries a second, parallel `LAST` for Governors Island, which only some SB trips serve, so the final island run is marked even when later SB boats follow it.

**The window filter applies to a group's *next* departure only.** A route appears if its next departure is within `departureWindowMinutes`; once it qualifies, every one of its `departuresShown` columns is filled, even with trips outside the window, so a row is never half empty.

**The badge ladder** — each rung means something different, and the distinction between the last two is the whole point:

| Badge | Condition | Claim |
|---|---|---|
| `+N min` | Fresh timing, ≥ 60s late | We heard from this boat and it is late. Rounded to ≥ 1 so it never reads `+0 min`. |
| `ON TIME` | Fresh timing, < 60s late | We heard from this boat and it is on time. A positive statement. |
| `SCHEDULED` | No fresh timing | This is the published time. No claim about the boat. |
| `LAST` | Final sailing of the service day | Outranks the other three. |

## The degradation ladder

Every failure below lands one rung down, never sideways into a guess:

| What fails | What the rider sees |
|---|---|
| Vehicle-positions feed | Delays intact; boat names from trip updates, or the last cached assignment |
| Trip-updates feed, cache warm | Last snapshot, `Saved live estimates`, all delays dropped → published times |
| Trip-updates feed, cache cold | `503` from `/api/realtime`, `Local schedule`, published times |
| Local server unreachable | `localStorage` copy, marked stale → published times |
| Everything but the device | Service-worker shell + bundled GTFS → published times |

The bottom of the ladder is the published timetable. There is no rung below it where the board invents a time.

## Worked example

From `node NYCF_ferryGTFSFixer.example.js` — landing 8 (East 34th Street, GTFS stop `17`), 18:00:00 local, four East River sailings, one deliberately awkward realtime feed.

```
1. normalizeTripUpdates — the delay ladder, clamped
  trip 801 stop 17  delay    0s  canceled=false
  trip 802 stop 17  delay  420s  canceled=false
  trip 803 stop 17  delay  360s  canceled=false
  trip 804 stop 17  delay    0s  canceled=true
```

- **801** — the producer sent `delay: -240`. The boat is genuinely 4 minutes ahead; it will still not leave before 18:05. Clamped to 0.
- **802** — no `delay` field at all (only the inherited protobuf default), just an absolute prediction of 18:27 local. `hasOwn` falls through to the timestamp, `localSecondsOfDay` converts it, differenced against the 18:20 sailing: 420s.
- **803** — the producer said nothing about stop 17, only that the boat is 6 minutes late at Wall St/Pier 11 upstream. Rung 3 carries that down, convertible only because `tripSchedules` knows what stop 87 was scheduled for.
- **804** — `scheduleRelationship: 3`.

```
2. Vehicle assignments — descriptor to boat name
  trip 801 → Waves of Wonder (H-101)
  trip 802 → Dream Boat (H-119)
  identityForms("HB0101") = ["hb0101","h101"]
```

801's descriptor reads label `NYCF HB0101`, id `HB0101`. The label folds to nothing useful; the id folds to `h101` and scores 90 against the roster's `H-101`. 802's boat appears **only** in the trip-update feed — it is at its terminal and has no vehicle-position record yet.

```
3. The board — 18:00:00 local, live
  ER LOCAL → Long Island City (Northbound)
    18:05:00 → 6:05 PM  5 min    Waves of Wonder  ON TIME
    18:20:00 → 6:27 PM  27 min   Dream Boat       +7 min
    18:35:00 → 6:41 PM  41 min                    LAST +6 min
```

The early boat shows its published 6:05, not 6:01. `LAST` sits on 18:35 because the 18:50 is canceled.

```
4. The same board with a stale snapshot
    18:05:00 → 6:05 PM  5 min    SCHEDULED
    18:20:00 → 6:20 PM  20 min   SCHEDULED
    18:35:00 → 6:35 PM  35 min   LAST
```

Every delay dropped, every published time restored, every `ON TIME` withdrawn — the board stops claiming knowledge it no longer has. 804 stays canceled, because the cancellation check runs before the staleness check.

```
5. The clamp, case by case (gtfsferry.md's required matrix)
  departure 09:55 for a 10:00 sailing    → 10:00 +   0s = 10:00 AM
  delay -300s                            → 10:00 +   0s = 10:00 AM
  arrival 09:55, no departure            → 10:00 +   0s = 10:00 AM
  departure 10:07                        → 10:00 + 420s = 10:07 AM
  delay +420s                            → 10:00 + 420s = 10:07 AM
```

## Scheduled boat prediction

Everything above answers *when* a boat leaves and, once the feed says so, *which* boat. A newer version of this project answers the second question earlier, from data no feed publishes: the seasonal crew workbook. This section documents that data — its shape, its provenance, and the constants the inference runs on.

**Not in this branch.** `config/crew-shuttles.json`, `content/boat-assignments.json`, `content/boat-shifts.json` and `scripts/out-of-service.js` are absent here, so what follows describes the **data contract**, not the algorithm. The values and the reasoning are taken from a `scripts/export-hardcoded-data.js` snapshot; the inference steps in `out-of-service.js` are deliberately not described beyond the constants it exports. Read those files before relying on any of this as implementation detail. Config values quoted below are that deployment's, not this branch's.

### What it buys

| Capability | Feed-derived answer | Workbook-derived answer |
|---|---|---|
| Which hull works this sailing | Only after the producer names a vehicle on the trip | Known from the timetable, before the boat exists in realtime |
| Boat label (`ER5`) | Not available — the feed has no such concept | `trip_short_name` → route code + boat number |
| Where a boat stops working | Not modeled | Inferred from shift boundaries and holes in the boat's own run |
| Out-of-service / home-port moves | Never published — no passengers aboard | Inferred, and shown as a `CREW` run to Pier C |

### `content/boat-assignments.json` — trip to boat

344 entries, imported from `summer-2026.xlsx` by `scripts/import-boat-assignments.py`. The key is GTFS `trip_short_name`; the value is the numbered boat that works it.

The first digit of `trip_short_name` selects the route family, and this repository's bundled `trips.txt` confirms the mapping:

| Prefix | Route | Boats in the export | Bundled-feed blocks |
|---|---|---|---|
| `1` | ER (East River), RES | 1–7 | `11`–`17` |
| `2` | RS (Rockaway), RWS | 1–9 | `21`–`29` |
| `3` | SB (South Brooklyn) | 1–5 | `31`–`34` |
| `4` | AS (Astoria) | 1–3 | `41`–`43` |
| `8` | SG (St. George) | 1–4 | `81`–`84` |
| `9` | RR (Rockaway Rocket) | 1 | `91` |

`trip_short_name` is `block_id` followed by a sequence number, so **the second digit equals the assigned boat number in all 344 entries** — verified across the whole file. That is a property of this naming convention, not a rule to lean on: the workbook import stays the source of truth, because the day a scheduler renumbers a block the convention breaks silently and the import does not.

Prefix `7` (GI, Governors Island) is absent — that boat is maintained separately. Coverage is per-season: the assignments are keyed to the workbook's schedule, so they must be checked against whichever feed is bundled, and a trip with no assignment simply has no predicted boat.

### `content/boat-shifts.json` — where a boat's day starts and ends

86 shifts across 21 weekday and 28 weekend boats, imported from workbook cell notes by `scripts/import-boat-shifts.py`. Each entry carries `startTime`/`startPlace`, `endTime`/`endPlace`, and the originating cell (`weekday2!G3`), with optional `startNoteTime` / `endNoteTime` / `endNotePlace` where the note disagreed with the computed boundary.

Two things about the provenance are worth carrying into any consumer:

- **The import verified against the bundled GTFS and dropped what the feed disagreed with, rather than guessing.** That is the same bias as the clamp: when two sources conflict, publish the weaker claim or none, never an invented one.
- **One entry is hand-supplied** — weekend `RR1`, sourced `supplied by hand 2026-08-13 (RWY RKT column is unreadable)`. It is labeled as such in the data instead of being laundered into looking imported.

Weekday boats run `AM`/`PM` shift pairs; several weekend boats carry a single unlabeled shift (`"shift": ""`) covering the whole day.

### `config/crew-shuttles.json` — the moves nobody publishes

12 shuttles (4 weekday, 8 weekend) and 11 holiday dates, maintained by hand. The file's own note states the reason plainly: the GTFS feed and the schedule workbook are both silent about moves made with no passengers aboard, so this is the only source, and it must be revisited whenever the schedule changes.

One entry is one departure to the home port (Pier C) carrying the crews being relieved off the boats listed, keyed by landing number and the same `ER3` / `RS5` labels the board badges. A boat named in a shuttle is swapping crew, not finishing — so it is explicitly never marked out of service on account of the shuttle.

The holiday list exists because `calendar_dates.txt` is empty: **the feed has no idea a holiday is happening.** On those dates the passenger schedule runs weekday service while the crews change on the weekend pattern. Weekend-falling holidays are omitted because they change nothing. The data marks itself a starting list, to be confirmed against the operator's holiday service.

### The out-of-service model constants

From `scripts/out-of-service.js`. These are inference parameters chosen against the shape of one bundled schedule — not published facts.

| Constant | Value | What it encodes |
|---|---|---|
| `gapMinutes` | 60 | A hole in a boat's own run this long reads as the boat leaving service |
| `certainAfterMinutes` | 180 | At or above this, the Pier C run is asserted; below it the display hedges with a question mark |
| `crewSwapWindowBefore` | 1800s (30 min) | How early a listed shuttle can be and still explain the gap |
| `crewSwapWindowAfter` | 5400s (90 min) | And how late — a crew rides the shuttle shortly after stepping off, not six hours into a gap |
| `shuttleReadyBefore` | 3600s (60 min) | A shuttle is listed when it is ready, then waits for the boat; bounded empirically, widest real case 31 min |

The 60-minute threshold is justified by an explicit empirical argument rather than a round number: in the bundled schedule ordinary layovers reach 44 minutes and the next gap up is 90, so 60 sits in an empty valley between them. The data says outright that the valley is a property of that schedule, not a law, and that these want re-checking when the schedule changes. The hedge below `certainAfterMinutes` carries the same caution — an hour and a half at Rockaway is more likely a crew break with the boat tied up where it is than a run to Pier C.

Three supporting constants complete the model:

- **`homePortStopId: "home-port"`** — Pier C appears in no feed, so landing 27 is virtual and its single stop id exists only in this repository, along with its own coordinates.
- **`crewServiceIds: crew-weekday` / `crew-weekend`** — synthetic calendars. The feed's own weekday service cannot be reused, because on a holiday the feed still runs weekdays while the crews change on the weekend pattern.
- **`crewRoute: CREW`** (`#4A5B68`) — a crew shuttle belongs to no passenger route, and borrowing a route's color would imply the boat is running that service.

### How this interacts with the rule

A scheduled assignment is a **weaker claim than a realtime one**, and the ordering follows from that: a feed-supplied vehicle descriptor names the hull actually working the trip today, while the workbook names the hull rostered to work it in a season that may since have changed. Where both exist, realtime wins.

The clamp is untouched by any of it. None of this data supplies a departure time, so none of it can move one — and the two prediction layers stay in their lanes: the workbook answers *which boat*, the feed answers *when*. The same bias governs both. A boat whose gap is ambiguous gets a question mark rather than an asserted home-port run, exactly as a sailing with no fresh timing gets `SCHEDULED` rather than an invented `ON TIME`.

### `config/landings.json`, `config/display.json`, `content/vessels.json`

The rest of the export is data this branch already carries, in the same shape: 26 active landings (plus the virtual Pier C), the kiosk display settings, and the 38-vessel roster Stage 4 matches against. Two notes from the newer version worth recording:

- A deployed staff or mobile server **answers for every landing** and uses `landingNumber` only as its default, rather than being pinned to one landing the way a kiosk is.
- The vessel roster's descriptive prose (namesake stories, photo attribution) is editorial and is not read by the board. Only `name`, `number` and `id` participate in identity matching.

## Tests

| File | Covers |
|---|---|
| `test/realtime.test.js` | The delay ladder, `hasOwn` vs. protobuf defaults, all four clamp paths, vessel matching, merge order |
| `test/display-contract.test.js` | `never displays a realtime departure earlier than its scheduled time` — the clamp at the presentation layer — plus the badge row, `LAST`, and the Governors Island case |
| `test/build-data.test.js` | Schedule shapes for every landing, route abbreviations and colors, East River A/B/Local variants, Governors Island trips |

```bash
npm test
```

Beyond the matrix in `gtfsferry.md`, verify that an early prediction cannot reorder departures, start `Boarding` early, or remove a trip before its scheduled departure — and that a stale snapshot cannot either.

## Changing any of this

Before touching the prediction path:

- [ ] No displayed clock time precedes its static GTFS departure — on any path, from any source.
- [ ] No countdown, sort order, `Boarding` state, or removal is derived from an unclamped delay. All four still come from one `delta`.
- [ ] Arrival and departure semantics stay distinct.
- [ ] Delay fallbacks can still only make a departure later.
- [ ] `Object.hasOwn` guards survive any refactor of the protobuf reads. An inherited `delay: 0` must never read as an assertion.
- [ ] Timezone conversion stays in the agency's zone, not the process's.
- [ ] Cached and `localStorage`-sourced realtime is subject to the same rules as fresh.
- [ ] Cancellations remain honored independently of staleness.
- [ ] Removing a clamp layer requires an equivalent guarantee at every boundary that can supply a delay.
