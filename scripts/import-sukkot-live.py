#!/usr/bin/env python3
"""Link published Sukkot departure cells to unambiguous trips in the operator's GTFS.

Usage: python3 scripts/import-sukkot-live.py schedules/fall-2026-sources/nycferry-20260928.zip
The source ZIP is kept so the mapping can be reproduced when the operator changes its feed.
"""
import collections
import csv
import datetime as dt
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
        calendars, exceptions = rows('calendar.txt'), rows('calendar_dates.txt')
        weekdays = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
        active = {}
        for date in source['dates']:
            key = date.replace('-', '')
            weekday = weekdays[dt.date.fromisoformat(date).weekday()]
            services = {row['service_id'] for row in calendars
                        if row['start_date'] <= key <= row['end_date'] and row[weekday] == '1'}
            for row in exceptions:
                if row['date'] == key:
                    (services.add if row['exception_type'] == '1' else services.discard)(row['service_id'])
            active[date] = services
        # Only export a common holiday schedule when its source trip runs on every date.
        common_services = set.intersection(*active.values())
        trips = {row['trip_id']: row for row in rows('trips.txt')
                 if row['service_id'] in common_services}
        calls = collections.defaultdict(list)
        by_event = {date: collections.defaultdict(set) for date in source['dates']}
        all_trips = {row['trip_id']: row for row in rows('trips.txt')}
        for row in rows('stop_times.txt'):
            trip = all_trips.get(row['trip_id'])
            if not trip:
                continue
            if row['trip_id'] in trips:
                calls[row['trip_id']].append(row)
            for date, services in active.items():
                if trip['service_id'] in services:
                    by_event[date][trip['route_id'], row['stop_id'], row['departure_time']].add(row['trip_id'])
        for items in calls.values():
            items.sort(key=lambda row: int(row['stop_sequence']))

    def working_of(trip):
        route_id, short_name = trip['route_id'], trip['trip_short_name']
        working = assignments.get(short_name)
        inferred = int(short_name[1]) if len(short_name) == 4 \
            and short_name[0] == WORKING_PREFIX.get(route_id) and short_name[1].isdigit() else None
        if inferred in allowed[route_id]:
            if working is not None and working != inferred:
                raise ValueError(f'Working conflict for {route_id} trip {short_name}')
            working = inferred
        return working if isinstance(working, int) and working in allowed[route_id] else None

    def seconds(value):
        if not value:
            return None
        hour, minute, second = map(int, value.split(':'))
        return hour * 3600 + minute * 60 + second

    schedules = {}
    for trip_id, trip in trips.items():
        if trip['route_id'] not in source['routes']:
            continue
        schedules[trip_id] = {
            'routeId': trip['route_id'], 'directionId': trip['direction_id'],
            'boatAssignment': working_of(trip),
            'stops': [{'stopId': call['stop_id'], 'sequence': int(call['stop_sequence']),
                       'arrivalSeconds': seconds(call['arrival_time']),
                       'departureSeconds': seconds(call['departure_time']),
                       'pickupType': int(call.get('pickup_type') or 0),
                       'dropOffType': int(call.get('drop_off_type') or 0)}
                      for call in calls[trip_id]]
        }

    matches = {}
    counts = collections.Counter()
    for route_id, route in source['routes'].items():
        for table in route['tables']:
            for row_index, row in enumerate(table['rows']):
                for column, (stop_id, time) in enumerate(zip(table['stops'], row['times'])):
                    if not time:
                        continue
                    events = [by_event[date][route_id, stop_id, time] for date in source['dates']]
                    candidates = set.intersection(*events)
                    if any(len(event) != 1 for event in events):
                        candidates = set()
                    counts['printed'] += 1
                    if len(candidates) != 1:
                        counts['ambiguous' if any(len(event) > 1 for event in events) else 'unmatched'] += 1
                        continue
                    trip_id = next(iter(candidates))
                    working = working_of(trips[trip_id])
                    key = f"nyc:sukkot:{route_id}:{table['direction']}:{row_index}:{column}"
                    matches[key] = {
                        'tripId': trip_id, 'routeId': route_id, 'stopId': stop_id,
                        'departureTime': time, 'boatAssignment': working if isinstance(working, int) else None
                    }
                    counts['matched'] += 1

    # The PDFs print separate arrival/departure columns at Pier 11. The GTFS
    # repeats departure in both fields, so preserve the published dwell after
    # matching the DEPARTURE to one exact feed call. A printed row alone never
    # establishes a through trip (some rows mix sailings).
    arrivals = {}
    for route_id, route in source['routes'].items():
        for table in route['tables']:
            for row_index, row in enumerate(table['rows']):
                for column in range(1, len(table['stops'])):
                    if table['stops'][column - 1] != table['stops'][column]:
                        continue
                    arrival, departure = row['times'][column - 1:column + 1]
                    if not arrival or not departure:
                        continue
                    key = f"nyc:sukkot:{route_id}:{table['direction']}:{row_index}:{column}"
                    match = matches.get(key)
                    if not match:
                        continue
                    calls_ = schedules[match['tripId']]['stops']
                    candidates = [(i, call) for i, call in enumerate(calls_)
                                  if call['stopId'] == match['stopId']
                                  and call['departureSeconds'] == seconds(departure)]
                    if len(candidates) != 1:
                        continue
                    index, call = candidates[0]
                    value = seconds(arrival)
                    before = calls_[index - 1]['departureSeconds'] if index else 0
                    if not before <= value <= call['departureSeconds']:
                        raise ValueError(f'Published dwell conflicts with feed call order: {key}')
                    identity = (match['tripId'], call['sequence'])
                    if identity in arrivals and arrivals[identity] != value:
                        raise ValueError(f'Conflicting published arrivals: {identity}')
                    arrivals[identity] = value
                    call.setdefault('feedArrivalSeconds', call['arrivalSeconds'])
                    call['arrivalSeconds'] = value
                    call['arrivalSource'] = key

    result = {
        'source': str(source_path.relative_to(ROOT)),
        'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'boardSource': str(BOARD.relative_to(ROOT)),
        'boardWorkbookSha256': board['workbookSha256'],
        'allowedWorkings': {route: sorted(numbers) for route, numbers in sorted(allowed.items())},
        'feedVersion': version, 'dates': source['dates'],
        'counts': dict(counts), 'publishedDwells': len(arrivals), 'matches': matches, 'trips': schedules
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Mapped {counts['matched']} of {counts['printed']} published Sukkot cells "
          f"({counts['unmatched']} unmatched, {counts['ambiguous']} ambiguous) from GTFS {version}.")


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
