# Ferry Boat Assignment Guide

This document explains how the numbered boat assignment on the staff board — the `ER5` badge next
to each vessel name — is matched from the published crew schedule to the GTFS feed, and what has to
be redone every time a new schedule takes effect.

Read the first two sections if you just want to know what the badge means. Read the rest if you are
the person updating it.

## What the Badge Means

Crews refer to a boat by its route and its number: "East River 5", "Astoria 2". The staff board
prints that as a compact badge between the departure status and the vessel name.

```text
4:31 PM   3 hr 23 min
ON TIME   ER5   Bay Hopper
          ^^^   ^^^^^^^^^^
          |     vessel name, from the live GTFS-Realtime feed
          crew boat assignment, from the schedule workbook
```

Two things about the badge are worth knowing:

- **Boat numbers restart on every route.** `ER5` and `AS5` are different boats. That is why the
  route code is part of the badge and not dropped.
- **The vessel name and the assignment come from different places.** The vessel name arrives live
  and changes during the day as boats are swapped. The assignment comes from the bundled schedule
  and only changes when the schedule does. A departure can show one without the other.

## Why This Needs Updating

The board ships with a snapshot of the crew schedule. It does not fetch it. When NYC Ferry
publishes a new seasonal schedule, the trip numbers change, and the old snapshot no longer matches
the new GTFS feed. The badges do not become wrong so much as they go missing — trips that no longer
match simply render without a badge.

**Update the assignments in the same change as the GTFS feed, never separately.** The two files
describe the same schedule period and are only meaningful together.

## How the Match Works

This is the one idea the whole process rests on.

The schedule workbook has a **Trip No.** column. The GTFS feed has a **`trip_short_name`** column in
`trips.txt`. They hold the same number. That is the join.

```text
schedules/summer-2026.xlsx          gtfs/trips.txt
┌──────────┬──────┐                 ┌─────────┬─────────────────┬──────────┐
│ Trip No. │ Boat │                 │ trip_id │ trip_short_name │ route_id │
├──────────┼──────┤                 ├─────────┼─────────────────┼──────────┤
│   1101   │  1   │ ───── match ──► │   305   │      1101       │    ER    │
│   1103   │  1   │                 │   309   │      1103       │    ER    │
└──────────┴──────┘                 └─────────┴─────────────────┴──────────┘
             │                                                        │
             └──────────────── ER1 ◄──────────────────────────────────┘
```

Nothing is matched on departure time, destination, or vessel. If the trip numbers agree, the
assignment is correct; if they do not, there is no badge. There is no partial or fuzzy match to
second-guess.

The importer writes the result to [`content/boat-assignments.json`](./content/boat-assignments.json)
as a plain `trip number → boat number` map. The build then attaches a `boatAssignment` to every
departure, and the board composes the badge as route code plus number.

## Updating After a Schedule Change

1. **Replace the GTFS feed.** Put the new files in [`gtfs/`](./gtfs) as usual.

2. **Add the new workbook** to [`schedules/`](./schedules), named for the period it covers, for
   example `schedules/winter-2027.xlsx`. Keep the old one; it documents what a past board showed.

3. **Confirm both cover the same dates.** The workbook states its period in the title row of each
   sheet. The feed states its own in `gtfs/feed_info.txt`:

   ```bash
   head -2 gtfs/feed_info.txt
   ```

   If the periods do not overlap, stop. Everything downstream will look like it worked and produce
   a board with no badges.

4. **Run the importer.**

   ```bash
   pip install openpyxl
   python3 scripts/import-boat-assignments.py schedules/winter-2027.xlsx
   ```

5. **Read the coverage report** it prints. See the next section.

6. **Rebuild and test.**

   ```bash
   npm run build
   npm test
   ```

7. **Re-check [`config/crew-shuttles.json`](./config/crew-shuttles.json).** Crew shuttle times move
   with the schedule and nothing will tell you they are wrong — no import step reads them, and no
   test can know a shuttle time is out of date. See the next section.

8. **Commit the feed, the regenerated `content/boat-assignments.json` and the shuttle config
   together.** They describe one schedule period and are only meaningful as a set.

## Out of Service, Pier C, and Crew Shuttles

The board also shows what a boat does when it stops carrying passengers. Three things appear:

| On the board | What it means |
|---|---|
| `DROP OFF ONLY` on a departure | The trip a boat works **before it stops** — finishing for the day, or coming off a shift mid-day. It will drop off and then go out of service; it is not turning round. It may sit on a route that is still running for hours, so this is not the same as `LAST`. |
| `DROP OFF?` on a departure | The same thing, less certain. The gap is long enough that nobody should board, short enough that the boat has probably just tied up where it is rather than gone anywhere. |
| A `Pier C` card, `Out of service` | The home-port run itself, shown at the landing where the boat finishes. `NO PICKUP` — nobody boards. |
| A `Pier C` card, `Crew shuttle` | A mid-day crew change, shown as a **window** (`2:35 – 3:05 PM`) because the shuttle waits for the boats it is collecting from to sail. One departure carries the relieved crews off every boat it names. Those boats **keep running**; being named here does not mean a boat is finishing. |

**Where each part comes from matters, because only one of them is derived.**

`DROP OFF ONLY` and the home-port runs are worked out from the workbook. Knowing which boat runs
which trip is the whole trick: group the trips by boat and a boat going out of service becomes a
**hole in its own day**. Nothing marks it — the run of trips simply stops and picks up hours later
with a fresh crew.

That only works because there is a clean gap in the distribution. In the bundled schedule ordinary
layovers run to 44 minutes; the next gap up is 90; the weekday split shifts are 4–6.5 hours. So
`gapMinutes` (60) sits in an empty valley and `certainAfterMinutes` (180) separates "the boat has
gone" from "the crew is on a break and the boat is sitting there". **That valley is a property of
this schedule, not a law** — re-check both numbers when the schedule changes, with:

```bash
node -e 'import("./scripts/build-data.js")' # or read the gaps straight out of the workbook
```

A gap between the two thresholds prints `DROP OFF?` and produces no Pier C run, because asserting
the boat went somewhere would be inventing a movement nobody published.

Routes with no boat number get nothing — Governors Island is crewed off-schedule, and the Rockaway
shuttles are buses. Partner operators publish no crew schedule, so NY Waterway and the rest never
show any of this.

A crew swap is the opposite shape: the relief crew steps aboard and the boat sails, so it leaves no
gap at all. That is exactly why the two can be told apart, and why every boat named in a shuttle has
a largest gap of 16–42 minutes — an ordinary layover.

The crew shuttles are **not derived from anything**. Neither the feed nor the workbook mentions
them. They are typed into [`config/crew-shuttles.json`](./config/crew-shuttles.json) by hand, and
**they go stale exactly when the schedule does**. Update that file in the same change as the
workbook and the feed.

### Updating the shuttles

```jsonc
{ "landing": 16, "time": "14:35", "boats": ["ER3", "RS5", "RS2", "AS2"] }
```

- `landing` is a key in [`config/landings.json`](./config/landings.json) — `16` is Wall St / Pier 11.
- `time` is the shuttle's departure, 24-hour.
- `boats` is route code plus number, the same label the badge prints. One entry is **one departure**
  no matter how many boats it names.

Entries live under `weekend` or `weekday`. Weekend covers holidays too, which needs saying:

> `gtfs/calendar_dates.txt` is empty. The feed has no idea a holiday is happening and runs its
> ordinary weekday service on one. The `holidays.dates` list in `config/crew-shuttles.json` is the
> **only** thing that switches the shuttles to the weekend pattern, so a date missing from that list
> shows the weekday shuttles on a holiday. The shipped list is a starting point — confirm it against
> the operator's holiday service.

`homePort` renames Pier C if the home port ever moves. `homePortDwellMinutes` shifts the home-port
run later than the boat's scheduled arrival; it defaults to `0`, meaning the row shows at the minute
the boat gets in, because the feed says when a boat arrives and nothing about when it lets go.
`outOfService.gapMinutes` and `outOfService.certainAfterMinutes` are the two thresholds above.

## Reading the Coverage Report

The importer compares what it read against the bundled feed and prints a line per route:

```text
Coverage against the bundled GTFS feed:
  AS      73/  73  100.0%
  ER     198/ 198  100.0%
  GI       0/  30    0.0%  (no boat number expected)
  RES      0/  80    0.0%  (no boat number expected)
  RR       6/   6  100.0%
  RS      93/  96   96.9%
  RWS      0/  80    0.0%  (no boat number expected)
  SB      79/  79  100.0%
  SG      81/  81  100.0%
```

The routes marked `(no boat number expected)` are supposed to sit at zero:

| Route | Why it has no boat number |
|---|---|
| `RES` Rockaway East | A shuttle bus, not a boat. |
| `RWS` Rockaway West | A shuttle bus, not a boat. |
| `GI` Governors Island | Crewed off-schedule; the workbook sheet has no `Boat` column. |

NY Waterway departures are also unlabeled on landings that show them. That operator publishes no
crew schedule, so there is nothing to match.

Every other route should read at or near 100%. A few missing trips are normal — the workbook and the
feed are maintained by different teams and drift by a trip or two. The importer prints a warning if
any boat-crewed route falls below 90%, which almost always means the workbook and the feed are from
different schedule periods.

## When Something Looks Wrong

| Symptom | Most likely cause |
|---|---|
| No badges anywhere on the board | `content/boat-assignments.json` is missing or was never regenerated. The build treats it as optional and carries on without it. |
| Every boat-crewed route near 0% | The workbook and the GTFS feed are from different schedule periods. Check step 3. |
| One route at 0%, others fine | That route was renamed or renumbered in the new feed. Compare its `trip_short_name` prefix against the table below. |
| Importer exits saying a trip claims two boats | Two sheets disagree about the same trip number. Fix it in the workbook; the importer will not guess. |
| Importer says "No such workbook" | The path in step 4 does not match the file added in step 2. |
| Importer reports "No trip-number/boat pairs found" | The sheets do not have `Trip No.` and `Boat` columns, or the workbook layout changed. See the next section. |
| Badges are right but stale after deploying | The kiosk service worker is serving cached files. Bump the version in `public/index.html` and `public/sw.js`. |

## What the Importer Expects

The importer reads every sheet that has a header row containing **`Trip No.`** and takes the trip
number and boat number from the first two columns. It skips any sheet without that header, which is
how the Governors Island sheet is passed over automatically.

It does not trust the column order. A few sheets in the published workbook — `SB MOD OUT` and
`SB MOD IN` in the summer 2026 edition — fill `Trip No.` and `Boat` the opposite way round from
their own headers. The importer tells them apart by size instead: trip numbers are four digits or
more, boat numbers are not. This means a new workbook that swaps the columns on other sheets still
imports correctly.

When the importer fails for any reason — a missing workbook, no usable columns, a trip claiming two
boats — it exits without writing anything. The existing `content/boat-assignments.json` is left
exactly as it was, so a failed import never takes the badges off the board. Fix the cause and run it
again.

If a future workbook drops the `Trip No.` column, or renumbers trips so they no longer match GTFS,
the join breaks and [`scripts/import-boat-assignments.py`](./scripts/import-boat-assignments.py)
has to be revisited. That is the assumption to check first when a new schedule imports to zero.

## Reference: Route Codes and Trip Numbers

Each route's trip numbers start with a distinct prefix. This is useful for spot-checking a single
trip by hand.

| Route code | Route | Workbook sheets | Trip number prefix |
|---|---|---|---|
| `ER` | East River | `ER WKDY/WKND OUT/IN` | `1` |
| `RS` | Rockaway-Soundview | `RW-SV WKDY/WKND OUT/IN` | `2` |
| `SB` | South Brooklyn | `SB WKDY/WKND/MOD OUT/IN` | `3` |
| `AS` | Astoria | `AST WKDY/WKND OUT/IN` | `4` |
| `GI` | Governors Island Shuttle | `GI WKND` (no boat column) | `7` |
| `SG` | St. George | `STG WKDY/WKND OUT/IN` | `8` |
| `RR` | Rockaway Rocket | `RR OUT/IN` | `9` |
| `RES` | Rockaway East (bus) | not in the workbook | `10` |
| `RWS` | Rockaway West (bus) | not in the workbook | `20` |

To check one trip by hand, start from a trip number and confirm the boat it maps to. Trip `1501` is
an East River trip, and the `5` in its prefix is the boat, so it should render as `ER5`:

```bash
grep ',1501,' gtfs/trips.txt                  # confirm the trip exists and its route
grep '"1501"' content/boat-assignments.json   # confirm the boat number it maps to
```

A trip number appearing on more than one line of `trips.txt` is normal. The same trip runs under
different service IDs — weekday and weekend — and carries the same boat assignment on each.

## Files Involved

| Path | Role |
|---|---|
| [`schedules/`](./schedules) | The published crew schedule workbooks. Source of truth for boat numbers. |
| [`scripts/import-boat-assignments.py`](./scripts/import-boat-assignments.py) | Reads a workbook and writes the JSON map. Offline maintenance only. |
| [`content/boat-assignments.json`](./content/boat-assignments.json) | The generated `trip number → boat number` map the build consumes. |
| [`gtfs/trips.txt`](./gtfs/trips.txt) | Supplies `trip_short_name`, the join key. |
| [`scripts/build-data.js`](./scripts/build-data.js) | Attaches `boatAssignment` to each departure at build time. |
| [`public/app.js`](./public/app.js) | Renders the badge as route code plus boat number. |

The importer needs Python and `openpyxl`. It is run by hand when the schedule changes and is never
part of running the board — the kiosk and the Node application never execute Python.
