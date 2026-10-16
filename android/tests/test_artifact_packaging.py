"""Exercise APK fixture checks using isolated files and no installed application."""

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


class ArtifactPackagingTest(unittest.TestCase):
	def setUp(self):
		self.directory = tempfile.TemporaryDirectory(prefix="ferry-kitty-packaging-")
		self.addCleanup(self.directory.cleanup)
		self.root = pathlib.Path(self.directory.name)
		self.script = self.root / "scripts/check-android-artifact.py"
		self.script.parent.mkdir()
		source = pathlib.Path(__file__).resolve().parents[2] / "scripts/check-android-artifact.py"
		shutil.copyfile(source, self.script)
		self.fixtures = self.root / "ios/FerryKitty/PreviewData"
		self.fixtures.mkdir(parents=True)
		for name in ("landings.json", "schedule-16.json"):
			(self.fixtures / name).write_text("{}")
		self.apk = self.root / "app.apk"

	def package(self, fixture_names=()):
		with zipfile.ZipFile(self.apk, "w") as apk:
			for name in ("harbor-chart.json", "harbor-shoreline.json", "manhattan-details.json"):
				apk.writestr("assets/" + name, "{}")
			for name in fixture_names:
				apk.writestr("assets/" + name, "{}")

	def check(self, variant):
		return subprocess.run(
			[sys.executable, str(self.script), str(self.apk), "--variant", variant],
			capture_output=True, text=True, check=False,
		)

	def test_debug_contains_all_renamed_preview_fixtures(self):
		self.package(("landings.json", "schedule-16.json"))
		result = self.check("debug")
		self.assertEqual(0, result.returncode, result.stderr)
		self.assertEqual(2, json.loads(result.stdout)["debug_fixture_count"])

	def test_debug_rejects_missing_fixture(self):
		self.package(("landings.json",))
		result = self.check("debug")
		self.assertNotEqual(0, result.returncode)
		self.assertIn("Debug fixture assets are incomplete", result.stderr)

	def test_release_rejects_preview_fixture(self):
		self.package(("landings.json",))
		result = self.check("release")
		self.assertNotEqual(0, result.returncode)
		self.assertIn("Debug fixtures leaked into release APK", result.stderr)

	def test_release_accepts_geometry_without_fixtures(self):
		self.package()
		result = self.check("release")
		self.assertEqual(0, result.returncode, result.stderr)
		self.assertEqual(0, json.loads(result.stdout)["debug_fixture_count"])

	def test_missing_fixture_directory_cannot_report_success(self):
		shutil.rmtree(self.fixtures)
		self.package()
		for variant in ("debug", "release"):
			with self.subTest(variant=variant):
				result = self.check(variant)
				self.assertNotEqual(0, result.returncode)
				self.assertIn("Preview fixtures are missing", result.stderr)


if __name__ == "__main__":
	unittest.main()
