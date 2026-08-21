import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appPath = new URL("../public/app.js", import.meta.url);
const cssPath = new URL("../public/styles.css", import.meta.url);
const indexPath = new URL("../public/index.html", import.meta.url);
const serverPath = new URL("../server.js", import.meta.url);
const workerPath = new URL("../public/sw.js", import.meta.url);
const changelogPath = new URL("../content/changelog.json", import.meta.url);

// Pull a function out of app.js and run it against a stubbed page. The board's client is a plain
// script rather than a module tree, so this is how the rest of the suite reaches into it too.
async function bangHidden({ entries, seen }) {
  const src = await readFile(appPath, "utf8");
  const version = src.match(/function changelogVersion\(entry\) \{[\s\S]*?\n\}/)[0];
  const bang = src.match(/function renderChangelogBang\(\) \{[\s\S]*?\n\}/)[0];
  const store = { "nyc-ferry-did-changelog-seen": seen };
  const localStorage = { getItem: (key) => store[key] ?? null, setItem: (key, value) => { store[key] = value; } };
  const elements = { changelogBang: { hidden: null } };
  new Function("changelog", "localStorage", "elements", "changelogSeenKey",
    `${version}${bang}; renderChangelogBang();`)(entries, localStorage, elements, "nyc-ferry-did-changelog-seen");
  return elements.changelogBang.hidden;
}

test("the change log is hand-written content, and it parses", async () => {
  const parsed = JSON.parse(await readFile(changelogPath, "utf8"));
  assert.ok(Array.isArray(parsed.entries), "expected an entries array to write into");
  for (const entry of parsed.entries) {
    assert.ok(entry.version || entry.date || entry.title, "every entry needs something to identify it by");
    if (entry.notes !== undefined) assert.ok(Array.isArray(entry.notes), "notes are a list of lines");
  }
});

// The mark is the whole reason the button is worth glancing at, so it has to mean something.
test("the mark shows only while the newest entry is unread", async () => {
  const entries = [{ version: "2026-08-21" }, { version: "2026-08-01" }];
  assert.equal(await bangHidden({ entries, seen: null }), false, "a device that has never opened it should see the mark");
  assert.equal(await bangHidden({ entries, seen: "2026-08-21" }), true, "reading the newest entry puts it away");
  assert.equal(await bangHidden({ entries, seen: "2026-08-01" }), false, "an older entry read is still an unread newest entry");
  assert.equal(await bangHidden({ entries: [], seen: null }), true, "nothing written down is nothing to announce");
});

test("opening the sheet is what marks it read", async () => {
  const src = await readFile(appPath, "utf8");
  assert.match(src, /localStorage\.setItem\(changelogSeenKey, changelogVersion\(changelog\[0\]\)\)/);
  // And a device that refuses to store it keeps showing the mark rather than throwing.
  assert.match(src, /\} catch \{\n\s+\/\/ A device that will not store the mark simply keeps showing it\./);
});

test("the button carries the site's own kitty, and the shell caches it", async () => {
  const [index, worker, css] = await Promise.all(
    [indexPath, workerPath, cssPath].map((file) => readFile(file, "utf8")));
  assert.match(index, /<img class="changelog-icon" src="\/assets\/kitty\.png\?v=\d+"/);
  assert.match(index, /<span class="changelog-bang" id="changelogBang" aria-hidden="true" hidden>!<\/span>/);
  // An icon missing from the precache is a broken image the first time the board opens offline.
  assert.match(worker, /'\/assets\/kitty\.png\?v=\d+'/);
  assert.match(css, /\.changelog-bang\{/);
});

// A board with an unreadable change log is still a board; this is the least important thing on it.
test("a change log that cannot be read serves nothing rather than failing", async () => {
  const server = await readFile(serverPath, "utf8");
  assert.match(server, /if \(url\.pathname === "\/api\/changelog"\)/);
  assert.match(server, /return json\(response, 200, \{ entries: \[\] \}\);/);
  // Served from /api/ so the service worker treats it as data rather than caching it for the life
  // of the shell — an edit has to be able to reach a board that is already installed.
  assert.doesNotMatch(server, /changelog\.json.*assets/);
});
