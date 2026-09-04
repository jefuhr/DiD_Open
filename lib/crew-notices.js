// The crew notice board, read from the Google Doc dispatch keeps it in.
//
// It is one alert, not one per line: the doc is a single standing notice with sections, and every
// section on it is true at the same time. Splitting it would put five rows on a board that has one
// line to spare and would rank "New Tablets PASSWORD" against a ramp that is out of service.
//
// Where it ranks: below NYC Ferry's own live alerts and above everything else. A boat cancelled ten
// minutes ago outranks a standing notice; a standing notice outranks a subway closure.
//
// Why the plain-text export and not the HTML one: the HTML gives every heading a generated class
// (c5 c19, c20 c5 c16, c9 — no two alike) and no heading tags at all, so there is nothing
// structural to read. The text export is the honest source.

import { withTimeout } from "./request.js";

const DOC_ID = "1mjY87VB3ORCNW5E7QNff33Gx-6aPOmCCT4cOlqVjR9k";
export const CREW_NOTICES_URL = `https://docs.google.com/document/d/${DOC_ID}/export?format=txt`;
export const CREW_NOTICES_MAX_BYTES = 512 * 1024;

// A heading is a line that ends in a colon. Content lines in this doc carry colons too — "Governors
// Island: please use the walkie", "New Tablets PASSWORD : 1980" — but they carry them in the middle,
// so the test is the last character rather than the presence of one.
//
// The length cap is the second half of that guard, for a content line that happens to end on a
// colon. It is a heuristic and it can be wrong: a heading longer than this reads as content, which
// is untidy but harmless, while a content line shorter than this that ends in a colon reads as an
// empty heading and is dropped. That second case is the one that loses text, which is why the cap is
// generous — every heading on the doc today is under twenty-five characters.
const HEADING_MAX_LENGTH = 60;

function isHeading(line) {
  return line.endsWith(":") && line.length <= HEADING_MAX_LENGTH;
}

// Sections in document order, each with the lines written under it. Headings with nothing under them
// are left out entirely: the doc keeps "Upcoming:" and "Future Alerts:" standing empty for whenever
// there is something to put there, and an empty heading on the board is a row that says nothing.
export function parseCrewNotices(text) {
  const sections = [];
  let current = null;
  for (const raw of String(text || "").replace(/^﻿/, "").split(/\r?\n/)) {
    // Google exports non-breaking spaces inside pasted text; they are whitespace to a reader.
    const line = raw.replace(/ /g, " ").trim();
    if (!line) continue;
    if (isHeading(line)) {
      current = { title: line.replace(/:$/, "").trim(), lines: [] };
      sections.push(current);
      continue;
    }
    // A line before any heading still belongs to the notice; it just has no section to sit under.
    if (!current) {
      current = { title: null, lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections.filter((section) => section.lines.length > 0);
}

export function crewNoticeAlert(text, { now = Date.now() } = {}) {
  const sections = parseCrewNotices(text);
  if (!sections.length) return null;
  // Section titles are kept in the body rather than folded away, because "CORLEARS HOOK - West ramp
  // is OUT OF SERVICE" means something different under "Out of service ramps" than under "Upcoming".
  const description = sections
    .map((section) => (section.title ? `${section.title}:\n${section.lines.join("\n")}` : section.lines.join("\n")))
    .join("\n\n");
  return {
    id: "crew-notices",
    source: "crew-notices",
    agency: "Crew Notices",
    // Named for what it is rather than for its first line: the first line changes, and a bar that
    // renames itself every time dispatch edits a ramp is harder to read, not easier.
    header: "Crew notice board",
    description,
    // Deliberately no url. The board carries what the document says, not a way into the document:
    // the sheet renders a url as a link, and this one is an internal dispatch doc that has no
    // business being a tappable link on a board anyone can be standing in front of.
    url: "",
    cause: null,
    effect: null,
    // No period. It is true until dispatch changes it, which is what polling is for.
    activePeriods: [],
    routeIds: [],
    stopIds: [],
    tripIds: [],
    sections: sections.map((section) => section.title).filter(Boolean),
    fetchedAt: new Date(now).toISOString()
  };
}

export async function fetchCrewNotices({
  fetchImpl = globalThis.fetch,
  url = process.env.CREW_NOTICES_URL || CREW_NOTICES_URL,
  now = Date.now(),
  timeoutMs = 8000,
  maxBytes = CREW_NOTICES_MAX_BYTES,
  contact = process.env.ALERTS_CONTACT || "juliet.fuhr@hornblower.com"
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:") throw new Error("The crew notice document must be fetched over HTTPS.");
  return withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(endpoint, {
      signal,
      headers: { Accept: "text/plain", "User-Agent": `Pier11-NYCF-Kiosk/1.0 (${contact})` }
    });
    if (!response.ok) throw new Error(`The crew notice document responded ${response.status}.`);
    const length = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(length) && length > maxBytes) {
      throw new Error("The crew notice document is larger than the allowed size.");
    }
    const text = await response.text();
    // If the document stops being shared, Google answers with a sign-in page rather than an error.
    // Publishing that as a crew notice would be worse than publishing nothing, so it is rejected on
    // the way in and the source reports itself unavailable like any other failure.
    if (/^\s*</.test(text) || /<html/i.test(text.slice(0, 500))) {
      throw new Error("The crew notice document did not return text — check that it is still shared.");
    }
    if (text.length > maxBytes) throw new Error("The crew notice document is larger than the allowed size.");
    return crewNoticeAlert(text, { now });
  });
}
