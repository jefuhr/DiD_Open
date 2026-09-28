#!/usr/bin/env python3
"""Keep operational notes from the Sukkot assignment board without personnel data."""
import hashlib
import json
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'schedules/sukkot-2026-board.json'


def main(workbook):
    extract = runpy.run_path(str(ROOT / 'scripts/extract-vessel-board.py'))['extract']
    board = extract(workbook, 'Board')
    # This layout puts the four shuttle times in O, unlike the ordinary fall board.
    shuttles = [{'label': board['shuttleCells'][f'N{row}'],
                 'timeFraction': board['shuttleCells'][f'O{row}'],
                 'source': f'Board!N{row}:O{row}'} for row in range(3, 7)]
    result = {
        'source': Path(workbook).name,
        'workbookSha256': hashlib.sha256(Path(workbook).read_bytes()).hexdigest(),
        'sheet': 'Board',
        'assignments': board['assignments'],
        'shuttles': shuttles
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Saved {len(result['assignments'])} Sukkot assignment notes and "
          f"{len(shuttles)} shuttle rows without personnel names.")


if __name__ == '__main__':
    main(sys.argv[1])
