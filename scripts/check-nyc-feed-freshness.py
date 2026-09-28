#!/usr/bin/env python3
"""Fail when NYC Ferry's published GTFS has changed since the live maps were reviewed."""
import csv
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
URL = 'https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip'
MAPS = ('schedules/sukkot-2026-live.json',
        'schedules/sukkot-2026-crew.json',
        'schedules/fall-2026-post-sukkot-live.json')


def main():
    request = urllib.request.Request(URL, headers={'User-Agent': 'NYC-Ferry-DiD-Reborn/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        content = response.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise ValueError('GTFS ZIP exceeded 10 MB')
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        version = next(csv.DictReader(io.StringIO(
            archive.read('feed_info.txt').decode('utf-8-sig'))))['feed_version']
    stale = []
    for name in MAPS:
        reviewed = json.loads((ROOT / name).read_text())['feedVersion']
        if reviewed != version:
            stale.append(f'{name}: reviewed {reviewed}')
    if stale:
        print(f'NYC Ferry GTFS is now {version}; review and regenerate live trip maps:', file=sys.stderr)
        for item in stale:
            print(f'  {item}', file=sys.stderr)
        print('Archive the new ZIP, then regenerate the live and crew mappings.', file=sys.stderr)
        return 1
    print(f'NYC Ferry GTFS {version} matches all reviewed trip and crew maps.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
