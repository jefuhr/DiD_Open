#!/usr/bin/env python3
"""Check APK packaging boundaries without installing an app or accessing a device."""

import argparse
import json
import pathlib
import zipfile


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("apk", type=pathlib.Path)
	parser.add_argument("--variant", choices=("debug", "release"), required=True)
	args = parser.parse_args()
	root = pathlib.Path(__file__).resolve().parent.parent
	fixtures = {"assets/" + p.name for p in (root / "ios/FerryBoard/PreviewData").glob("*.json")}
	geometry = {"assets/harbor-chart.json", "assets/harbor-shoreline.json", "assets/manhattan-details.json"}
	with zipfile.ZipFile(args.apk) as apk:
		entries = set(apk.namelist())
		missing_geometry = sorted(geometry - entries)
		if missing_geometry:
			raise SystemExit("Missing offline chart assets: " + ", ".join(missing_geometry))
		packaged_fixtures = sorted(fixtures & entries)
		if args.variant == "release" and packaged_fixtures:
			raise SystemExit("Debug fixtures leaked into release APK: " + ", ".join(packaged_fixtures))
		if args.variant == "debug" and fixtures - entries:
			raise SystemExit("Debug fixture assets are incomplete")
		for name in geometry:
			json.loads(apk.read(name))
		print(json.dumps({
			"apk": str(args.apk), "variant": args.variant,
			"offline_chart_assets": sorted(geometry),
			"debug_fixture_count": len(packaged_fixtures),
			"result": "passed",
		}, indent=2))


if __name__ == "__main__":
	main()
