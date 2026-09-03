## Imported Claude Cowork project instructions

## Home-port / Pier C

This branch documents the synthetic Pier C (landing 27) home-port feature for NYC Ferry staff.
Pier C is not present in GTFS or the operator schedule feed. Its location, synthetic stop ID,
crew-shuttle rules, holiday overrides, and out-of-service thresholds are maintained locally.

### Related files only

- `config/landings.json` — virtual landing 27, coordinates, and `home-port` stop ID.
- `config/crew-shuttles.json` — home-port name, thresholds, holidays, and shuttle assignments.
- `content/boat-assignments.json` — trip-to-boat assignments used by the home-port model.
- `content/boat-shifts.json` — imported crew shift boundaries.
- `schedules/summer-2026-shift-notes.csv` — source notes for the imported shift boundaries.
- `scripts/import-boat-shifts.py` — imports shift notes into `content/boat-shifts.json`.
- `scripts/out-of-service.js` — derives home-port returns, shift starts, crew shuttles, and the synthetic stop ID.
- `scripts/build-data.js` — loads the configuration and adds generated home-port departures.
- `lib/landing-data.js` — preserves the virtual landing and its manually configured position.
- `public/app.js` — renders home-port rows, approximate times, crew shuttles, and status badges.
- `public/data/display-data.json` — generated runtime display output; do not edit as source data.
- `export/nyc-ferry-hardcoded-data.json` — generated export of the related configuration and model constants.
- `scripts/export-hardcoded-data.js` — produces the related export data.
- `ferryAssignments.md` — operational documentation for Pier C and crew movements.
- `test/build-data.test.js` — home-port departure, return, shuttle, and changeover behavior.
- `test/landing-data.test.js` — virtual landing position and identity.
- `test/display-contract.test.js` — client rendering of home-port rows.
- `test/export-hardcoded-data.test.js` — exported virtual landing and model constants.
