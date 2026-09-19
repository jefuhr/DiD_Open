# STG schedule audit — September 15, 2026

Source: https://www.ferry.nyc/routes-and-schedules/st-george/ (retrieved September 15, 2026).
Bundled NYC Ferry feed version: `20260707`, calendar dates July 6, 2026–December 31, 2027.

## Reported missing Pier 11 departure

The weekday 15:04 departure is present in `gtfs/stop_times.txt` (trip `934`, stop `87`, service `1`) and the generated Pier 11 departure data. It is boardable, assigned SG4, and displayed with the published final destination Midtown West/W 39th St-Pier 79. St. George is an intermediate call.

The complete trip matches the operator's weekday table. A regression test using the real bundled feed and the application renderer confirms that 15:04 appears at 14:59 Eastern on September 15 with no realtime updates. All 64 display-contract tests pass.

No missing weekday schedule entry or reproducible baseline rendering failure was found. The reported live incident remains unresolved without its selected date/view and realtime state. The client can hide canceled trips, elapsed departures, filtered routes, or departures beyond the configured card count. These are possible explanations, not established causes.

## Route-wide comparison

Compared each published trip's ordered stop IDs and times against the bundled GTFS, including final arrivals:

| Main website table | Published trips | Bundled trips | Exact matches |
| --- | ---: | ---: | ---: |
| Weekday toward Pier 11 | 22 | 22 | 22 |
| Weekday toward Midtown West | 22 | 22 | 22 |
| Weekend toward Pier 11 | 19 | 19 | 0 |
| Weekend toward Midtown West | 18 | 18 | 0 |

The website also contains two additional three-stop tables. Their applicability was not established in this audit, so they were excluded from the main-table comparison. The weekend mismatch requires reconciliation with the effective dated timetable before replacing trip IDs/times or associated summer crew assignments. No schedule values were changed based on this discrepancy.

## Validation

`node --test test/display-contract.test.js` — 64 passed, 0 failed.

## Integration into mobile

The local `mobile` branch already contains the newer `20260913` feed. The comparison above records the original audit checkout, not the newer mobile feed. On mobile, the same 15:04 trip uses service `2`; the regression test resolves active services by date instead of assuming a fixed service ID. All 66 display-contract tests pass after integration.
