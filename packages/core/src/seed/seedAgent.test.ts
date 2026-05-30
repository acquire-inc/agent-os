// Unit gate for Plan 07-02 (tools as first-class agent bindings).
// Run: DATABASE_URL=... pnpm --filter @agent-os/core run test:seed-tools
//
// Covers (VALIDATION.md task 7-02 → P7-SC1.c/.d/.e):
//   - backward compat: an AgentSpec WITHOUT `tools` still seeds (Pitfall 1)
//   - new binding:      an AgentSpec WITH `tools` creates the tools row + agent_tools join
//   - idempotency:      re-running yields the same tool id and no duplicate join row
//   - Bundle.tools[]:   buildBundle surfaces the agent's bound tools to the runner
//   - public surface:   ensureTool / bindTool importable from "@agent-os/core"
import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import {
  buildBundle,
  ensureTool,
  bindTool,
  inMemorySkillSource,
  seedAgent,
  type AgentSpec,
} from "../index.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// In-memory skill source so seedAgent never touches disk for these synthetic specs.
const SKILL_SOURCE = inMemorySkillSource({});

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required — set it to a Postgres with migrations applied.");
  const db = createDb(url);
  const tenantId = TENANT_IDS.acqu;
  const suffix = Math.random().toString(36).slice(2, 10);

  // Confirm the public surface from @agent-os/core (contract for downstream Plan 07-07).
  console.log("\n[public surface]");
  assert(typeof ensureTool === "function", "ensureTool importable from @agent-os/core");
  assert(typeof bindTool === "function", "bindTool importable from @agent-os/core");

  // ---- (e) backward compat: a spec WITHOUT `tools` still seeds -----------
  console.log("\n[compat: no tools field]");
  const compatSpec: AgentSpec = {
    tenantId,
    key: `test.seed-notools.${suffix}`,
    name: "Test No-Tools Agent",
    systemPrompt: "compat probe",
    model: "nousresearch/hermes-4-70b",
    autonomy: "propose",
    knowledgeScope: { folders: [], tags: [] },
    budgetCapUsd: "0.10",
    skills: [],
    mcpNames: [],
    // NOTE: intentionally no `tools` field — proves the optional `?:` (Pitfall 1).
  };
  const compatResult = await seedAgent(db, compatSpec, { skillSource: SKILL_SOURCE });
  assert(!!compatResult.agent?.id, "spec without tools seeds an agent (no throw)");
  assert(Array.isArray(compatResult.tools) && compatResult.tools.length === 0, "no-tools spec yields empty result.tools[]");

  // ---- (c) new binding: a spec WITH `tools` creates row + join -----------
  console.log("\n[binding: with tools field]");
  const toolKey = `tool.test.7-02.${suffix}`;
  const withToolsSpec: AgentSpec = {
    tenantId,
    key: `test.seed-tools.${suffix}`,
    name: "Test Tools Agent",
    systemPrompt: "tools probe",
    model: "nousresearch/hermes-4-70b",
    autonomy: "propose",
    knowledgeScope: { folders: [], tags: [] },
    budgetCapUsd: "0.10",
    skills: [],
    mcpNames: [],
    tools: [{ key: toolKey, name: "Test Tool" }],
  };
  const r1 = await seedAgent(db, withToolsSpec, { skillSource: SKILL_SOURCE });
  assert(r1.tools.includes(toolKey), "AgentSeedResult.tools contains the bound tool key");

  const [toolRow] = await db
    .select()
    .from(schema.tools)
    .where(and(eq(schema.tools.tenantId, tenantId), eq(schema.tools.key, toolKey)))
    .limit(1);
  assert(!!toolRow, "tools row exists for (tenant, key)");
  assert(toolRow?.requiresApproval === true, "requiresApproval defaults to true (deny-by-default, T-7-07)");
  assert(toolRow?.kind === "custom", "kind defaults to 'custom'");

  const joinRows1 = await db
    .select()
    .from(schema.agentTools)
    .where(and(eq(schema.agentTools.agentId, r1.agent.id), eq(schema.agentTools.toolId, toolRow!.id)));
  assert(joinRows1.length === 1, "agent_tools join row created");

  // ---- (d) idempotency: re-run → same tool id, no duplicate join ---------
  console.log("\n[idempotency: re-run]");
  const r2 = await seedAgent(db, withToolsSpec, { skillSource: SKILL_SOURCE });
  const [toolRow2] = await db
    .select()
    .from(schema.tools)
    .where(and(eq(schema.tools.tenantId, tenantId), eq(schema.tools.key, toolKey)))
    .limit(1);
  assert(toolRow2?.id === toolRow!.id, "re-running seed reuses the same tool id (ensureTool idempotent)");
  assert(r2.agent.id === r1.agent.id, "re-running seed reuses the same agent");

  const joinRows2 = await db
    .select()
    .from(schema.agentTools)
    .where(and(eq(schema.agentTools.agentId, r1.agent.id), eq(schema.agentTools.toolId, toolRow!.id)));
  assert(joinRows2.length === 1, "no duplicate agent_tools join row after re-run (on conflict do nothing)");

  // ---- (c/d) Bundle.tools[] is populated for the seeded agent ------------
  console.log("\n[bundle: tools surfaced]");
  const [run] = await db
    .insert(schema.runs)
    .values({ tenantId, agentId: r1.agent.id, status: "scheduled", triggerSource: "manual", scheduledFor: new Date() })
    .returning();
  const bundle = await buildBundle(db, run!.id, "http://localhost:8787");
  assert(bundle !== null, "buildBundle returns a bundle for the seeded agent");
  assert(Array.isArray(bundle?.tools), "bundle.tools is an array");
  assert(bundle?.tools.length === 1, "bundle.tools has exactly the one bound tool");
  assert(bundle?.tools[0]?.key === toolKey, "bundle.tools[0].key matches the seeded tool");
  assert(bundle?.tools[0]?.requiresApproval === true, "bundle.tools[0] carries the requiresApproval flag");

  // ---- ensureTool standalone idempotency (no agent) ----------------------
  console.log("\n[ensureTool standalone]");
  const soloKey = `tool.solo.7-02.${suffix}`;
  const solo1 = await ensureTool(db, tenantId, { key: soloKey, name: "Solo Tool" });
  const solo2 = await ensureTool(db, tenantId, { key: soloKey, name: "Solo Tool" });
  assert(solo1.id === solo2.id, "ensureTool returns the same row on repeat (idempotent insert)");
  // bindTool idempotency against the compat agent (no prior tool binding there).
  await bindTool(db, compatResult.agent.id, solo1.id);
  await bindTool(db, compatResult.agent.id, solo1.id);
  const soloJoin = await db
    .select()
    .from(schema.agentTools)
    .where(and(eq(schema.agentTools.agentId, compatResult.agent.id), eq(schema.agentTools.toolId, solo1.id)));
  assert(soloJoin.length === 1, "bindTool is idempotent (single join row after double-bind)");

  console.log(`\n[seed-tools] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
