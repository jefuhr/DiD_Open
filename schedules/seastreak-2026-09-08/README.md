# Seastreak weekday source sheets

The user supplied `new-york.png` and `new-jersey.png` on September 25, 2026. Both
sheets say **Effective September 8, 2026**. These are the source images for this
verification; the operator's dated PDF URL was not supplied.

The CSV files transcribe all 17 rows of each image in printed column order,
independently of the GTFS generator. Empty cells represent printed dashes. Blue
rows run Monday–Wednesday; purple rows run Thursday–Friday. The other rows run
Monday–Friday. Calls must be ordered by time when comparing them with GTFS,
because several sailings visit terminals in a different order from the headings.

All 34 weekday rows already matched the bundled feed when checked on September 25.
The feed was regenerated with refreshed verification metadata and no sailing-time
or service-calendar changes. No new weekend sheet was supplied; weekend service
remains from the September 12 sheet last transcribed on September 7.

The New York sheet also lists shuttle buses from Highlands to Atlantic Highlands
at 12:15 PM and 5:05 PM, taking approximately 10 minutes. The footnotes on the
12:05 PM and 5:00 PM Highlands ferry arrivals refer to these free bus transfers.
The buses are not ferry trips and are not included in the ferry GTFS or CSVs.

Run `node scripts/build-seastreak-gtfs.js` to rebuild the feed, then
`node --test test/seastreak-gtfs.test.js` to compare every weekday call, boarding
restriction and service pattern with these saved sources.
