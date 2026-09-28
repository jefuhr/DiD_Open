#!/usr/bin/env python3
"""Match fall trips to their reissued IDs in the operator's post-Sukkot GTFS.

Only complete trips with identical route, stops and times are linked. The older
feed remains the source for September history and verified crew boundaries.
"""
import collections
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
START = dt.date(2026, 10, 3)
END = dt.date(2026, 11, 1)
OUTPUT = ROOT / 'schedules/fall-2026-post-sukkot-live.json'


def active_services(calendar, exceptions, day):
    key = day.strftime('%Y%m%d')
    name = day.strftime('%A').lower()
    active = {row['service_id'] for row in calendar
              if row['start_date'] <= key <= row['end_date'] and row[name] == '1'}
    for row in exceptions:
        if row['date'] == key:
            if row['exception_type'] == '1':
                active.add(row['service_id'])
            else:
                active.discard(row['service_id'])
    return active


def source(read):
    trips = {row['trip_id']: row for row in read('trips.txt')}
    calls = collections.defaultdict(list)
    for row in read('stop_times.txt'):
        calls[row['trip_id']].append((int(row['stop_sequence']), row['stop_id'],
                                      row['arrival_time'], row['departure_time']))
    signatures = {trip_id: (trip['route_id'], tuple(sorted(calls[trip_id])))
                  for trip_id, trip in trips.items()}
    return trips, signatures, read('calendar.txt'), read('calendar_dates.txt')


def main(path):
    def old(name):
        with (ROOT / 'gtfs' / name).open(newline='') as file:
            return list(csv.DictReader(file))

    with zipfile.ZipFile(path) as archive:
        def new(name):
            return list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))

        version = new('feed_info.txt')[0]['feed_version']
        old_trips, old_signatures, old_calendar, old_exceptions = source(old)
        new_trips, new_signatures, new_calendar, new_exceptions = source(new)

    matches = collections.defaultdict(set)
    seen = set()
    day = START
    while day <= END:
        old_services = active_services(old_calendar, old_exceptions, day)
        new_services = active_services(new_calendar, new_exceptions, day)
        current = collections.defaultdict(set)
        for trip_id, trip in new_trips.items():
            if trip['service_id'] in new_services:
                current[new_signatures[trip_id]].add(trip_id)
        for trip_id, trip in old_trips.items():
            if trip['service_id'] not in old_services:
                continue
            seen.add(trip_id)
            for candidate in current[old_signatures[trip_id]]:
                matches[trip_id].add(candidate)
        day += dt.timedelta(days=1)

    confirmed = {old_id: next(iter(candidates)) for old_id, candidates in matches.items()
                 if len(candidates) == 1}
    result = {
        'source': str(path.relative_to(ROOT)),
        'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'feedVersion': version, 'startDate': START.isoformat(), 'endDate': END.isoformat(),
        'counts': {'oldTrips': len(seen), 'matched': len(confirmed),
                   'unmatched': len(seen - matches.keys()),
                   'ambiguous': sum(len(candidates) > 1 for candidates in matches.values())},
        'matches': dict(sorted(confirmed.items(), key=lambda item: int(item[0])))
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Mapped {len(confirmed)} of {len(seen)} fall trips to GTFS {version} "
          f"({result['counts']['unmatched']} unmatched).")


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
