// Skill sync CLI. Clones a skills repo (or uses a local dir) and syncs SKILL.md
// files into the registry for a tenant.
//   SKILLS_DIR=/path TENANT_ID=<uuid> pnpm --filter @agent-os/registry sync
//   SKILLS_REPO_URL=https://github.com/org/acqu-skills TENANT_ID=<uuid> ... sync
import { createDb } from "@agent-os/db";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { syncSkillsFromDir } from "./skills.js";

const run = promisify(execFile);

async function main() {
  const url = process.env.DATABASE_URL;
  const tenantId = process.env.TENANT_ID;
  if (!url) throw new Error("DATABASE_URL required");
  if (!tenantId) throw new Error("TENANT_ID required");

  let dir = process.env.SKILLS_DIR;
  let repoPrefix = process.env.SKILLS_REPO_PREFIX;
  if (!dir && process.env.SKILLS_REPO_URL) {
    dir = await mkdtemp(join(tmpdir(), "aos-skills-"));
    console.log(`[sync] cloning ${process.env.SKILLS_REPO_URL} …`);
    await run("git", ["clone", "--depth", "1", process.env.SKILLS_REPO_URL, dir]);
    repoPrefix = repoPrefix ?? new URL(process.env.SKILLS_REPO_URL).pathname.replace(/^\//, "").replace(/\.git$/, "");
  }
  if (!dir) throw new Error("Set SKILLS_DIR or SKILLS_REPO_URL");

  const db = createDb(url);
  const res = await syncSkillsFromDir(db, { tenantId, dir, repoPrefix, source: "github" });
  console.log(`[sync] created=${res.created} updated=${res.updated} unchanged=${res.unchanged}`);
  for (const s of res.skills) console.log(`  ${s.status.padEnd(9)} ${s.key} @ ${s.version}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
