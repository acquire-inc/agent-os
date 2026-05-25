import { schema, type Db } from "@agent-os/db";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";

const { skills } = schema;

export interface SkillFrontMatter {
  name?: string;
  description?: string;
  version?: string;
  [k: string]: string | undefined;
}

/** Parse the YAML front-matter block at the top of a SKILL.md. */
export function parseFrontMatter(content: string): SkillFrontMatter {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return {};
  const fm: SkillFrontMatter = {};
  for (const line of m[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key) fm[key] = val;
  }
  return fm;
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Recursively find all SKILL.md files under a directory. */
export async function findSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name === "SKILL.md") out.push(full);
    }
  }
  await walk(dir);
  return out.sort();
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skills: { key: string; name: string; version: string; status: "created" | "updated" | "unchanged" }[];
}

/**
 * Sync SKILL.md files from a directory (a cloned skills repo) into the registry.
 * The version is a content hash, so any change bumps it — "each push bumps a
 * version" (Master doc §4.5). Idempotent: re-syncing unchanged skills is a no-op.
 */
export async function syncSkillsFromDir(
  db: Db,
  args: { tenantId: string; projectId?: string | null; source?: "github" | "builtin" | "custom"; repoPrefix?: string; dir: string },
): Promise<SyncResult> {
  const files = await findSkillFiles(args.dir);
  const result: SyncResult = { created: 0, updated: 0, unchanged: 0, skills: [] };

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const fm = parseFrontMatter(content);
    const folder = basename(dirname(file));
    const key = slugify(fm.name || folder);
    if (!key) continue;
    const name = fm.name || folder;
    const description = fm.description ?? "";
    const version = createHash("sha256").update(content).digest("hex").slice(0, 12);
    const repoPath = args.repoPrefix ? `${args.repoPrefix}/${folder}` : folder;

    const [existing] = await db.select().from(skills).where(and(eq(skills.tenantId, args.tenantId), eq(skills.key, key))).limit(1);

    if (!existing) {
      await db.insert(skills).values({
        tenantId: args.tenantId, projectId: args.projectId ?? null, key, name, description, version,
        source: args.source ?? "github", repoPath, scope: args.projectId ? "project" : "global", enabled: true,
      });
      result.created++;
      result.skills.push({ key, name, version, status: "created" });
    } else if (existing.version !== version) {
      await db.update(skills).set({ name, description, version, repoPath, source: args.source ?? existing.source }).where(eq(skills.id, existing.id));
      result.updated++;
      result.skills.push({ key, name, version, status: "updated" });
    } else {
      result.unchanged++;
      result.skills.push({ key, name, version, status: "unchanged" });
    }
  }
  return result;
}
