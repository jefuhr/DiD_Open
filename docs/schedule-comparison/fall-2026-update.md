# NYC Ferry fall 2026 update

The ordinary timetable comes from [Connexionz Timetables](https://nycferry.connexionz.net/rtt/public/Schedule.aspx) and its [GTFS ZIP](https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip), downloaded and rechecked on September 13, 2026. The ZIP's feed version is **20260913**. It includes September 13 service and September 14's fall changeover. Every ordinary fall ferry trip matches the supplied captain workbook by trip number, boat, stop sequence and printed time.

## Included behavior

- Fall service runs September 14–November 1, using New York service dates. The unchanged downloaded ZIP is archived; the effective bundled calendar is capped at the captain sheet's November 1 end date rather than extending the fall timetable into 2027.
- A point-to-point shuttle between Red Hook/Atlantic Basin and Wall St./Pier 11 serves cruise demand approximately 7:30 a.m.–1 p.m. on September 19, 26, 27; October 3, 10, 11, 17, 24, 31; November 1. The raw feed's service 8 runs every weekend from September 26. The generator replaces that broad recurrence with the exact dates in [NYC Ferry's fall announcement](https://www.ferry.nyc/blog/fall-schedule-changes-beginning-september-14th/) and its South Brooklyn PDF. Service 7 already supplies September 19.
- The official feed retains its native trip/stop/shape IDs. The captain workbook supplies 289 trip-number-to-boat assignments, covering **100% of active fall ferry trips**. Old summer-only trips in the transition feed need not match the fall assignments; coverage must be checked by service date.
- The workbook's Pier 101 alternatives remain archived and inactive. Connexionz uses Yankee Pier; no Pier 101 activation dates were supplied.
- Crew shifts / Pier C shuttles: **UNCONFIRMED**. Historical summer crew records remain stored, but the app generates no unverified shuttle times, Pier C movements, or crew-derived final/drop-off labels. Explicit GTFS restrictions remain effective.
- Turnarounds are derived from complete simultaneously active service sets, not individual calendar fragments. Only a link that is the same on every applicable date is retained.

## Sukkot source limits

Connexionz's timetable index currently has no September 28 holiday schedule and its Service Calendar lists no amendments. Its ZIP likewise has no holiday exceptions or holiday trips. The eight PDFs linked from the [Sukkot announcement](https://www.ferry.nyc/blog/sukkot-2026-holiday-schedules/) therefore supply September 28–October 2 departures, replacing all ordinary NYC Ferry services on those five dates. Ordinary fall service returns October 3. Partner operators are unaffected.

These are **per-landing published departure times**, not invented GTFS vehicle trips. Each entry has a namespaced internal ID, no captain trip number or boat assignment, and is explicitly schedule-only. No live estimate, vessel prediction, arrival estimate or through-trip connection can attach to it. A tapped entry explains this limitation. Bus departure columns respect the existing bus switch.

Visual inspection found errors in the published through-trip rows, not merely text-extraction errors:

- East River outbound first row prints Pier 11 06:26, North Williamsburg 06:45, then Hunters Point 06:06 and East 34th 06:09. Several outbound rows have missing/misaligned terminal times.
- St. George outbound first row prints Pier 79 06:22, Battery Park City 06:37, then St. George 06:21.
- South Brooklyn inbound prints a Red Hook 13:36 call before a later row's 13:21 call.
- The Governors Island PDF's last Pier 11 departure is **16:26**; the blog prose says **16:21**. This implementation preserves the timetable PDF's 16:26, without silently changing it to the conflicting prose time.

Because of these inconsistencies, the extraction preserves each landing's printed departure column and does not claim row-to-row vehicle continuity. Arrival-only columns and final terminal arrivals are not offered as boarding departures. The archived sources and their SHA-256 hashes make the choice auditable. Replace the supplement when a verified official holiday feed is published; do not guess live trip IDs from matching times.

## Reproduction

The Node runtime requires no Python or PDF library. Docker explicitly includes the normalized holiday JSON. Python is used only for offline maintenance:

```sh
python3 -m venv /tmp/nyc-fall-tools
/tmp/nyc-fall-tools/bin/pip install openpyxl pymupdf
python3 scripts/build-nyc-fall-2026.py
/tmp/nyc-fall-tools/bin/python scripts/import-sukkot-2026.py
/tmp/nyc-fall-tools/bin/python scripts/import-boat-assignments.py schedules/fall-2026.xlsx --date 2026-09-14
/tmp/nyc-fall-tools/bin/python scripts/check-nyc-fall-2026.py
node scripts/export-hardcoded-data.js
npm run build
npm test
```

For a future feed replacement, review the holiday supplement and calendar corrections together. The builder rejects a different feed version while the 2026 supplement remains installed, and rejects the fall feed if its required holiday supplement is missing. The raw ZIP and PDFs live in `schedules/fall-2026-sources`; the captain workbook and normalized holiday columns live in `schedules`.

To confirm a weekend assignment set, use `--date 2026-09-19` or `--date 2026-09-20`. The workbook checker verifies **11,022 trip instances over all 44 ordinary fall dates** and confirms that the five holiday dates contain no ordinary trips. Historical crew-model tests use the frozen summer regression fixture instead of asserting that fall crew times are confirmed.

## Release

Asset version **102** updates the installed shell and data caches while retaining user preferences. Rebuild and restart the deployed app with all changed files together; the calendar then switches dates without a midnight restart. This workspace's local validation server does not deploy the production instance. After the fall period ends, NYC Ferry departures expire until a new verified schedule is installed.

The browser check is `FALL_TEST_ORIGIN=http://127.0.0.1:8096 node scripts/check-fall-browser.cjs` against a local running server with Chromium available. It exercises the desktop and mobile fall board, Sukkot details, and the empty Pier C board with its UNCONFIRMED notice. Screenshots and results are alongside this document.
