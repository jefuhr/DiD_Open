#!/usr/bin/env python3
"""Fail when NYC Ferry's published GTFS has changed since the live maps were reviewed."""
import csv
import datetime as dt
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
URL = 'https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip'
MAPS = ('schedules/sukkot-2026-live.json',
        'schedules/sukkot-2026-crew.json',
        'schedules/fall-2026-post-sukkot-live.json')


def stale_mappings(version, date, root=ROOT):
    stale = []
    for name in MAPS:
        reviewed = json.loads((root / name).read_text())
        end = max(reviewed['dates']) if reviewed.get('dates') else reviewed.get('endDate')
        # A finished holiday remains tied to its historical archive, not today's new feed.
        if end and end < date:
            continue
        if reviewed['feedVersion'] != version:
            stale.append(f"{name}: reviewed {reviewed['feedVersion']}")
    return stale


def main():
    request = urllib.request.Request(URL, headers={'User-Agent': 'NYC-Ferry-DiD-Reborn/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        content = response.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise ValueError('GTFS ZIP exceeded 10 MB')
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        version = next(csv.DictReader(io.StringIO(
            archive.read('feed_info.txt').decode('utf-8-sig'))))['feed_version']
    date = dt.datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    stale = stale_mappings(version, date)
    if stale:
        print(f'NYC Ferry GTFS is now {version}; review and regenerate live trip maps:', file=sys.stderr)
        for item in stale:
            print(f'  {item}', file=sys.stderr)
        print('Archive the new ZIP, then regenerate the affected live and crew mappings.', file=sys.stderr)
        return 1
    print(f'NYC Ferry GTFS {version} matches all current trip and crew maps.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
