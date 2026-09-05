// Stamps the asset version from config/asset-version.json onto every file that carries it.
//
// An installed board only picks up new code when the service worker's cache name changes and the
// URLs in its precache list change with it. Those references live in five files and there are more
// than thirty of them, so bumping the version by hand meant editing all five and the contract test
// that pins them — and missing one left installed clients holding stale code against a fresh
// worker, which is the one failure this project cannot see from the outside.
//
// The version stays a literal in the shipped files rather than being injected at serve time: the
// service worker's FILES array has to be a plain array of strings that `cache.addAll` can take
// before anything else on the page has run, and a worker that has to fetch its own version first
// is a worker that can fail to install offline.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_CONFIG = path.join(ROOT, "config/asset-version.json");

// Every file that names the version, and nothing else. public/stats.html is deliberately absent:
// it is not part of the board shell, is not precached, and versions its own assets separately.
export const STAMPED_FILES = [
  "public/index.html",
  "public/map.html",
  "public/assets/site.webmanifest",
  "public/app.js",
  "public/sw.js"
];

// The query stamp on every asset URL, and the service worker's two cache names. Both have to move
// together: a new cache name with old URLs re-downloads nothing, and new URLs in the old cache are
// never fetched at all. Each entry knows how to find its references and how to write one.
//
// The cache-name pattern is scoped to the worker on purpose. public/app.js holds
// `cacheKey = "nyc-ferry-did-data-v6"`, which looks identical but is the prefix for every
// localStorage key the board owns — the chosen landing, the favourites, the theme, the hidden
// operators and the saved schedules. Bumping that with the assets would silently orphan all of it
// on every device, every release. It is deliberately frozen at v6 and must stay there.
const PATTERNS = [
  { find: /\?v=(\d+)/g, files: STAMPED_FILES, write: (version) => `?v=${version}` },
  {
    find: /nyc-ferry-did-(?:shell|data)-v(\d+)/g,
    files: ["public/sw.js"],
    write: (version, reference) => reference.replace(/\d+$/, String(version))
  }
];

export async function readAssetVersion() {
  const parsed = JSON.parse(await readFile(VERSION_CONFIG, "utf8"));
  const version = Number(parsed.version);
  if (!Number.isInteger(version) || version <= 0) throw new Error(`Invalid asset version: ${parsed.version}`);
  return version;
}

export function stamp(source, version, file) {
  return PATTERNS.reduce(
    (text, { find, files, write }) => files.includes(file)
      ? text.replace(find, (reference) => write(version, reference))
      : text,
    source
  );
}

// Which references disagree with the version, so the contract test can name the file and the stale
// string rather than only report that something somewhere has drifted.
export async function findDrift(version, root = ROOT) {
  const drift = [];
  for (const file of STAMPED_FILES) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const { find, files } of PATTERNS) {
      if (!files.includes(file)) continue;
      // The capture group is the digits alone, so version 3 cannot be read as matching "v93".
      for (const [reference, digits] of source.matchAll(find)) {
        if (Number(digits) !== version) drift.push({ file, found: reference });
      }
    }
  }
  return drift;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let version = await readAssetVersion();
  if (process.argv.includes("--bump")) {
    const parsed = JSON.parse(await readFile(VERSION_CONFIG, "utf8"));
    version += 1;
    await writeFile(VERSION_CONFIG, `${JSON.stringify({ ...parsed, version }, null, 2)}\n`);
  }
  let changed = 0;
  for (const file of STAMPED_FILES) {
    const full = path.join(ROOT, file);
    const source = await readFile(full, "utf8");
    const next = stamp(source, version, file);
    if (next === source) continue;
    await writeFile(full, next);
    changed += 1;
  }
  console.log(`Asset version ${version} stamped; ${changed} of ${STAMPED_FILES.length} files rewritten.`);
}
