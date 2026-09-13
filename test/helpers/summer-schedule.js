// Historical crew behavior remains tested against the schedule that confirmed it.
// The gzip contains only the pre-fall NYC Ferry feed and its three crew data files.
import { readFile, readdir, mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { buildDisplayData } from '../../scripts/build-data.js';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let fixture;
async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nyc-summer-regression-'));
  const files = JSON.parse(gunzipSync(await readFile(new URL('../fixtures/summer-2026.json.gz', import.meta.url))));
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  for (const name of ['display.json', 'landings.json']) await symlink(path.join(ROOT, 'config', name), path.join(root, 'config', name));
  for (const entry of await readdir(path.join(ROOT, 'gtfs'), { withFileTypes: true })) {
    if (entry.isDirectory()) await symlink(path.join(ROOT, 'gtfs', entry.name), path.join(root, 'gtfs', entry.name));
  }
  return root;
}
export async function buildSummerDisplayData(options = {}) {
  fixture ||= createFixture();
  return buildDisplayData({ root: await fixture, ...options });
}
after(async () => { if (fixture) await rm(await fixture, { recursive: true, force: true }); });
