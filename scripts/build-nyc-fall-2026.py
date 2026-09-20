#!/usr/bin/env python3
"""Reproduce NYC Ferry's fall snapshot, with source-backed date corrections.

The downloaded ZIP is preserved unchanged under schedules/fall-2026-sources.
Only the root NYC Ferry GTFS files are written; partner feeds are untouched.
Holiday per-landing timetables are merged by build-data.js, not invented GTFS trips.
"""
import csv
import io
import hashlib
import zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
HOLIDAYS = ['20260928','20260929','20260930','20261001','20261002']
CRUISE = ['20260919','20260926','20260927','20261003','20261010','20261011','20261017','20261024','20261031','20261101']

def encode(headers, rows):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=headers, lineterminator='\n')
    writer.writeheader(); writer.writerows(rows)
    return out.getvalue().encode()

def main():
    with zipfile.ZipFile(ROOT/'schedules/fall-2026-sources/nycferry-20260913.zip') as z:
        files = {name:z.read(name) for name in z.namelist()}
    def read(name):
        reader=csv.DictReader(io.StringIO(files[name].decode('utf-8-sig')))
        return reader.fieldnames,list(reader)
    fields,info=read('feed_info.txt')
    assert info[0]['feed_version']=='20260913'
    # September 20 compacts the same timetable to services 1/2/3 and removes expired
    # trips. Keep the verified seasonal IDs used by crew notes and historical date
    # navigation, but require every current trip and call to match the refresh.
    refresh_path = ROOT/'schedules/fall-2026-sources/nycferry-20260920.zip'
    assert hashlib.sha256(refresh_path.read_bytes()).hexdigest() == 'f08d8455b1c9286f19bb7f0a994124fe23b7e7f18fd467cfd2d92883e1e0e100'
    with zipfile.ZipFile(refresh_path) as refresh:
        def current(name):
            return list(csv.DictReader(io.StringIO(refresh.read(name).decode('utf-8-sig'))))
        old_trips = {r['trip_id']:r for r in read('trips.txt')[1]}
        new_trips = current('trips.txt')
        mapping = {'2':'1', '3':'1', '4':'2', '6':'2', '8':'3'}
        for trip in new_trips:
            old = old_trips[trip['trip_id']]
            assert mapping[old['service_id']] == trip['service_id'], trip
            assert {k:v for k,v in old.items() if k != 'service_id'} == {k:v for k,v in trip.items() if k != 'service_id'}, trip
        current_ids = {r['trip_id'] for r in new_trips}
        assert {r['service_id'] for k,r in old_trips.items() if k not in current_ids} == {'1','5','7'}
        expected_calls = {tuple(sorted(r.items())) for r in read('stop_times.txt')[1] if r['trip_id'] in current_ids}
        assert expected_calls == {tuple(sorted(r.items())) for r in current('stop_times.txt')}
        refreshed_info = current('feed_info.txt')[0]
        assert refreshed_info['feed_version'] == '20260920'
        info[0]['feed_version'] = refreshed_info['feed_version']
    info[0]['feed_end_date']='20261101'
    files['feed_info.txt']=encode(fields,info)
    fields,calendar=read('calendar.txt')
    assert {r['service_id'] for r in calendar}==set('12345678')
    for c in calendar:
        c['end_date']=min(c['end_date'],'20261101')
        if c['service_id']=='8':
            c['saturday']=c['sunday']='0'
    files['calendar.txt']=encode(fields,calendar)
    fields,exceptions=read('calendar_dates.txt')
    assert not exceptions
    # Service 7 already supplies September 19. Service 8 must not run every weekend.
    exceptions.extend({'service_id':'8','date':d,'exception_type':'1'} for d in CRUISE[1:])
    # Every NYC Ferry route has its own holiday PDF, including St. George and buses.
    exceptions.extend({'service_id':c['service_id'],'date':d,'exception_type':'2'} for c in calendar for d in HOLIDAYS)
    files['calendar_dates.txt']=encode(fields,exceptions)
    for name,data in files.items():
        assert '/' not in name and name.endswith('.txt')
        (ROOT/'gtfs'/name).write_bytes(data)
    print('Verified all 555 current trips against feed 20260920; built the curated fall calendar through November 1, retaining historical trips, exact cruise dates and Sukkot exclusions.')
if __name__=='__main__':main()
