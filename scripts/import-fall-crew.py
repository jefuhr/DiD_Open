#!/usr/bin/env python3
"""Import verified ordinary fall weekday boundaries; retain source notes and rejected fields."""
import collections
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

def main():
    extractor = module('extract_board', 'extract-vessel-board.py')
    parser = module('shift_parser', 'import-boat-shifts.py')
    source = extractor.extract(sys.argv[1], 'FALL WKDY 26')
    corrections = json.loads((ROOT / 'schedules/fall-2026-crew-corrections.json').read_text())
    rows = lambda name: list(csv.DictReader((ROOT / 'gtfs' / (name + '.txt')).open()))
    services = {r['service_id'] for r in rows('calendar') if r['monday'] == '1' and r['start_date'] <= '20260914' <= r['end_date']}
    assignments = json.loads((ROOT / 'content/boat-assignments.json').read_text())['assignments']
    stops = {r['stop_id']: r['stop_name'] for r in rows('stops')}
    times = collections.defaultdict(list)
    for row in rows('stop_times'):
        times[row['trip_id']].append(row)
    events = collections.defaultdict(lambda: {'start': set(), 'end': set()})
    for trip in rows('trips'):
        if trip['service_id'] not in services or trip['trip_short_name'] not in assignments:
            continue
        boat = trip['route_id'] + str(assignments[trip['trip_short_name']])
        calls = sorted(times[trip['trip_id']], key=lambda r: int(r['stop_sequence']))
        for kind, calls_ in [('start', calls[:-1]), ('end', calls[1:])]:
            for call in calls_:
                events[boat][kind].add((stops[call['stop_id']], parser.seconds(call['departure_time' if kind == 'start' else 'arrival_time'])))
    shifts = collections.defaultdict(list)
    rejected = []
    for entry in source['assignments']:
        label = parser.LABEL.search(entry['label'])
        if not label:
            continue
        boat = parser.ROUTES[label[1]] + label[2]
        record = {'shift': 'AM' if re.search(r'\bAM\b', entry['label']) else 'PM', 'source': source['sheet'] + '!' + entry['cell']}
        correction = next((c for c in corrections if c['source'] == record['source'] and c['boat'] == boat and c['shift'] == record['shift']), None)
        note = correction['note'] if correction else entry['note']
        if correction:
            record['correction'] = correction
        for kind, regex in [('start', parser.FIRST), ('end', parser.LAST)]:
            match = regex.search(note)
            if not match:
                rejected.append({'source': record['source'], 'boat': boat, 'field': kind, 'reason': 'unparsed note'})
                continue
            time, place = match.groups()
            place = parser.place(place)
            if place == 'Midtown West/W 39th St-Pier 79':
                place = stops['138']
            noted = parser.seconds(time)
            candidates = sorted({s for p, s in events[boat][kind] if p == place and abs(s - noted) <= 600})
            # The documented Pier 11 berth/departure difference applies only to shuttled RS crews.
            allowed = kind == 'end' and boat in {'RS1', 'RS3', 'RS4', 'RS6'} and record['shift'] == 'AM' and place == stops['87']
            matched = noted if noted in candidates else (min(candidates, key=lambda s: abs(s-noted)) if allowed and candidates else None)
            if correction and kind == 'end' and correction.get('endTimetableTime'):
                confirmed_event = parser.seconds(correction['endTimetableTime'])
                if confirmed_event in candidates:
                    matched = confirmed_event
            if matched is None:
                rejected.append({'source': record['source'], 'boat': boat, 'field': kind, 'time': time, 'place': place, 'reason': 'no matching fall weekday event'})
                continue
            record[kind + 'Time'] = parser.clock(matched)
            record[kind + 'Place'] = place
            if matched != noted:
                record[kind + 'NoteTime'] = time
        if 'startTime' in record and 'endTime' in record:
            shifts[boat].append(record)
    for entries in shifts.values():
        entries.sort(key=lambda r: r['startTime'])
    shuttle = source['shuttleCells']
    shuttles = []
    for row, landing in [(3, 16), (4, 8), (5, 11), (6, 16)]:
        label = shuttle[f'N{row}']
        boats = [parser.ROUTES[m[1]] + m[2] for m in parser.LABEL.finditer(label) if m[2] and m[2].isdigit()]
        shuttles.append({'landing': landing, 'time': parser.clock(round(float(shuttle[f'P{row}']) * 86400)), 'boats': boats,
                         'source': f"{source['sheet']}!N{row}:Q{row}", 'carrierNote': shuttle[f'Q{row}']})
    result = {'source': source, 'workbookSha256': hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),
              'startDate': '2026-09-14', 'endDate': '2026-11-01',
              'serviceIds': sorted(services), 'shifts': {'weekday': dict(sorted(shifts.items()))},
              'shuttles': {'weekday': shuttles}, 'rejected': rejected}
    (ROOT / 'schedules/fall-2026-weekday-crew.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f"Imported {sum(map(len, shifts.values()))} shifts and {len(shuttles)} shuttles; {len(rejected)} unresolved fields")

if __name__ == '__main__':
    main()
