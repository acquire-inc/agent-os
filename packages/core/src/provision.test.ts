// Tenant provisioning (template cloning) test.
// Run: DATABASE_URL=... pnpm --filter @agent-os/core exec tsx src/provision.test.ts
import { createDb, schema } from "@agent-os/db";
import { DEMO_USER_ID, TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import { provisionClientTenant } from "./provision.js";

let passed = 0,
  failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}

async function count(db: ReturnType<typeof createDb>, table: typeof schema.agents | typeof schema.jobs | typeof schema.skills | typeof schema.mcps | typeof schema.projects, tenantId: string) {
  return (await db.select().from(table).where(eq(table.tenantId, tenantId))).length;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDb(url);
  const src = TENANT_IDS.acqu;

  const slug = `client-${Date.now()}`;
  console.log("\n[provision client tenant from Acqu template]");
  const srcAgents = await count(db, schema.agents, src);
  const srcJobs = await count(db, schema.jobs, src);
  const srcSkills = await count(db, schema.skills, src);
  const srcMcps = await count(db, schema.mcps, src);
  const srcProjects = await count(db, schema.projects, src);

  const res = await provisionClientTenant(db, { name: "Test Client", slug, templateTenantId: src, ownerUserId: DEMO_USER_ID, monthlyBudgetUsd: 500 });
  const t = res.tenantId;

  assert(res.counts.agents === srcAgents, `cloned all agents (${res.counts.agents}/${srcAgents})`);
  assert(res.counts.jobs === srcJobs, `cloned all jobs (${res.counts.jobs}/${srcJobs})`);
  assert(res.counts.skills === srcSkills, `cloned all skills (${res.counts.skills}/${srcSkills})`);
  assert(res.counts.mcps === srcMcps, `cloned all MCPs (${res.counts.mcps}/${srcMcps})`);
  assert(res.counts.projects === srcProjects, `cloned all projects (${res.counts.projects}/${srcProjects})`);

  console.log("\n[isolation + clean start]");
  const [newTenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t));
  assert(newTenant?.type === "client", "new tenant is type 'client'");
  const member = await db.select().from(schema.tenantMembers).where(and(eq(schema.tenantMembers.tenantId, t), eq(schema.tenantMembers.userId, DEMO_USER_ID)));
  assert(member.length === 1 && member[0]?.role === "owner", "owner added as member");
  const runs = await db.select().from(schema.runs).where(eq(schema.runs.tenantId, t));
  assert(runs.length === 0, "no runs copied (client starts clean)");
  const clonedMcps = await db.select().from(schema.mcps).where(eq(schema.mcps.tenantId, t));
  assert(clonedMcps.every((m) => m.status === "disconnected"), "cloned MCPs start disconnected (client connects own accounts)");

  console.log("\n[references remapped, not shared]");
  const [anAgent] = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, t)).limit(1);
  const links = await db.select().from(schema.agentSkills).where(eq(schema.agentSkills.agentId, anAgent!.id));
  // Every linked skill id must belong to the NEW tenant, never the template.
  let allLocal = true;
  for (const l of links) {
    const [sk] = await db.select().from(schema.skills).where(eq(schema.skills.id, l.skillId));
    if (!sk || sk.tenantId !== t) allLocal = false;
  }
  assert(allLocal, "agent_skills point at the new tenant's skills (no cross-tenant leakage)");

  // Cleanup.
  await db.delete(schema.tenants).where(eq(schema.tenants.id, t));

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
