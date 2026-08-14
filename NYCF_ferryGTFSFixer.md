# NYCF Ferry GTFS Fixer

How a boat gets predicted onto the board, from `stop_times.txt` to the words `+7 min`.

[`gtfsferry.md`](./gtfsferry.md) states the operating rule and the obligations it puts on any implementation. This document is the mechanism: every transformation applied to NYC Ferry's GTFS-Realtime feed between the wire and the screen, why each one exists, and what breaks without it. [`NYCF_ferryGTFSFixer.example.js`](./NYCF_ferryGTFSFixer.example.js) is the companion — every function named here, in one runnable file, in pipeline order.

```bash
node NYCF_ferryGTFSFixer.example.js
```

No dependencies, no network. All output quoted in this document comes from that file.

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
| Two operators, both with a stop `4` | Colliding ids, wrong predictions | Namespaced ids per operator | `PARTNER_FEEDS` |
| Passio: "scheduled departure 06:00" | A three-hour phantom delay | Ignores the field, resolves the sailing from the timetable | `normalizeNyuEtas` |

## The rule everything serves

```text
rider_departure = max(static_departure, realtime_predicted_departure)
effective_delay = max(0, realtime_delay)
```

Realtime may move a departure later, cancel it, or reveal which boat is working it. It may never move a departure earlier. GTFS-Realtime permits negative delay because the spec serves systems whose vehicles run ahead of schedule; NYC Ferry is not one, and a generic consumer cannot infer that from the feed. So it is enforced, explicitly, at every boundary that can supply a delay:

- `lib/realtime.js:50` — `riderDepartureDelaySeconds`, before any update reaches `/api/realtime`.
- `lib/nyu-realtime.js:91` — the Passio arrival, at the point of conversion.
- `public/app.js:116` — again while building departure groups, because a delay can also arrive from `localStorage` or an older server snapshot.

Three layers is not redundancy; it is three different sources of a delay, each responsible for itself.

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
passio3.com /mapGetData ──► lib/nyu-realtime.js ──► updates[] (nyu: prefixed)
                                              │
                              server.js ──────┴──► /api/realtime  (15s TTL, single-flight)
                                              │
                              public/app.js ──┴──► routeDirectionGroups ──► the board
                                                     (clamp again, 15s poll)
```

Two things travel down this pipe and they are kept strictly separate: **timing** (a clamped delay per trip+stop) and **identity** (which hull is working the trip). They come from different feeds, fail independently, and neither one failing may take the other down.

---

## Stage 1 — the static schedule is the ground truth

`scripts/build-data.js` reads the bundled GTFS and writes `public/data/display-data.json`. Two structures in that file are what make prediction possible at all.

**`departures[]`** — one row per (trip, landing stop) a rider can board. Built by walking each trip's `stop_times` in `stop_sequence` order and taking every stop that is one of this landing's stops, is not `pickup_type: 1` (no pickup), and is not the trip's final stop — the last call of a trip is an arrival, not a boardable departure.

**`tripSchedules{}`** — every stop of every one of those trips, *including the stops this landing does not serve*, each with `arrivalSeconds` and `departureSeconds`.

That second structure is easy to mistake for dead weight. It is the reason a delay observed three stops upstream can be shown here. An absolute prediction is only convertible into a delay if you know what that stop was scheduled for; without `tripSchedules` the upstream rung of the delay ladder has nothing to difference against and silently returns `null`.

Times are stored as **seconds since the start of the service day**, never as epoch instants. GTFS hours run past 24 — `25:10:00` is 1:10 am on the next calendar day, still belonging to the previous service day — and keeping that representation end to end is what makes the whole pipeline DST-proof. Nothing in the prediction path ever adds 86400 to a wall clock.

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

`landingStopsByTrip` is built from the **local schedule**, not from the message. A landing can map to more than one GTFS stop, and the set of trips it boards is known locally — so a producer that omits this landing's stop from a message cannot make the trip disappear from the board. Only if the trip is unknown locally does the code fall back to whatever stops the message happens to carry.

A trip with no target stops is skipped entirely.

### 3.2 Picking the event: departure beats arrival

```js
timingEvent(stopUpdate)  // departure if populated, else arrival, else null
```

A rider wants to know when the boat *leaves*. An arrival is consulted only when there is no departure event at all, and even then it can only push a departure later — never pull it earlier. A ferry that ties up at 09:02 for a 09:30 sailing is a boat waiting on its timetable, not a departure that moved 28 minutes.

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

`delaySeconds` is clamped and rider-facing. `predictedEpochSeconds` is the raw, *unclamped* prediction — retained for diagnostics, read by nothing rider-facing. `lib/nyu-realtime.js` emits this exact shape, which is what lets one client lookup serve both operators.

## Stage 4 — which boat is it

Identity is a separate problem with a separate failure mode, and it is the one place the pipeline does fuzzy matching.

The feeds identify a vessel with a `VehicleDescriptor` — some combination of `label`, `id`, `licensePlate`. The same hull appears as `H-101` in `content/vessels.json`, `H101` in one feed's label, `HB0101` in an AVL id, and `NYCF HB0101` when someone decorated it.

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
vehicleFeed ? merge(tripUpdates, positions)   // positions fresher → win
            : merge(cachedPositions, tripUpdates)  // cache is older → fresh trip updates win
```

Last source wins per trip id. When the vehicle feed is up, its positions are authoritative. When it is down, the *cached* positions are merged first so today's fresh trip-update assignments overwrite yesterday's remembered ones.

An unmatched descriptor still yields its raw label rather than nothing — a rider gains more from `H109` than from a blank space.

## Stage 5 — cache, serve, degrade

`createRealtimeService` and `createNyuRealtimeService` share one contract:

- **15-second TTL.** One snapshot serves every caller, so N kiosks and N browser tabs remain one upstream request.
- **Single-flight.** An `inflight` promise collapses concurrent cache misses into one fetch.
- **Atomic persistence.** Snapshots are written to `state/*.json` via temp file + `rename()`, so a kiosk losing power mid-write cannot leave a truncated file that poisons the next boot.
- **Never worse than stale.** A failed refresh returns the last good snapshot with `stale: true`. Only a cold cache reports `available: false`.

`stale` is not cosmetic. It is a contract with the client: *stop trusting these delays*. The client honors it by discarding every delay and showing published times.

`server.js` then merges the two operators into one `/api/realtime` payload:

```js
available: ferry.available || nyu.available     // either operator's data is worth serving
stale:     ferry.stale     || nyu.stale         // either being stale marks the payload stale
updates:   [...ferry.updates, ...nyu.updates]   // one array, ids already namespaced
```

NYU's updates carry `nyu:`-prefixed trip and stop ids — the same ids the display data was built with — so the client resolves both operators through a single map lookup. Either operator failing leaves the other usable, and the pessimistic `stale` only ever costs a fallback to published times.

The one deliberate asymmetry: for a landing with no NYU dock, `createNyuRealtimeService` returns `available: true, updates: []`. A landing without that dock is the normal case and is a success with nothing to report — not an error. Treating it as an error would permanently mark `/api/realtime` degraded at most landings and suppress NYC Ferry's own live estimates.

## Stage 6 — the board

`public/app.js` polls `/api/realtime` every 15 seconds, mirrors each response to `localStorage`, and falls back to that copy (marked `stale`) when the local server is unreachable. `routeDirectionGroups` then does the final assembly, and re-derives the safety properties rather than assuming them.

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

**`LAST` is computed before the removal filter**, over the whole service day, so it marks the day's final sailing rather than the last one still on screen. It is computed after the cancellation filter, so it names the last boat that will actually run — in the worked example below, `LAST` sits on 18:35 because the 18:50 is canceled.

**The window filter applies to a group's *next* departure only.** Once a route qualifies, every column is filled, even with trips outside the window, so a row is never half empty.

**The badge ladder** — each rung means something different, and the distinction between the last two is the whole point:

| Badge | Condition | Claim |
|---|---|---|
| `+N min` | Fresh timing, ≥ 60s late | We heard from this boat and it is late. Rounded to ≥ 1 so it never reads `+0 min`. |
| `ON TIME` | Fresh timing, < 60s late | We heard from this boat and it is on time. A positive statement. |
| `SCHEDULED` | No fresh timing | This is the published time. No claim about the boat. |
| `LAST` | Final sailing of the service day | Outranks the other three. |

## The NYU Langone ferry — an arrival is not a departure

NYU publishes no GTFS at all. `gtfs/nyu/` is reconstructed from Passio GO's JSON backend by `scripts/fetch-nyu-gtfs.js`; live estimates come from the same backend through `lib/nyu-realtime.js`, normalized into the identical update shape. This feed makes the operating rule unusually visible, and it breaks one assumption the GTFS-RT path takes for granted.

**Passio predicts arrivals, not departures.** For a ferry that waits at the dock, the predicted arrival is routinely long before the scheduled departure. Ferry 03 tying up at 09:02 for a 09:30 sailing is a boat waiting on its timetable. The arrival is clamped at the point of conversion:

```js
delaySeconds = Math.max(0, arrival.secondsOfDay - scheduledSeconds)
```

**`solidEta.scheduledDeparture` cannot identify the sailing.** It reports the *block's* first departure — a boat predicted to dock at 09:22 comes back tagged `scheduledDeparture: 06:00`, `tripIndex: 0`. Differencing the two invents a three-hour delay on a ferry running perfectly. This is the limit of requirement 5 in `gtfsferry.md`: an absolute realtime timestamp is only convertible against the schedule the rider is actually being shown, and when a producer's own scheduled-time field does not identify that sailing, the sailing must be resolved from the static timetable instead.

So it is: an inbound boat works **the next departure not yet due**, and it is late only if it docks after that departure's published time.

**A sailing whose time has passed is never revived.** Passio cannot say whether an earlier boat already worked it, and showing a departed sailing as merely "late" is a worse error on a platform than showing the published time.

**Passio's own clock supplies `now`** (`payload.time`), so a drifting kiosk clock cannot shift which sailing a prediction attaches to.

**Two boats resolving to the same sailing**: the one arriving first works it (`existing.delaySeconds <= delaySeconds` keeps the smaller).

**No cancellations are ever asserted** from this feed. Passio models a boat going out of service, not a canceled sailing, and the two are not the same claim.

Timestamps parse as wall-clock readings with a parallel `*Utc` field. `parseStamp`'s `pseudoEpoch` reads the local stamp *as if it were UTC* — legitimate only because it is ever differenced against another reading parsed the same way, so the fictional offset cancels out. NYU sails 05:30–20:15 with nothing crossing midnight, so seconds-of-day comparison needs no wrap handling.

## Schedule-only partners

NY Waterway, Seastreak and Liberty Landing publish no realtime feed here. Their rows show scheduled times only — no boat name, no delay badge — and they satisfy the clamp trivially, because nothing can move a departure at all.

Their obligation is the other half of the same principle: **the published static departure is what the rider sees, so it must be carried through exactly as the operator published it.** Editing a stale feed's service dates to make its trips reappear is the static-schedule version of an early departure. Liberty Landing's 2019 feed, rolled forward, would put 16 sailings a weekday on the board that do not exist. So `scripts/build-liberty-gtfs.js` transcribes today's published timetable instead, with a deliberately 180-day-bounded calendar so it expires loudly. `scripts/build-data.js` prints `WARNING: the <operator> feed ... expired on <date>` rather than letting rows vanish silently.

Every partner's ids are namespaced (`wtr:`, `sea:`, `nyu:`, `lib:`) because independently published feeds reuse small integer ids — NY Waterway's stop `4` is unrelated to NYC Ferry's stop `4`. Without the prefixes, a delay could be applied to the wrong operator's boat.

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
  ER LOCAL → Long Island City
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
5. NYU via Passio — an arrival is not a departure
  nyu:t2 at nyu:13138  delay 0s
```

A 09:22 dock, tagged by Passio with `scheduledDeparture: 06:00`. The tag is ignored; the sailing resolves to the 09:30, which is not yet due. The boat is on time and the 09:30 stays 09:30.

```
6. The clamp, case by case (gtfsferry.md's required matrix)
  departure 09:55 for a 10:00 sailing    → 10:00 +   0s = 10:00 AM
  delay -300s                            → 10:00 +   0s = 10:00 AM
  arrival 09:55, no departure            → 10:00 +   0s = 10:00 AM
  departure 10:07                        → 10:00 + 420s = 10:07 AM
  delay +420s                            → 10:00 + 420s = 10:07 AM
```

## Tests

| File | Covers |
|---|---|
| `test/realtime.test.js` | The delay ladder, `hasOwn` vs. protobuf defaults, all four clamp paths, vessel matching, merge order |
| `test/nyu-realtime.test.js` | Passio arrival clamping, sailing resolution, `Passio's block-level scheduledDeparture never becomes a delay` |
| `test/display-contract.test.js` | `never displays a realtime departure earlier than its scheduled time` — the clamp at the presentation layer — plus the badge row, `LAST`, and the shared cache-bust version |
| `test/build-data.test.js` | Schedule shapes for every landing, partner merging and id namespacing, `every bundled feed is still in service, so no operator is silently empty` |

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
- [ ] Removing a clamp layer requires an equivalent guarantee at every boundary that can supply a delay. There are three sources today.
