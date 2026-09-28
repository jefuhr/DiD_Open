#!/usr/bin/env python3
"""Verify Sukkot pickup notes against the holiday GTFS for Pier C's board."""
import collections
import csv
import datetime as dt
import io
import json
from pathlib import Path
import re
import runpy
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BOARD = ROOT / 'schedules/sukkot-2026-board.json'
SCHEDULE = ROOT / 'schedules/sukkot-2026.json'
FEED = ROOT / 'schedules/fall-2026-sources/nycferry-20260928.zip'
OUTPUT = ROOT / 'schedules/sukkot-2026-crew.json'
LABEL = re.compile(r'\b(RWSV|RWY|AST|SBK|ERF|STG|G\.I\.)\s*(\d+)', re.I)
ROUTES = {'RWSV': 'RS', 'RWY': 'RS', 'AST': 'AS', 'SBK': 'SB',
          'ERF': 'ER', 'STG': 'SG', 'G.I.': 'GI'}
PREFIX = {'ER': '1', 'RS': '2', 'SB': '3', 'AS': '4', 'GI': '7', 'SG': '8'}
SHUTTLE_LANDING = {3: (16, 'Wall St/Pier 11'), 4: (16, 'Wall St/Pier 11'),
                   5: (16, 'Wall St/Pier 11'), 6: (8, 'East 34th Street')}
# Dispatch approved the published pickup times over these two conflicting notes on 2026-09-28.
PUBLISHED_PICKUPS = {'Board!K2': '06:46', 'Board!C26': '14:18'}


def minutes(value):
    hours, minute = map(int, value.split(':'))
    return hours * 60 + minute


def main():
    parser = runpy.run_path(str(ROOT / 'scripts/import-boat-shifts.py'))
    board = json.loads(BOARD.read_text())
    dates = json.loads(SCHEDULE.read_text())['dates']
    assignments = json.loads((ROOT / 'content/boat-assignments.json').read_text())['assignments']

    def place(value):
        name = parser['place'](value)
        return 'Midtown West 39th St-Pier 79' if name == 'Midtown West/W 39th St-Pier 79' else name

    allowed = collections.defaultdict(set)
    for entry in board['assignments']:
        match = LABEL.search(entry['label'])
        if match:
            allowed[ROUTES[match[1].upper()]].add(int(match[2]))

    with zipfile.ZipFile(FEED) as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))

        version = rows('feed_info.txt')[0]['feed_version']
        calendars = rows('calendar.txt')
        exceptions = rows('calendar_dates.txt')
        active = {}
        weekdays = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
        for date in dates:
            key = date.replace('-', '')
            weekday = weekdays[dt.date.fromisoformat(date).weekday()]
            services = {row['service_id'] for row in calendars
                        if row['start_date'] <= key <= row['end_date'] and row[weekday] == '1'}
            for row in exceptions:
                if row['date'] == key:
                    (services.add if row['exception_type'] == '1' else services.discard)(row['service_id'])
            active[date] = services
        trips = {row['trip_id']: row for row in rows('trips.txt')}
        stops = {row['stop_id']: row['stop_name'] for row in rows('stops.txt')}
        events = {date: collections.defaultdict(set) for date in dates}
        for call in rows('stop_times.txt'):
            if call['pickup_type'] == '1':
                continue
            trip = trips.get(call['trip_id'])
            if not trip or trip['route_id'] not in allowed:
                continue
            route, short_name = trip['route_id'], trip['trip_short_name']
            working = assignments.get(short_name)
            inferred = int(short_name[1]) if len(short_name) == 4 \
                and short_name[0] == PREFIX[route] and short_name[1].isdigit() else None
            if inferred in allowed[route]:
                if working is not None and working != inferred:
                    raise ValueError(f'Working conflict for {route} trip {short_name}')
                working = inferred
            if working not in allowed[route]:
                continue
            boat = f'{route}{working}'
            key = (boat, stops[call['stop_id']], call['departure_time'][:5])
            for date, services in active.items():
                if trip['service_id'] in services:
                    events[date][key].add(call['trip_id'])

    shifts = collections.defaultdict(list)
    parsed = {}
    rejected = []
    for entry in board['assignments']:
        label = LABEL.search(entry['label'])
        if not label:
            continue
        boat = ROUTES[label[1].upper()] + label[2]
        kind = 'AM' if re.search(r'\bAM\b', entry['label']) else \
            'PM' if re.search(r'\bPM\b', entry['label']) else 'ALL'
        source = 'Board!' + entry['cell']
        first = parser['FIRST'].search(entry['note'])
        if not first and boat.startswith('GI'):
            first = re.search(r'First\s+Pick\s*Up\s*(\d{1,2}:\d{2})\s*([^\n]+)',
                              entry['note'], re.I)
        if not first:
            rejected.append({'source': source, 'boat': boat, 'field': 'start', 'reason': 'unparsed pickup'})
            continue
        noted_time, raw_place = first.groups()
        noted_place = place(raw_place)
        last = parser['LAST'].search(entry['note'])
        parsed[boat, kind] = {'startTime': noted_time, 'startPlace': noted_place,
                              'endTime': last[1] if last else None,
                              'endPlace': place(last[2]) if last else None,
                              'source': source}
        key = (boat, noted_place, noted_time)
        common = set.intersection(*(events[date][key] for date in dates)) if noted_place else set()
        corrected_time = None
        if len(common) != 1 and source in PUBLISHED_PICKUPS:
            corrected_time = PUBLISHED_PICKUPS[source]
            corrected_key = (boat, noted_place, corrected_time)
            common = set.intersection(*(events[date][corrected_key] for date in dates))
            if len(common) != 1:
                raise ValueError(f'Approved published pickup for {source} is no longer unique')
        if len(common) != 1:
            nearby = sorted({(time, trip_id) for time in
                             {candidate[2] for candidate in events[dates[0]]
                              if candidate[:2] == (boat, noted_place)
                              and abs(minutes(candidate[2]) - minutes(noted_time)) <= 12}
                             for trip_id in set.intersection(*(events[date][boat, noted_place, time]
                                                              for date in dates))})
            rejected.append({'source': source, 'boat': boat, 'field': 'start',
                             'notedTime': noted_time, 'place': noted_place,
                             'nearby': [{'time': time, 'tripId': trip_id} for time, trip_id in nearby],
                             'reason': 'no unique pickup on every Sukkot date'})
            continue
        shift = {'shift': kind, 'source': source, 'startTime': corrected_time or noted_time,
                 'startPlace': noted_place, 'predictTripId': next(iter(common))}
        if corrected_time:
            shift['startNoteTime'] = noted_time
            shift['startConfirmedSource'] = 'User approved published GTFS time, 2026-09-28'
        shifts[boat].append(shift)

    shuttles = []
    for entry in board['shuttles']:
        row = int(re.search(r'N(\d+)', entry['source'])[1])
        landing, landing_name = SHUTTLE_LANDING[row]
        boats = [ROUTES[match[1].upper()] + match[2] for match in LABEL.finditer(entry['label'])]
        if len(boats) != len(set(boats)) or not boats:
            raise ValueError(f'Invalid shuttle working list in {entry["source"]}')
        ready = round(float(entry['timeFraction']) * 1440)
        for boat in boats:
            am, pm = parsed.get((boat, 'AM')), parsed.get((boat, 'PM'))
            verified_pm = next((shift for shift in shifts[boat] if shift['shift'] == 'PM'), None)
            if not am or not pm or not am['endTime'] or not verified_pm \
                    or am['endPlace'] != landing_name or pm['startPlace'] != landing_name \
                    or not (ready <= minutes(am['endTime']) <= minutes(pm['startTime']) <= ready + 60):
                raise ValueError(f'Shuttle {entry["source"]} does not bracket {boat} at {landing_name}')
            verified_pm['shuttled'] = True
            verified_pm['shuttleSource'] = entry['source']
        shuttles.append({'landing': landing, 'time': f'{ready // 60:02}:{ready % 60:02}',
                         'boats': boats, 'source': entry['source']})

    for entries in shifts.values():
        entries.sort(key=lambda item: item['startTime'])
    result = {'source': str(BOARD.relative_to(ROOT)), 'workbookSha256': board['workbookSha256'],
              'feedVersion': version, 'dates': dates, 'shifts': {'holiday': dict(sorted(shifts.items()))},
              'shuttles': {'holiday': shuttles}, 'rejected': rejected}
    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Saved {sum(map(len, shifts.values()))} verified pickups and {len(shuttles)} Pier C shuttles; '
          f'{len(rejected)} pickup notes unresolved.')
    for item in rejected:
        print(f'  {item["source"]} {item["boat"]}: {item.get("notedTime", item["reason"])} '
              f'{item.get("nearby", [])}')


if __name__ == '__main__':
    main()
