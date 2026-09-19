# Fall weekend crew update

Source: `2(1).xlsx`, **Board** tab, uploaded September 19, 2026. The import reads assignment comments and shuttle cells N3:P7, not the archived summer/fall templates. The source workbook remains at the supplied local path; the generated JSON preserves its SHA-256 and operational cell provenance without personnel names or daily hull allocations.

The weekend crew data applies September 19–November 1, 2026. It includes 34 complete verified shifts, two partially verified shifts, and five crew shuttles. The underlying fall timetable and existing weekday/holiday integration are carried forward from commit `134d28c` because this branch previously held the summer feed.

| Ready time | Landing | Relieved workings |
|---|---|---|
| 14:05 | Pier 11 | RS1, ER3 |
| 14:35 | Pier 11 | AS2, RS5 |
| 14:55 | East 90th Street | AS1 |
| 15:00 | Pier 11 | RS3, SG2 |
| 16:00 | Pier 11 | RS4, SG3 |

These five crew shuttles run every confirmed weekend, including Sundays without a cruise shuttle. Pier C outbound times remain approximate: they are first pickups at the destination, not published departures from Pier C.

## Red Hook cruise shuttle

The separate South Brooklyn cruise working is SB3 in the captain timetable. It carries passengers between Red Hook and Pier 11, with a 07:22 first pickup at Red Hook and a 12:32 final arrival at Pier 11. Its 21 passenger trips, approximate Pier C start, and final Pier C movement run only on September 19, 26, 27; October 3, 10, 11, 17, 24, 31; and November 1. The dates supplied by the user match GTFS service 7 and the exception dates for service 8 exactly. Service 8 has no weekly flags, so its exception-only calendar must be retained.

## Conflicting source fields

- **Board!A10, RS1 PM:** the final-drop note says 21:57 at Pier 11. The working's last timetable arrival is 20:57. The note's end is left unconfirmed; the ordinary final-run inference remains based on the actual last timetable trip, not the rejected note.
- **Board!I26, SG3 PM:** the first-pickup note says 16:15 at Pier 11; the timetable departure is 16:11. No confirmed PM Pier C start is created. Its listed crew shuttle still suppresses a false deadhead at the AM handover.
- **Board!R10, ER2 PM:** the visible summary says 14:06; the assignment comment at B26 and the timetable agree on 14:36. Use 14:36.
- **Board!O9, SG2 PM:** the visible summary says 15:32; the assignment comment at H26 and the timetable agree on 15:33. Use 15:33.

The Rockaway AM Pier 11 notes describe berth times eight minutes before the timetable departure. These note times are retained separately; event times are matched within this specific working/terminal/shift context. No tolerance is applied to the unrelated SG3 conflict. RS2 changes vessels at an intermediate Pier 11 call: its arriving segment ends at the matched 15:47 event, while the continuing passenger trip stays in service.

## Reproduction and checks

```sh
python scripts/import-fall-weekend-crew.py '/mnt/c/Users/Juliet/Downloads/2(1).xlsx'
node scripts/export-hardcoded-data.js
npm run build
npm test
node scripts/check-fall-weekend-browser.cjs
```

The importer checks every applicable weekend date and records unmatched fields. Tests cover all ten cruise dates, non-cruise Sundays, season boundaries, all five crew shuttles, suppression of shuttle-related vessel swaps, intermediate RS2 handover, unchanged weekday coverage, holiday exclusion, and legacy summer behavior. Browser checks exercise date navigation at Pier C, Pier 11, Red Hook, and East 90th Street on phone and desktop viewports. Runtime packaging includes both normalized fall crew files. No deployment is part of this change.

Validation completed: all 366 Node tests passed after integration with local mobile; the captain-workbook check matched 11,022 trip instances across 44 ordinary fall dates; browser navigation passed at four landings in two viewport sizes, with 24 recorded date/landing snapshots and no horizontal overflow. The local Arch test environment used its existing temporary Chromium libraries and font configuration. Browser results are in `weekend-browser-checks.json`; screenshots are `weekend-<landing>-<width>.png`. Shipped assets are stamped version 107. Local mobile’s corrected AS3 weekday boundaries, resolved weekday notices, STG regression coverage, and dwell labels are preserved.
