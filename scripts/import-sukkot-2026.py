#!/usr/bin/env python3
"""Extract the archived, visually reviewed Sukkot PDFs into per-landing timetables.

Requires PyMuPDF. Offline maintenance only; npm build consumes the checked-in JSON.
The PDFs contain inconsistent through-trip rows. Columns are authoritative for
published departure times; never infer connections or vehicle-trip IDs from rows.
"""
import json
import re
import statistics
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'schedules/fall-2026-sources'
# Visually checked left-to-right columns. Repeated stops represent arrival then departure.
LAYOUTS = {
    'ER': [['87','20','8','19','18','4','17'], ['17','4','18','19','8','20','87']],
    'SB': [['17','115','87','87','11','24','111','118','23'], ['23','118','111','24','11','87','87','115','17']],
    'RS': [['88','118','87','87','114','17','113','112','141'], ['141','112','113','17','114','87','87','118','88']],
    'AS': [['87','120','17','90','25','89','113'], ['113','89','25','90','17','120','87']],
    'SG': [['138','136','137','23','11','87'], ['87','11','23','137','136','138']],
    'GI': [['87','111'], ['111','87']],
    'RES': [['62','61','37','103','105','39','104','142','16'], ['16']],
    'RWS': [['48','49','50','51','52','55','16'], ['16']],
}
EXPECTED_COUNTS = {
    'ER': [72,72,36,36,36,38,74,72,36,36,36,36,72,72],
    'SB': [20,20,20,20,20,20,5,14,14,14,14,5,21,21,21,21,21,21],
    'RS': [22,22,22,22,21,21,21,21,21,22,22,22,22,22,22,22,21,21],
    'AS': [18]*7+[19]*7, 'SG': [21,21,22,22,22,22,21,21,21,22,22,22],
    'GI': [25,25,27,27], 'RES': [13]*10, 'RWS': [13]*8,
}

def extract(route):
    page = pymupdf.open(SOURCE / f'{route}.pdf')[0]
    words = [w for w in page.get_text('words') if re.fullmatch(r'\d{1,2}:\d{2}', w[4])]
    columns = []
    for word in sorted(words, key=lambda w: (w[0]+w[2])/2):
        center = (word[0]+word[2])/2
        if not columns or center-statistics.mean((v[0]+v[2])/2 for v in columns[-1]) > 18:
            columns.append([])
        columns[-1].append(word)
    assert [len(c) for c in columns] == EXPECTED_COUNTS[route], f'{route}: PDF layout changed'
    result = []
    column_offset = 0
    for direction, stops in enumerate(LAYOUTS[route]):
        table = {}
        for col, stop in enumerate(stops):
            previous = None
            offset = 0
            for w in sorted(columns[column_offset+col], key=lambda w:w[1]):
                hour, minute = map(int, w[4].split(':'))
                value = hour*60+minute+offset
                # A large backwards jump is the 12-hour clock wrapping. Small backwards
                # jumps are errors printed in the source, not permission to add 12 hours.
                if previous is not None and value < previous-360:
                    offset += 720
                    value += 720
                assert 0 <= value < 1440, (route, col, w[4], value)
                previous = value
                # Font-weight changes shift baselines by <1 pt; rows are at least 16 pt apart.
                row = next((y for y in table if abs(y-w[1]) < 3), None)
                if row is None:
                    row = round(w[1], 2)
                    table[row] = [None]*len(stops)
                assert table[row][col] is None
                table[row][col] = f'{value//60:02}:{value%60:02}:00'
        result.append({'direction': direction, 'stops': stops,
                       'rows': [{'pdfY': y, 'times': table[y]} for y in sorted(table)]})
        column_offset += len(stops)
    return result

manifest = json.loads((SOURCE/'sources.json').read_text())
result = {
    'source': 'NYC Ferry Sukkot 2026 published timetable PDFs',
    'dates': ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'],
    'note': 'Per-landing published times only. Through-trip rows in ER, SG and SB contain inconsistencies; no vehicle trips, arrival estimates or connections are inferred. Timetable PDF takes precedence over blog prose (GI final Pier 11 departure: 16:26 in PDF, 16:21 in blog).',
    'routes': {r: {'url': manifest['pdfs'][r], 'tables': extract(r)} for r in LAYOUTS},
}
(ROOT/'schedules/sukkot-2026.json').write_text(json.dumps(result, indent=2)+'\n')
print('Extracted', sum(len(t['rows']) for v in result['routes'].values() for t in v['tables']), 'table rows across eight routes')
