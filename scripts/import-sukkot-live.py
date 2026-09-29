#!/usr/bin/env python3
"""Link published Sukkot departure cells to unambiguous trips in the operator's GTFS.

Usage: python3 scripts/import-sukkot-live.py schedules/fall-2026-sources/nycferry-20260928.zip
The source ZIP is kept so the mapping can be reproduced when the operator changes its feed.
"""
import collections
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SCHEDULE = ROOT / 'schedules/sukkot-2026.json'
OUTPUT = ROOT / 'schedules/sukkot-2026-live.json'
BOARD = ROOT / 'schedules/sukkot-2026-board.json'
LABEL = re.compile(r'\b(RWSV|AST|SBK|ERF|STG|G\.I\.)\s*(\d+)', re.I)
ROUTES = {'RWSV': 'RS', 'AST': 'AS', 'SBK': 'SB', 'ERF': 'ER',
          'STG': 'SG', 'G.I.': 'GI'}
WORKING_PREFIX = {'ER': '1', 'RS': '2', 'SB': '3', 'AS': '4', 'GI': '7', 'SG': '8'}


def seconds(value):
    hours, minutes, seconds = map(int, value.split(':'))
    return hours * 3600 + minutes * 60 + seconds


def main(source_path):
    source = json.loads(SCHEDULE.read_text())
    board = json.loads(BOARD.read_text())
    allowed = collections.defaultdict(set)
    for entry in board['assignments']:
        label = LABEL.search(entry['label'])
        if label:
            allowed[ROUTES[label[1].upper()]].add(int(label[2]))
    assignments = json.loads((ROOT / 'content/boat-assignments.json').read_text())['assignments']
    with zipfile.ZipFile(source_path) as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))

        version = rows('feed_info.txt')[0]['feed_version']
        services = {
            row['service_id'] for row in rows('calendar.txt')
            if any(row['start_date'] <= date.replace('-', '') <= row['end_date']
                   and row['monday'] == '1' for date in source['dates'])
        }
        trips = {row['trip_id']: row for row in rows('trips.txt')
                 if row['service_id'] in services}
        by_event = collections.defaultdict(set)
        calls_by_trip = collections.defaultdict(list)
        for row in rows('stop_times.txt'):
            trip = trips.get(row['trip_id'])
            if trip:
                by_event[(trip['route_id'], row['stop_id'], row['departure_time'])].add(row['trip_id'])
                calls_by_trip[row['trip_id']].append(row)

    matches = {}
    counts = collections.Counter()
    for route_id, route in source['routes'].items():
        for table in route['tables']:
            for row_index, row in enumerate(table['rows']):
                for column, (stop_id, time) in enumerate(zip(table['stops'], row['times'])):
                    if not time:
                        continue
                    candidates = by_event[(route_id, stop_id, time)]
                    counts['printed'] += 1
                    if len(candidates) != 1:
                        counts['ambiguous' if candidates else 'unmatched'] += 1
                        continue
                    trip_id = next(iter(candidates))
                    short_name = trips[trip_id]['trip_short_name']
                    working = assignments.get(short_name)
                    inferred = int(short_name[1]) if len(short_name) == 4 \
                        and short_name[0] == WORKING_PREFIX.get(route_id) \
                        and short_name[1].isdigit() else None
                    if inferred in allowed[route_id]:
                        if working is not None and working != inferred:
                            raise ValueError(f'Working conflict for {route_id} trip {short_name}')
                        working = inferred
                    key = f"nyc:sukkot:{route_id}:{table['direction']}:{row_index}:{column}"
                    matches[key] = {
                        'tripId': trip_id, 'routeId': route_id, 'stopId': stop_id,
                        'departureTime': time, 'boatAssignment': working if isinstance(working, int) else None
                    }
                    counts['matched'] += 1

    # The PDF tables are per landing; some rows splice different sailings together. A cell
    # verified against one GTFS trip can show that trip's actual stop sequence without joining
    # adjacent PDF cells that may describe another boat.
    trip_schedules = {}
    for trip_id in sorted({match['tripId'] for match in matches.values()}, key=int):
        calls = sorted(calls_by_trip[trip_id], key=lambda call: int(call['stop_sequence']))
        if len(calls) < 2 or len({call['stop_sequence'] for call in calls}) != len(calls):
            raise ValueError(f'Incomplete Sukkot trip stop sequence for {trip_id}')
        if any(seconds(before['departure_time']) > seconds(after['arrival_time'])
               for before, after in zip(calls, calls[1:])):
            raise ValueError(f'Nonchronological Sukkot trip stop sequence for {trip_id}')
        trip_schedules[trip_id] = [
            {'stopId': call['stop_id'], 'sequence': int(call['stop_sequence']),
             'arrivalSeconds': seconds(call['arrival_time']),
             'departureSeconds': seconds(call['departure_time'])}
            for call in calls
        ]

    result = {
        'source': str(source_path.relative_to(ROOT)),
        'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'boardSource': str(BOARD.relative_to(ROOT)),
        'boardWorkbookSha256': board['workbookSha256'],
        'allowedWorkings': {route: sorted(numbers) for route, numbers in sorted(allowed.items())},
        'feedVersion': version, 'dates': source['dates'],
        'counts': dict(counts), 'matches': matches, 'tripSchedules': trip_schedules
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Mapped {counts['matched']} of {counts['printed']} published Sukkot cells "
          f"({counts['unmatched']} unmatched, {counts['ambiguous']} ambiguous) from GTFS {version}.")


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
