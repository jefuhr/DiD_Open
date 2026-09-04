import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createCachedSnapshotService({ cachePath, empty, refresh, ttlMs, now }) {
  let memory = null, loaded = false, inflight = null;

  async function load() {
    if (!loaded) {
      loaded = true;
      try { memory = JSON.parse(await readFile(cachePath, "utf8")); } catch { memory = null; }
    }
    return memory;
  }

  async function update() {
    const snapshot = await refresh(memory);
    memory = snapshot;
    await mkdir(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, "utf8");
    await rename(temporary, cachePath);
    return snapshot;
  }

  return {
    async getCurrent() {
      const cached = await load();
      const age = cached?.fetchedAt ? now() - Date.parse(cached.fetchedAt) : Infinity;
      if (cached && age >= 0 && age < ttlMs) return { ...cached, stale: false };
      if (!inflight) inflight = update().finally(() => { inflight = null; });
      try { return await inflight; }
      catch (error) {
        if (cached) return { ...cached, available: true, stale: true, error: error.message };
        return { ...empty, error: error.message };
      }
    }
  };
}
