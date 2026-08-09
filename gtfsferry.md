# NYC Ferry GTFS Realtime Departure Policy

## Non-negotiable operating rule

NYC Ferry boats may arrive at a landing ahead of schedule, but they do not depart before the published departure time. Every rider-facing implementation must treat the static GTFS departure as a hard lower bound.

```text
rider_departure = max(static_departure, realtime_predicted_departure)
effective_delay = max(0, realtime_delay)
```

Realtime may move a departure later, cancel it, or report that the boat has arrived. It must never move the displayed departure earlier.

## Why a clamp is required

GTFS Realtime permits negative delay values because the standard supports transit systems whose vehicles can run ahead of schedule. See the [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/). The NYC Ferry realtime producer can also publish an early arrival, an absolute departure prediction before the static departure, or a delay inferred from another stop. Those values describe vehicle progress; they do not override NYC Ferry's no-early-departure policy.

Generic GTFS consumers cannot infer this operating rule from the feed. The consumer must enforce it explicitly unless the upstream realtime producer guarantees that every departure prediction is already clamped.

## Implementation requirements

1. Resolve the scheduled departure from static `stop_times.txt` for the trip and landing.
2. Prefer a stop-specific realtime `departure` event.
3. If only `arrival` is available, it may indicate that the boat is present or approaching, but it must not advance the rider departure time.
4. Trip-level or nearby-stop delay fallbacks may delay a departure, but may not advance it.
5. Convert an absolute realtime timestamp to a delay relative to the scheduled departure, then clamp the delay to zero or greater.
6. Apply the same clamp when calculating the displayed clock time, countdown, sorting order, boarding state, and the moment when a trip disappears from the board.
7. Continue honoring cancellations independently of the clamp.
8. Optionally retain the raw negative value for diagnostics, but never use it as a rider-facing departure time.

## This repository

The rule is enforced in two places:

- `lib/realtime.js` clamps normalized realtime delays before they reach API consumers.
- `public/app.js` clamps again while building departure groups, protecting the display from an old server snapshot, browser cache, or future alternate realtime source.

Both layers are intentional. Removing either layer requires an equivalent guarantee at every boundary that can supply realtime data.

## Required test cases

Every implementation should cover at least these scenarios:

| Static departure | Realtime input | Rider-facing result |
|---|---|---|
| 10:00 | departure 09:55 | 10:00 |
| 10:00 | delay -300 seconds | 10:00 |
| 10:00 | arrival 09:55, no departure | 10:00 |
| 10:00 | nearby-stop delay -180 seconds | 10:00 |
| 10:00 | departure 10:07 | 10:07 |
| 10:00 | delay +420 seconds | 10:07 |
| 10:00 | canceled trip | hidden/canceled according to product policy |

Also verify that an early prediction cannot reorder departures, start `Boarding` early, or remove a trip before its scheduled departure.

## Review checklist

- No displayed clock time precedes its static GTFS departure.
- No countdown is calculated from an unclamped negative delay.
- Arrival and departure semantics remain distinct.
- Delay fallbacks cannot create early departures.
- Cached realtime data is subject to the same rule.
- Tests exercise both normalization and presentation layers.
