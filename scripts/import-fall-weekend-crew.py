#!/usr/bin/env python3
"""Import Board operational comments against every active fall weekend pattern."""
import collections
import csv
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

def main():
    parser = module('shift_parser', 'import-boat-shifts.py')
    source = module('board', 'extract-vessel-board.py').extract(sys.argv[1], 'Board', shuttle_end_row=7, include_summaries=True)
    source['assignments'] = [e for e in source['assignments'] if parser.LABEL.search(e['label'])]
    read = lambda name: list(csv.DictReader((ROOT / 'gtfs' / (name + '.txt')).open()))
    calendars, exceptions = read('calendar'), read('calendar_dates')
    cruise_dates = ['2026-09-19','2026-09-26','2026-09-27','2026-10-03','2026-10-10','2026-10-11','2026-10-17','2026-10-24','2026-10-31','2026-11-01']
    active = {}
    for offset in range(44):
        date = dt.date(2026,9,19) + dt.timedelta(days=offset)
        if date.weekday() not in [5,6]: continue
        key = date.strftime('%Y%m%d')
        services = {c['service_id'] for c in calendars if c['start_date'] <= key <= c['end_date'] and c[['saturday','sunday'][date.weekday()-5]] == '1'}
        for e in exceptions:
            if e['date'] == key:
                if e['exception_type'] == '1': services.add(e['service_id'])
                else: services.discard(e['service_id'])
        active[date.isoformat()] = services
    assert [d for d,s in active.items() if s & {'7','8'}] == cruise_dates
    assignments = json.loads((ROOT/'content/boat-assignments.json').read_text())['assignments']
    stops = {s['stop_id']:s['stop_name'] for s in read('stops')}
    calls = collections.defaultdict(list)
    for r in read('stop_times'): calls[r['trip_id']].append(r)
    events = collections.defaultdict(lambda: collections.defaultdict(set))
    for trip in read('trips'):
        if trip['trip_short_name'] not in assignments: continue
        boat = trip['route_id'] + str(assignments[trip['trip_short_name']])
        ordered = sorted(calls[trip['trip_id']], key=lambda r:int(r['stop_sequence']))
        for date, services in active.items():
            if trip['service_id'] not in services: continue
            for kind, rows in [('start',ordered[:-1]),('end',ordered[1:])]:
                for c in rows:
                    events[date][boat,kind].add((stops[c['stop_id']], parser.seconds(c['departure_time' if kind=='start' else 'arrival_time'])))
    shifts, rejected = collections.defaultdict(list), []
    # Dispatch confirmed these two boundaries after the workbook was prepared.  They are
    # intentionally explicit: neither note matches the published passenger event minute, but
    # both are operational drop-off/pickup times supplied by the user.
    confirmed_overrides = {
        ('SG3', 'PM', 'start'): ('16:15', 'Wall St/Pier 11', 'Board!I26'),
        ('RS1', 'PM', 'end'): ('21:57', 'Wall St/Pier 11', 'Board!A10'),
    }
    for e in source['assignments']:
        cruise = e['label'] == 'SBK Cruise Shuttle'
        label = parser.LABEL.search(e['label'])
        if not cruise and not label[2]: continue
        boat = 'SB3' if cruise else parser.ROUTES[label[1]]+label[2]
        record = {'shift':'AM' if re.search(r'\bAM\b',e['label']) else 'PM' if re.search(r'\bPM\b',e['label']) else 'ALL', 'source':f"Board!{e['cell']}"}
        if cruise: record['serviceIds'] = ['7','8']
        for kind, regex in [('start',parser.FIRST),('end',parser.LAST)]:
            match = regex.search(e['note'])
            if not match:
                rejected.append({'source':record['source'],'boat':boat,'field':kind,'reason':'unparsed note'});continue
            time, place = match.groups(); place = parser.place(place)
            if place == 'Midtown West/W 39th St-Pier 79': place = stops['138']
            noted = parser.seconds(time)
            dates = cruise_dates if cruise else list(active)
            common = set.intersection(*(events[d][boat,kind] for d in dates))
            # RS comments record berth arrival before the feed's Pier 11 departure.
            berth = kind == 'end' and boat in {'RS1','RS2','RS3','RS4','RS5'} and record['shift']=='AM' and place==stops['87']
            candidates = sorted(s for p,s in common if p==place and (s==noted or berth and 0 <= s-noted <=600))
            if not candidates:
                override = confirmed_overrides.get((boat, record['shift'], kind))
                if override:
                    record[kind+'Time'], record[kind+'Place'], record[kind+'ConfirmedSource'] = override
                    continue
                rejected.append({'source':record['source'],'boat':boat,'field':kind,'time':time,'place':place,'reason':'no matching event across applicable fall weekends'});continue
            matched = min(candidates,key=lambda s:abs(s-noted))
            record[kind+'Time'], record[kind+'Place'] = parser.clock(matched), place
            if matched != noted: record[kind+'NoteTime'] = time
        if 'startTime' in record or 'endTime' in record: shifts[boat].append(record)
    for entries in shifts.values(): entries.sort(key=lambda e:e.get('startTime', e.get('endTime', '')))
    shuttles=[]
    for row in range(3,8):
        cells=source['shuttleCells'];label=cells[f'N{row}']
        boats=[parser.ROUTES[m[1]]+m[2] for m in parser.LABEL.finditer(label) if m[2] and m[2].isdigit()]
        shuttles.append({'landing':9 if row==4 else 16,'time':parser.clock(round(float(cells[f'P{row}'])*86400)), 'boats':boats,'source':f'Board!N{row}:P{row}'})
    summary_conflicts = []
    for cell, text in source['summaryCells'].items():
        label = parser.LABEL.search(text)
        time = re.search(r'\b(\d{1,2}:\d{2})\b', text)
        if not label or not label[2] or not time: continue
        boat = parser.ROUTES[label[1]] + label[2]
        shift = 'PM' if re.search(r'\bPM\b', text) else 'ALL'
        record = next((r for r in shifts.get(boat, []) if r['shift'] == shift), None)
        if record and record.get('startTime') and record['startTime'] != time[1]:
            summary_conflicts.append({'source': 'Board!' + cell, 'boat': boat, 'summaryTime': time[1],
                                      'verifiedTime': record['startTime'], 'commentSource': record['source']})
    result={'source':source,'workbookSha256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),'startDate':'2026-09-19','endDate':'2026-11-01','serviceIds':['4','6','7','8'],'cruiseDates':cruise_dates,'shifts':{'weekend':dict(sorted(shifts.items()))},'shuttles':{'weekend':shuttles},'summaryConflicts':summary_conflicts,'confirmedCorrections':[{'boat':boat,'shift':shift,'field':field,'time':value[0],'place':value[1],'source':value[2]} for (boat,shift,field),value in confirmed_overrides.items()]}
    if rejected: result['rejected'] = rejected
    (ROOT/'schedules/fall-2026-weekend-crew.json').write_text(json.dumps(result,indent=2)+'\n')
    print(f'Imported {sum(map(len,shifts.values()))} shifts, {len(shuttles)} crew shuttles; {len(rejected)} unresolved fields')
    print(json.dumps(rejected,indent=2))

if __name__=='__main__': main()
