// Runner-side cache of the model catalog (Phase 41).
//
// The intelligent picker (Phase 39/40) needs ModelCatalogEntry[]. Reading
// the models table on every per-skill emit would be wasteful — the catalog
// changes once per operator edit, not once per run. We cache for 5
// minutes in-process; future operator tooling can poke a cache-bust
// endpoint when it edits the table.
//
// When DATABASE_URL is unset we return an empty catalog; the picker
// falls through to the tier fork / baseline paths cleanly.

import type { ModelCatalogEntry } from "@agent-os/core";
import { createDb, loadModelCatalog, type Db } from "@agent-os/db";

let cachedCatalog: ModelCatalogEntry[] | null = null;
let cachedAt = 0;
let cachedDb: Db | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getModelCatalog(): Promise<ModelCatalogEntry[]> {
  const url = process.env.DATABASE_URL;
  if (!url) return [];
  if (cachedCatalog && Date.now() - cachedAt < TTL_MS) return cachedCatalog;
  if (!cachedDb) cachedDb = createDb(url);
  try {
    cachedCatalog = await loadModelCatalog(cachedDb);
    cachedAt = Date.now();
    return cachedCatalog;
  } catch (e) {
    console.error(`[runner] loadModelCatalog failed: ${(e as Error).message}`);
    return cachedCatalog ?? [];
  }
}

// (resetCatalogCacheForTests was removed in the Phase 70 cleanup — no test
// ever called it. Restore from git history if a cache-reset hook is needed.)
