# Sukkot operations: September 28–October 2, 2026

The published timetable, retained NYC Ferry GTFS `20260928`, and supplied assignment board are joined only by verified identities. Full stop lists come from the feed; printed timetable rows alone do not establish a through trip.

## Included

- 65 published Pier 11 arrival/departure pairs restore the missing dwells. Original feed arrival times are retained so live arrival delays use the correct baseline.
- Verified working numbers and separate live trip IDs prevent ordinary fall trips with reused IDs from appearing on the holiday.
- 46 verified crew starts, including eight changes served by crew shuttles, yield 38 Pier C working-start rows.
- Four crew shuttles appear at Pier C and their collecting landings.
- 40 verified last-drop notes yield 32 direct return-to-Pier-C movements. Shuttled changes do not imply that the passenger boat returns to Pier C.

Pier C working-start times mean **first pickup at the destination**. Departure from Pier C remains at the captain’s discretion. Return rows show the verified last drop at the collecting landing; an arrival time at Pier C is not published.

## Withheld returns

Dispatch asked on September 28 to withhold these six returns until the last drops are confirmed. Five have no unique exact match on every active Sukkot date; RS4 PM matches the 21:30 Pier 11 arrival but is withheld with the others. None of them is added to the board.

| Working | Board cell | Last-drop note |
| --- | --- | --- |
| ER1 PM | A26 | 21:20 Pier 11 |
| ER3 PM | C26 | 21:43 Pier 11 |
| ER6 PM | F26 | 20:37 Pier 11 |
| RS1 PM | A10 | 21:35 Rockaway |
| RS4 PM | D10 | 21:30 Pier 11 |
| GI1 | L10 | 17:50 Pier 11 |

The original notes, each boat's last published arrival and the reason remain in `schedules/sukkot-2026-crew.json` under `withheldDrops`. The app shows the crew-coverage note “6 Pier C returns await dispatch confirmation.” Any future note without a unique match is listed under `unresolvedEnds`.

## Rebuild and verification

Run the source import commands in the root README, then `npm run build`. `test/sukkot-operations.test.js` checks provenance, dwells, working assignments, shuttles, verified returns, and withheld returns. `scripts/build-ios-service-contract.mjs` generates cross-platform expectations from all 30 landing schedules for the native tests.
