// The counters, given a time axis.
//
// lib/counters.js answers "how many, ever". That was the right first thing and it is still the hot
// path — counting a request is a Map increment and touches no database. What it cannot answer is
// anything with a "when" in it: whether the board is busier than last week, which hour people
// actually check ferries, or when the upstream feed went stale. A total has no shape.
//
// So the totals are rolled up into hourly buckets and kept here. One row per hour per counter,
// which is a few hundred rows a day and about two megabytes a month — small enough that the ninety
// day retention below is generosity rather than necessity, and queryable, so a question nobody has
// asked yet is a SELECT rather than a new data structure.
//
// node:sqlite is built into Node, so this adds no dependency. It prints an ExperimentalWarning on
// Node 22; the alternative is a native module needing node-gyp, which this project's Dockerfile
// deliberately blocks from running install scripts.

import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const RETENTION_DAYS = 90;

// Response times land in fixed buckets rather than being stored per request: a histogram answers
// "is the board slow" in a few hundred bytes, and the alternative is keeping every timing forever
// to compute a number nobody reads to more than two significant figures.
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, Infinity];

export function latencyBucket(milliseconds) {
  return LATENCY_BUCKETS_MS.find((edge) => milliseconds <= edge) ?? Infinity;
}

// UTC, because an hour has to mean one thing for as long as the history lasts and New York changes
// offset twice a year. The page renders these in local time.
export function hourKey(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 13);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hourly (
    bucket TEXT NOT NULL,
    kind   TEXT NOT NULL,
    key    TEXT NOT NULL,
    count  INTEGER NOT NULL,
    PRIMARY KEY (bucket, kind, key)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS latency (
    bucket TEXT NOT NULL,
    route  TEXT NOT NULL,
    le     INTEGER NOT NULL,
    count  INTEGER NOT NULL,
    PRIMARY KEY (bucket, route, le)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
`;

export function createStatsStore({ databasePath, now = () => Date.now(), retentionDays = RETENTION_DAYS } = {}) {
  if (!databasePath) throw new Error("A stats database path is required.");

  const database = new DatabaseSync(databasePath);
  // The board must never wait on a stats write, and a torn stats file is not worth a fsync per
  // request. WAL lets the reader on /api/stats run while a rollup is being written.
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  database.exec(SCHEMA);

  const addCount = database.prepare(`
    INSERT INTO hourly (bucket, kind, key, count) VALUES (?, ?, ?, ?)
    ON CONFLICT (bucket, kind, key) DO UPDATE SET count = count + excluded.count
  `);
  const addLatency = database.prepare(`
    INSERT INTO latency (bucket, route, le, count) VALUES (?, ?, ?, ?)
    ON CONFLICT (bucket, route, le) DO UPDATE SET count = count + excluded.count
  `);
  const setMeta = database.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  const getMeta = database.prepare("SELECT value FROM meta WHERE key = ?");

  function meta(key) {
    return getMeta.get(key)?.value ?? null;
  }

  // Deltas rather than absolutes: the caller counts in memory and hands over what has happened
  // since it last did, so a restart mid-hour adds to the hour instead of overwriting it.
  // One transaction per rollup: a batch of counters is either all in the hour or none of it is, and
  // committing once beats committing per key. node:sqlite has no transaction() helper of its own,
  // so the statements are bracketed by hand.
  function write(bucket, deltas) {
    database.exec("BEGIN");
    try {
      for (const [kind, counts] of Object.entries(deltas.counts || {})) {
        for (const [key, count] of Object.entries(counts)) {
          if (Number.isInteger(count) && count > 0) addCount.run(bucket, kind, String(key), count);
        }
      }
      for (const [route, buckets] of Object.entries(deltas.latency || {})) {
        for (const [edge, count] of Object.entries(buckets)) {
          if (Number.isInteger(count) && count > 0) addLatency.run(bucket, route, Number(edge), count);
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function record(deltas, at = now()) {
    write(hourKey(at), deltas);
  }

  // The totals that existed before this file did. state/counters.json holds everything counted
  // since the counters shipped, and dropping it on the floor would restart the history at zero on
  // the very deploy that gave it a memory — so it is folded into the hour it was last written and
  // marked, so a second start does not count it twice.
  async function importLegacyCounters(counterPath) {
    if (meta("importedLegacyCounters")) return { imported: false, reason: "already imported" };
    let parsed;
    try {
      parsed = JSON.parse(await readFile(counterPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        setMeta.run("importedLegacyCounters", new Date(now()).toISOString());
        return { imported: false, reason: "no file" };
      }
      throw error;
    }

    const at = Number.isFinite(Date.parse(parsed?.since)) ? Date.parse(parsed.since) : now();
    write(hourKey(at), {
      counts: {
        route: parsed?.routes || {},
        landing: parsed?.landings || {},
        status: parsed?.statuses || {},
        event: parsed?.events || {}
      }
    });
    setMeta.run("importedLegacyCounters", new Date(now()).toISOString());
    if (parsed?.since) setMeta.run("since", parsed.since);
    return { imported: true, since: parsed?.since || null };
  }

  function since() {
    const saved = meta("since");
    if (saved) return saved;
    const earliest = database.prepare("SELECT MIN(bucket) AS bucket FROM hourly").get()?.bucket;
    return earliest ? `${earliest}:00:00.000Z` : null;
  }

  function markSince(iso) {
    if (!meta("since")) setMeta.run("since", iso);
  }

  function totals(kind) {
    const rows = database.prepare("SELECT key, SUM(count) AS total FROM hourly WHERE kind = ? GROUP BY key").all(kind);
    return Object.fromEntries(rows.map((row) => [row.key, row.total]));
  }

  // One row per hour for the last `hours`, including the hours nothing happened — a gap in a
  // sparkline has to read as quiet rather than as missing.
  function series(kind, { hours = 48, keys = null } = {}) {
    const from = hourKey(now() - (hours - 1) * 3_600_000);
    const parameters = [kind, from];
    let filter = "";
    if (keys?.length) {
      filter = ` AND key IN (${keys.map(() => "?").join(", ")})`;
      parameters.push(...keys);
    }
    const rows = database.prepare(`SELECT bucket, SUM(count) AS total FROM hourly WHERE kind = ? AND bucket >= ?${filter} GROUP BY bucket`).all(...parameters);
    const byBucket = new Map(rows.map((row) => [row.bucket, row.total]));
    const points = [];
    for (let index = hours - 1; index >= 0; index -= 1) {
      const bucket = hourKey(now() - index * 3_600_000);
      points.push({ hour: `${bucket}:00:00.000Z`, count: byBucket.get(bucket) || 0 });
    }
    return points;
  }

  // p50 and p95 read off the histogram, interpolating inside whichever bucket the rank lands in.
  // The number is only ever as precise as the bucket edges, which is the trade the histogram makes
  // and is plenty for "did this get slower".
  function latencies({ hours = 24 } = {}) {
    const from = hourKey(now() - (hours - 1) * 3_600_000);
    const rows = database.prepare("SELECT route, le, SUM(count) AS total FROM latency WHERE bucket >= ? GROUP BY route, le").all(from);
    const byRoute = new Map();
    for (const row of rows) {
      if (!byRoute.has(row.route)) byRoute.set(row.route, new Map());
      // The open-ended top bucket is stored as -1, because neither SQLite nor JSON has an infinity.
      // Sorted as a number it would come first and drag every percentile down with it.
      byRoute.get(row.route).set(row.le === -1 ? Infinity : row.le, row.total);
    }
    const result = {};
    for (const [route, buckets] of byRoute) {
      const edges = [...buckets.keys()].sort((a, b) => a - b);
      const count = [...buckets.values()].reduce((sum, value) => sum + value, 0);
      const quantile = (fraction) => {
        let seen = 0;
        const target = count * fraction;
        for (const edge of edges) {
          seen += buckets.get(edge);
          // The open-ended top bucket has no upper edge to report, so it reports its floor.
          if (seen >= target) return Number.isFinite(edge) ? edge : edges.at(-2) ?? edge;
        }
        return edges.at(-1);
      };
      result[route] = { count, p50: quantile(0.5), p95: quantile(0.95) };
    }
    return result;
  }

  function prune(at = now()) {
    const cutoff = hourKey(at - retentionDays * 86_400_000);
    const counts = database.prepare("DELETE FROM hourly WHERE bucket < ?").run(cutoff);
    const timings = database.prepare("DELETE FROM latency WHERE bucket < ?").run(cutoff);
    return { removed: (counts.changes || 0) + (timings.changes || 0), cutoff };
  }

  function close() {
    database.close();
  }

  return { record, importLegacyCounters, since, markSince, totals, series, latencies, prune, close, meta };
}

export async function openStatsStore({ databasePath, ...options }) {
  await mkdir(path.dirname(databasePath), { recursive: true });
  return createStatsStore({ databasePath, ...options });
}
