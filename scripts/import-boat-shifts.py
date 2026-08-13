#!/usr/bin/env python3
"""Turn the crew schedule's per-boat shift notes into content/boat-shifts.json.

The schedule workbook says which boat runs which trip, and nothing else. The *notes* attached to
each boat's column say when that boat's crew starts and finishes, and where — which is the one
thing the GTFS feed cannot express and the board most needs, because a boat coming off shift is
about to stop carrying passengers.

    python3 scripts/import-boat-shifts.py schedules/summer-2026-shift-notes.csv

Input is a CSV of `sheet,cell,cell_text,cell_note` exported from the workbook's cell comments.
Output is a plain map of boat -> day type -> shifts, which scripts/build-data.js reads.

Two things this deliberately does NOT do:

  * It does not trust a note's own first line. Those are copy-pasted between columns constantly
    ("RWSV 6 AM" whose note begins "RWSV 4 AM"), so the column label is authoritative and the note
    body supplies only times and places.
  * It does not silently accept a time the feed disagrees with. Every value is checked against the
    bundled GTFS and anything that does not line up is reported and dropped, because a wrong shift
    end puts DROP OFF ONLY on a boat that is about to keep running.
"""

import collections
import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The crew's route codes, and the GTFS route ids they mean. RWY is the same route as RWSV: the
# Rockaway boats numbered 7 upward are written the short way on the weekend sheet.
ROUTES = {"RWSV": "RS", "RWY": "RS", "AST": "AS", "SBK": "SB", "ERF": "ER", "STG": "SG", "GI": "GI"}

# Longest first: "E 34TH" must win before "34TH", and "G.I" before "GI" would ever be reached.
PLACES = [
    ("FERRY POINT PARK", "Ferry Point Park"), ("FPP", "Ferry Point Park"),
    ("BAY RIDGE", "Bay Ridge"), ("HUNTERS POINT", "Hunters Point South"), ("HPS", "Hunters Point South"),
    ("RED HOOK", "Red Hook/Atlantic Basin"), ("REDHOOK", "Red Hook/Atlantic Basin"),
    ("PIER 79", "Midtown West/W 39th St-Pier 79"), ("P79", "Midtown West/W 39th St-Pier 79"),
    ("PIER 11", "Wall St/Pier 11"), ("P11", "Wall St/Pier 11"),
    ("E. 90TH", "East 90th St"), ("E 90TH", "East 90th St"), ("90TH", "East 90th St"),
    ("E. 34TH", "East 34th Street"), ("E 34TH", "East 34th Street"), ("34TH", "East 34th Street"),
    ("G.I", "Gov. Island/Yankee Pier"), ("GI", "Gov. Island/Yankee Pier"),
    ("LONG ISLAND CITY", "Long Island City"), ("LIC", "Long Island City"),
    ("RWY", "Rockaway"), ("ROCKAWAY", "Rockaway"), ("STG", "St. George"),
]

# "Fist departure", "ar P79", "Last Drop off is" — these are hand-typed comments, so the typos are
# part of the input format rather than something to fix upstream.
FIRST = re.compile(r"(?:first|fist)\s+(?:pickup|departure)(?:\s+is)?\s+(?:at\s+|from\s+)?(\d{1,2}:\d{2})\s*(?:at|from|ar)?\s*([A-Za-z0-9 .']*)", re.I)
LAST = re.compile(r"last\s+drop(?:\s*off)?(?:\s+is)?\s+(?:at\s+|from\s+)?(\d{1,2}:\d{2})\s*(?:at|from|ar)?\s*([A-Za-z0-9 .']*)", re.I)
LABEL = re.compile(r"\b(RWSV|RWY|AST|SBK|ERF|STG|GI)\b\s*(\d+|RKT)?", re.I)

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"]

# The notes carry berth time the feed does not. On the Rockaway route Pier 11 is an intermediate
# stop the feed gives a single timestamp for — arrival and departure at the same minute — while the
# note records the crew actually finishing eight or ten minutes earlier, when the boat tied up. So a
# note is matched to the nearest feed event *at the same place* within this tolerance, and the
# feed's time is what gets stored: the board shows feed times, and mixing the two would put a
# departure on screen a minute the boat does not leave.
MATCH_TOLERANCE = 10 * 60

# Shift notes for boats the workbook has no readable column for. Each is still checked against the
# bundled feed exactly like a note read out of the CSV, and each says where it came from, because a
# value nobody can trace back is worse than an absent one.
#
# RR1 — the Rockaway Rocket. Its column is headed "RWY RKT" with no boat number, and the note inside
# it is copied from RWSV 9: it gives Pier 11 times for a boat that never calls there, running
# between Long Island City and Rockaway all day. Supplied by hand on 2026-08-13.
MANUAL = [
    {
        "boat": "RR1", "kind": "weekend", "shift": "",
        "startTime": "09:30", "startPlace": "Long Island City",
        "endTime": "17:30", "endPlace": "Long Island City",
        "source": "supplied by hand 2026-08-13 (RWY RKT column is unreadable)",
    },
]


def place(text):
    if not text:
        return None
    upper = " ".join(text.upper().split())
    for needle, name in PLACES:
        if upper == needle or upper.startswith(needle + " ") or upper.startswith(needle + "."):
            return name
    for needle, name in PLACES:
        if needle in upper:
            return name
    return None


def clock(value):
    return f"{value // 3600:02d}:{value % 3600 // 60:02d}"


def nearest(events, name, when):
    """The feed event at this place closest to the noted time, or None if nothing is close."""
    if not name:
        return None
    candidates = [time for place_name, time in events if place_name == name and abs(time - when) <= MATCH_TOLERANCE]
    return min(candidates, key=lambda time: abs(time - when)) if candidates else None


def resolve(events, name, noted):
    """Match a noted boundary to a feed event, allowing the note to have named the wrong end.

    A crew writing "last drop 20:02 at E 34th" for a trip that leaves East 34th at 19:26 and gets
    into Pier 11 at 20:02 has the time exactly right and the place backwards — they wrote where the
    leg started rather than where it put them. Two of these are in the current workbook, and
    matching on place and time together threw away the whole shift over it, including a start time
    that verified to the second.

    So a boundary that finds nothing at its noted place falls back to the boat's own events at
    exactly that time, wherever they happened. Exactly, not within the tolerance: the time is the
    field the crew demonstrably gets right, and it is only trustworthy enough to relocate a note
    when it lands on a feed event to the second. Anything ambiguous — no event, or more than one —
    still fails, which is what keeps a stale copied note from being rescued into a wrong place.

    Returns (time, place, relocated) with time None when the feed does not support the note at all.
    """
    when = seconds(noted)
    matched = nearest(events, name, when)
    if matched is not None:
        return matched, name, False
    elsewhere = sorted({(place_name, time) for place_name, time in events if time == when})
    if len(elsewhere) == 1:
        return elsewhere[0][1], elsewhere[0][0], True
    return None, name, False


def final_leg(legs, name, when):
    """The end of the leg the boat pulled out on at this time, if it was heading for this place.

    "Last drop off is 17:30 at Long Island City" for a boat that leaves Rockaway at 17:30 and gets
    into Long Island City at 18:46 is two true facts about one trip and no single stop event at
    all: the time it let go, and the place it was going. The crew finishes when that leg does.

    Both halves have to agree before this is used — the noted time must be an exact departure and
    the noted place must be where that same trip ends — so a time that merely happens to fall near
    a sailing cannot drag a note onto a leg it has nothing to do with.
    """
    if not name:
        return None
    endings = {arrival for departure, destination, arrival in legs if departure == when and destination == name}
    return endings.pop() if len(endings) == 1 else None


def seconds(value):
    hours, minutes = value.split(":")[:2]
    return int(hours) * 3600 + int(minutes) * 60


def read_gtfs():
    def rows(name):
        with open(os.path.join(ROOT, "gtfs", name), newline="", encoding="utf-8-sig") as handle:
            return list(csv.DictReader(handle))

    assignments = json.load(open(os.path.join(ROOT, "content/boat-assignments.json")))["assignments"]
    stops = {r["stop_id"]: r["stop_name"] for r in rows("stops.txt")}
    calendar = {r["service_id"]: r for r in rows("calendar.txt")}
    times = collections.defaultdict(list)
    for row in rows("stop_times.txt"):
        times[row["trip_id"]].append((int(row["stop_sequence"]), row["stop_id"], row["arrival_time"], row["departure_time"]))
    for value in times.values():
        value.sort()

    def day_type(service_id):
        row = calendar.get(service_id)
        if not row:
            return None
        weekday = any(row[day] == "1" for day in WEEKDAYS)
        weekend = row["saturday"] == "1" or row["sunday"] == "1"
        return "weekday" if weekday and not weekend else ("weekend" if weekend and not weekday else None)

    # Every stop event each boat makes, because a crew can take over mid-route: an RS boat is
    # relieved at Pier 11 in the middle of a Rockaway-to-Soundview run, not at either end of it.
    departures, arrivals, legs = collections.defaultdict(set), collections.defaultdict(set), collections.defaultdict(set)
    for trip in rows("trips.txt"):
        boat = assignments.get(str(trip.get("trip_short_name", "")).strip())
        if not isinstance(boat, int):
            continue
        kind = day_type(trip["service_id"])
        if not kind:
            continue
        key = (trip["route_id"] + str(boat), kind)
        stop_times = times.get(trip["trip_id"], [])
        for _, stop_id, _, departure in stop_times[:-1]:
            if departure:
                departures[key].add((stops.get(stop_id, ""), seconds(departure)))
        for _, stop_id, arrival, _ in stop_times[1:]:
            if arrival:
                arrivals[key].add((stops.get(stop_id, ""), seconds(arrival)))
        # Where each leg ends, keyed by when the boat pulled out. A note can name its last drop by
        # the time the boat left on that final leg and the place it was heading for, which is two
        # true facts about one trip and no single stop event at all.
        final_stop, final_arrival = stop_times[-1][1], stop_times[-1][2]
        if final_arrival:
            for _, _, _, departure in stop_times[:-1]:
                if departure:
                    legs[key].add((seconds(departure), stops.get(final_stop, ""), seconds(final_arrival)))
    return departures, arrivals, legs


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else "schedules/summer-2026-shift-notes.csv"
    with open(os.path.join(ROOT, source), newline="", encoding="utf-8-sig") as handle:
        raw = list(csv.DictReader(handle))

    departures, arrivals, legs = read_gtfs()
    shifts = collections.defaultdict(lambda: collections.defaultdict(list))
    dropped, warnings, adjusted, relocated, legged = [], [], [], [], []

    def verify(boat, kind, shift, record, where):
        """Check a note against the feed and keep it, or report why it cannot be kept."""
        key = (boat, kind)
        start, start_place, start_moved = resolve(departures.get(key, set()), record["startPlace"], record["startTime"])
        end, end_place, end_moved = resolve(arrivals.get(key, set()), record["endPlace"], record["endTime"])
        # A last drop named by the time the boat pulled out and the place it was heading for
        # describes a leg rather than a stop, so it matches nothing above. Only tried once the stop
        # events have both failed, and only when time and destination agree.
        ended_leg = None
        if end is None:
            ended_leg = final_leg(legs.get(key, set()), record["endPlace"], seconds(record["endTime"]))
            if ended_leg is not None:
                end, end_place = ended_leg, record["endPlace"]
        if start is None or end is None:
            detail = []
            if start is None:
                detail.append(f"start {record['startTime']} {record['startPlace']}")
            if end is None:
                detail.append(f"end {record['endTime']} {record['endPlace']}")
            dropped.append(f"{where}: {boat} {kind} {shift or '-'} — no matching GTFS event for " + ", ".join(detail))
            return

        if ended_leg is not None:
            record["endNoteTime"] = record["endTime"]
            legged.append(f"{where}: {boat} {kind} {shift or '-'} end {record['endTime']} -> {clock(end)} "
                          f"{record['endPlace']} (the noted time is when the boat left on the last leg)")
        else:
            for field, noted, matched in (("start", record["startTime"], start), ("end", record["endTime"], end)):
                if matched != seconds(noted):
                    record[field + "NoteTime"] = noted
                    adjusted.append(f"{where}: {boat} {kind} {shift or '-'} {field} {noted} -> {clock(matched)} "
                                    f"({abs(matched - seconds(noted)) // 60} min, feed wins)")
        # The note's own place is kept alongside the feed's, because the note is the record of what
        # the crew wrote and this is the one field it got wrong.
        for field, moved, noted_place, feed_place in (("start", start_moved, record["startPlace"], start_place),
                                                      ("end", end_moved, record["endPlace"], end_place)):
            if moved:
                record[field + "NotePlace"] = noted_place
                record[field + "Place"] = feed_place
                relocated.append(f"{where}: {boat} {kind} {shift or '-'} {field} {clock(seconds(record[field + 'Time']))} "
                                 f"{noted_place} -> {feed_place} (time matches exactly; the note named the other end of the leg)")
        record["startTime"], record["endTime"] = clock(start), clock(end)
        shifts[kind][boat].append(record)

    for row in raw:
        label = " ".join((row["cell_text"] or "").split())
        note = row["cell_note"] or ""
        sheet = row["sheet"]
        cell = row["cell"]
        line = int(re.sub(r"\D", "", cell) or 0)

        # The weekday sheet carries a second table below the first that is a stale copy of the
        # weekend one. Only the top block of weekday2, and all of weekend2, are authoritative.
        if sheet == "weekday2" and line >= 50:
            continue
        kind = "weekday" if sheet == "weekday2" else "weekend"

        match = LABEL.search(re.sub(r"\b(?:DRL|TRN|Drills|Training)\b", "", label).replace("|", " ").replace("/", " ").upper())
        if not match:
            if note.strip():
                warnings.append(f"{sheet} {cell}: note with no usable column label, ignored")
            continue
        number = match.group(2)
        if not (number or "").isdigit():
            warnings.append(f"{sheet} {cell}: {label!r} has no boat number, ignored")
            continue
        boat = ROUTES[match.group(1).upper()] + str(int(number))
        shift = "PM" if re.search(r"\bPM\b", label, re.I) else ("AM" if re.search(r"\bAM\b", label, re.I) else "")

        first, last = FIRST.search(note), LAST.search(note)
        if not first or not last:
            warnings.append(f"{sheet} {cell}: {label!r} has no first/last time in its note, ignored")
            continue

        record = {
            "shift": shift,
            "startTime": first.group(1), "startPlace": place(first.group(2)),
            "endTime": last.group(1), "endPlace": place(last.group(2)),
            "source": f"{sheet}!{cell}",
        }

        verify(boat, kind, shift, record, f"{sheet} {cell}")

    # Columns the workbook cannot express, supplied by hand. The Rocket's column is labelled
    # "RWY RKT" with no boat number, and the note in it is copied from RWSV 9 — it describes Pier 11
    # times for a boat that runs between Long Island City and Rockaway, so there has never been
    # anything in the workbook to read for it. Without this RR1 is the one boat working a weekend
    # that never leaves the home port on the board. Verified against the feed like every other note.
    for entry in MANUAL:
        verify(entry["boat"], entry["kind"], entry.get("shift", ""), {
            "shift": entry.get("shift", ""),
            "startTime": entry["startTime"], "startPlace": entry["startPlace"],
            "endTime": entry["endTime"], "endPlace": entry["endPlace"],
            "source": entry["source"],
        }, entry["source"])

    for kind in shifts:
        for boat in shifts[kind]:
            shifts[kind][boat].sort(key=lambda item: seconds(item["startTime"]))

    output = {
        "source": source,
        "note": ("Crew shift boundaries, imported from the workbook's cell notes by "
                 "scripts/import-boat-shifts.py. Every value here is verified against the bundled "
                 "GTFS feed at import time; anything the feed disagreed with was dropped rather "
                 "than guessed at. Regenerate whenever the feed or the workbook changes."),
        "shifts": {kind: dict(sorted(value.items())) for kind, value in sorted(shifts.items())},
    }
    target = os.path.join(ROOT, "content/boat-shifts.json")
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=1)
        handle.write("\n")

    total = sum(len(v) for kind in shifts for v in shifts[kind].values())
    print(f"Wrote content/boat-shifts.json from {source}")
    print(f"  {total} shifts verified against the bundled feed "
          f"({sum(len(v) for v in shifts.get('weekday', {}).values())} weekday, "
          f"{sum(len(v) for v in shifts.get('weekend', {}).values())} weekend)")

    print("\nBoats in the feed with no usable shift note (the board falls back to inferring these):")
    covered = {(boat, kind) for kind in shifts for boat in shifts[kind]}
    missing = sorted({key for key in departures if key not in covered})
    for boat, kind in missing:
        print(f"  {boat:6} {kind}")
    if not missing:
        print("  none")

    if adjusted:
        print(f"\nMatched to a nearby feed event ({len(adjusted)}) — the note records when the boat tied up,")
        print("the feed only when it sailed:")
        for item in adjusted:
            print(f"  {item}")
    if legged:
        print(f"\nEnded where the last leg ended ({len(legged)}) — the note gives the time the boat")
        print("let go and the place it was heading for, which is a trip rather than a stop:")
        for item in legged:
            print(f"  {item}")
    if relocated:
        print(f"\nRelocated to the place the feed puts the boat ({len(relocated)}) — the note has the")
        print("time to the second but named the other end of the leg:")
        for item in relocated:
            print(f"  {item}")
    if dropped:
        print(f"\nDropped, because the feed disagrees ({len(dropped)}):")
        for item in dropped:
            print(f"  {item}")
    if warnings:
        print(f"\nIgnored ({len(warnings)}):")
        for item in warnings:
            print(f"  {item}")


if __name__ == "__main__":
    main()
