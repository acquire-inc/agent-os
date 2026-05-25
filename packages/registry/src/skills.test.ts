// Skill-sync integration test. Run: DATABASE_URL=... pnpm --filter @agent-os/registry test
import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { findSkillFiles, parseFrontMatter, slugify, syncSkillsFromDir } from "./skills.js";

let passed = 0,
  failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}

async function skill(dir: string, folder: string, name: string, description: string, body = "Body.") {
  const d = join(dir, folder);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDb(url);
  const tenantId = TENANT_IDS.cliently;

  console.log("\n[front-matter]");
  const fm = parseFrontMatter('---\nname: My Skill\ndescription: "Use when X happens"\n---\nbody');
  assert(fm.name === "My Skill" && fm.description === "Use when X happens", "parses name + quoted description");
  assert(slugify("Get Shit Done!") === "get-shit-done", "slugify normalizes");
  assert(Object.keys(parseFrontMatter("no front matter")).length === 0, "no front-matter → empty");

  console.log("\n[real repo parse]");
  const realFiles = await findSkillFiles("/tmp/superpowers/skills");
  assert(realFiles.length >= 10, `finds SKILL.md files in superpowers (${realFiles.length})`);

  console.log("\n[sync create / idempotent / update]");
  const dir = await mkdtemp(join(tmpdir(), "aos-skilltest-"));
  await skill(dir, "alpha", "Alpha", "Use when alpha");
  await skill(dir, "beta", "Beta", "Use when beta");
  // Clean any prior test rows.
  await db.delete(schema.skills).where(and(eq(schema.skills.tenantId, tenantId), inArray(schema.skills.key, ["alpha", "beta"])));

  const r1 = await syncSkillsFromDir(db, { tenantId, dir, source: "github", repoPrefix: "test/skills" });
  assert(r1.created === 2 && r1.updated === 0, `first sync creates 2 (created=${r1.created})`);
  const [alpha] = await db.select().from(schema.skills).where(and(eq(schema.skills.tenantId, tenantId), eq(schema.skills.key, "alpha")));
  assert(alpha?.repoPath === "test/skills/alpha", "repoPath set from prefix + folder");
  const v1 = alpha?.version;

  const r2 = await syncSkillsFromDir(db, { tenantId, dir, source: "github" });
  assert(r2.unchanged === 2 && r2.created === 0 && r2.updated === 0, `re-sync is idempotent (unchanged=${r2.unchanged})`);

  // Change alpha's content → version bumps, only alpha updates.
  await skill(dir, "alpha", "Alpha", "Use when alpha OR gamma", "Updated body.");
  const r3 = await syncSkillsFromDir(db, { tenantId, dir, source: "github" });
  assert(r3.updated === 1 && r3.unchanged === 1, `content change bumps exactly one (updated=${r3.updated})`);
  const [alpha2] = await db.select().from(schema.skills).where(and(eq(schema.skills.tenantId, tenantId), eq(schema.skills.key, "alpha")));
  assert(alpha2?.version !== v1, "version changed on content change");
  assert(alpha2?.description === "Use when alpha OR gamma", "description updated");

  // Cleanup.
  await db.delete(schema.skills).where(and(eq(schema.skills.tenantId, tenantId), inArray(schema.skills.key, ["alpha", "beta"])));

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
