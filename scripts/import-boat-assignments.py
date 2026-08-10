#!/usr/bin/env python3
"""Regenerate content/boat-assignments.json from a published NYC Ferry crew schedule.

The seasonal schedule workbook lists, for every trip, which numbered boat on that route
runs it: East River boat 5, Astoria boat 2, and so on. GTFS carries the same trip number
in trips.txt "trip_short_name", so that column is the join key between the two.

This is an offline maintenance step, not part of the kiosk runtime. Run it when a new
seasonal schedule is published, then commit the regenerated JSON:

    pip install openpyxl
    python3 scripts/import-boat-assignments.py schedules/summer-2026.xlsx

Requires openpyxl; the Node app and the kiosk never import Python.
"""

import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "content/boat-assignments.json"

# Trip numbers are four or more digits; boat numbers are small counts. A couple of sheets
# in the published workbook fill the "Trip No." and "Boat" columns the other way round, so
# the two are told apart by magnitude rather than by column position.
MIN_TRIP_NUMBER = 1000


def as_int(value):
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def header_row(rows):
    for index, row in enumerate(rows):
        for cell in row:
            if cell is not None and str(cell).strip().lower().startswith("trip no"):
                return index
    return None


def read_assignments(workbook_path):
    workbook = openpyxl.load_workbook(workbook_path, data_only=True)
    assignments = {}
    conflicts = []
    skipped_sheets = []

    for sheet in workbook.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        start = header_row(rows)
        if start is None:
            skipped_sheets.append(sheet.title)
            continue
        found = 0
        for row in rows[start + 1:]:
            first = as_int(row[0]) if len(row) > 0 else None
            second = as_int(row[1]) if len(row) > 1 else None
            if first is None or second is None:
                continue
            if first >= MIN_TRIP_NUMBER and second < MIN_TRIP_NUMBER:
                trip_number, boat = first, second
            elif second >= MIN_TRIP_NUMBER and first < MIN_TRIP_NUMBER:
                trip_number, boat = second, first
            else:
                continue
            key = str(trip_number)
            if key in assignments and assignments[key] != boat:
                conflicts.append((key, assignments[key], boat, sheet.title))
                continue
            assignments[key] = boat
            found += 1
        if not found:
            skipped_sheets.append(sheet.title)

    return assignments, conflicts, skipped_sheets


def main():
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <schedule.xlsx>")
    workbook_path = Path(sys.argv[1])
    if not workbook_path.is_file():
        sys.exit(f"No such workbook: {workbook_path}")

    assignments, conflicts, skipped = read_assignments(workbook_path)
    if conflicts:
        for key, existing, other, sheet in conflicts:
            print(f"  conflict: trip {key} is boat {existing} and boat {other} ({sheet})", file=sys.stderr)
        sys.exit(f"{len(conflicts)} trip numbers carry more than one boat; resolve them in the workbook first.")
    if not assignments:
        sys.exit("No trip-number/boat pairs found; check that the workbook has 'Trip No.' and 'Boat' columns.")

    payload = {
        "source": workbook_path.name,
        "note": "Maps GTFS trips.txt trip_short_name to the numbered boat assigned to that trip.",
        "assignments": {key: assignments[key] for key in sorted(assignments, key=int)}
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")
    print(f"Wrote {len(assignments)} boat assignments to {OUTPUT.relative_to(ROOT)}.")
    if skipped:
        print(f"Sheets with no boat column (expected for shuttles): {', '.join(skipped)}")


if __name__ == "__main__":
    main()
