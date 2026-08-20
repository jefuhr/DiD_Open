import test from "node:test";
import assert from "node:assert/strict";

import { crewNoticeAlert, fetchCrewNotices, parseCrewNotices } from "../lib/crew-notices.js";

// The shape dispatch actually writes: headings ending in a colon, notices under them, blank lines
// scattered through, and headings left standing empty for whenever there is something to put there.
const DOC = `﻿OUT OF SERVICE RAMPS:


CORLEARS HOOK - West ramp is OUT OF SERVICE.


E. 34th Street - Slip A Outside ramp transition plate damaged. PAX and Crew to use caution.


Other Info:
Governors Island: Please use the walkie in the white mailbox at the landing.
New Tablets PASSWORD : 1980 - Tablets in cradles on the concession counter.


Upcoming:




Future Alerts:`;

test("an empty heading is left off until somebody puts something under it", () => {
  const sections = parseCrewNotices(DOC);
  assert.deepEqual(sections.map((section) => section.title), ["OUT OF SERVICE RAMPS", "Other Info"]);
  // And comes back the moment it is populated, without anything else changing.
  const filled = parseCrewNotices(`${DOC}\nSandy Hook boat is running late.`);
  assert.deepEqual(filled.map((section) => section.title),
    ["OUT OF SERVICE RAMPS", "Other Info", "Future Alerts"]);
});

test("a notice that contains a colon is not mistaken for a heading", () => {
  const [, otherInfo] = parseCrewNotices(DOC);
  assert.equal(otherInfo.lines.length, 2);
  assert.match(otherInfo.lines[0], /^Governors Island: Please use the walkie/);
  assert.match(otherInfo.lines[1], /^New Tablets PASSWORD : 1980/);
});

test("the whole board is one alert, ranked as its own agency", () => {
  const alert = crewNoticeAlert(DOC);
  assert.equal(alert.id, "crew-notices");
  assert.equal(alert.source, "crew-notices");
  assert.equal(alert.agency, "Crew Notices");
  assert.equal(alert.header, "Crew notice board");
  // Every populated section, with its heading, in document order.
  assert.match(alert.description, /^OUT OF SERVICE RAMPS:\nCORLEARS HOOK/);
  assert.match(alert.description, /\n\nOther Info:\nGovernors Island/);
  assert.doesNotMatch(alert.description, /Upcoming|Future Alerts/);
  // It is true until dispatch changes it, so it carries no active period to expire against.
  assert.deepEqual(alert.activePeriods, []);
});

// The document is internal. The board carries what it says and never a way into it.
test("the document is never linked", () => {
  assert.equal(crewNoticeAlert(DOC).url, "");
});

test("a document with nothing on it produces no alert at all", () => {
  assert.equal(crewNoticeAlert(""), null);
  assert.equal(crewNoticeAlert("Upcoming:\n\nFuture Alerts:\n"), null);
});

// If the doc stops being shared, Google answers with a sign-in page and HTTP 200. Publishing that
// as a crew notice would be worse than publishing nothing.
test("a sign-in page is refused rather than published", async () => {
  await assert.rejects(
    fetchCrewNotices({
      fetchImpl: async () => ({
        ok: true, status: 200, headers: { get: () => null },
        text: async () => "<!DOCTYPE html><html><head><title>Sign in</title></head></html>"
      })
    }),
    /did not return text/
  );
});

test("a document that has been emptied reports no notice rather than an error", async () => {
  const alert = await fetchCrewNotices({
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "\n\n" })
  });
  assert.equal(alert, null);
});

test("the notice is read fresh, so an edit reaches the board on the next poll", async () => {
  let body = "Other Info:\nFirst version.";
  const impl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body });
  const before = await fetchCrewNotices({ fetchImpl: impl });
  assert.match(before.description, /First version/);
  body = "Other Info:\nSecond version.";
  const after = await fetchCrewNotices({ fetchImpl: impl });
  assert.match(after.description, /Second version/);
  assert.doesNotMatch(after.description, /First version/);
});
