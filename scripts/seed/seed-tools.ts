// scripts/seed/seed-tools.ts
// Phase 6 (06-02): seed the tool registry and bind agents — both DERIVED from the seeded
// agent prompts (which carry the doctrine's `Tools:` refs). No hand-mapping: the catalog is
// the set of tools agents actually reference (+ universal infra), and each agent is bound to
// exactly the tools its prompt declares. Idempotent (upsert + setTools prune-then-add).

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import { setTools, TENANT_ID } from "./_shared.js";
import {
  KNOWN_TOOLS,
  UNIVERSAL_TOOLS,
  extractSingleToolKeys,
  extractToolKeys,
  toolMeta,
} from "./_tools.js";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  // Current prompt per agent.
  const rows = await db
    .select({ agentId: schema.agents.id, key: schema.agents.key, prompt: schema.agentPrompts.systemPrompt })
    .from(schema.agents)
    .innerJoin(schema.agentPrompts, and(eq(schema.agentPrompts.agentId, schema.agents.id), eq(schema.agentPrompts.isCurrent, true)))
    .where(eq(schema.agents.tenantId, TENANT_ID));

  // Pass 1 — the trustworthy numbered universe: numbered slots EXPLICITLY referenced
  // anywhere, plus those we have metadata for. Ranges expand only into this set.
  const validNumbered = new Set<string>(Object.keys(KNOWN_TOOLS).filter((k) => /^tool\.\d+$/.test(k)));
  for (const r of rows) for (const k of extractSingleToolKeys(r.prompt)) if (/^tool\.\d+$/.test(k)) validNumbered.add(k);

  // Pass 2 — per-agent declared tools (singles + filtered ranges + universal infra).
  const perAgent = new Map<string, { key: string; toolKeys: string[] }>();
  const catalog = new Set<string>(UNIVERSAL_TOOLS);
  for (const r of rows) {
    const declared = new Set<string>([...extractToolKeys(r.prompt, validNumbered), ...UNIVERSAL_TOOLS]);
    perAgent.set(r.agentId, { key: r.key, toolKeys: [...declared] });
    for (const k of declared) catalog.add(k);
  }

  // ── Seed the catalog (upsert by tenant+tool_key) ──
  const idByKey = new Map<string, string>();
  for (const toolKey of [...catalog].sort()) {
    const meta = toolMeta(toolKey);
    const [existing] = await db
      .select({ id: schema.tools.id })
      .from(schema.tools)
      .where(and(eq(schema.tools.tenantId, TENANT_ID), eq(schema.tools.toolKey, toolKey)));
    if (existing) {
      await db.update(schema.tools)
        .set({ name: meta.name, description: meta.description, kind: meta.kind, requiresApproval: meta.requiresApproval, reversible: meta.reversible, status: "active" })
        .where(eq(schema.tools.id, existing.id));
      idByKey.set(toolKey, existing.id);
    } else {
      const [ins] = await db.insert(schema.tools)
        .values({ tenantId: TENANT_ID, toolKey, name: meta.name, description: meta.description, kind: meta.kind, requiresApproval: meta.requiresApproval, reversible: meta.reversible, status: "active" })
        .returning({ id: schema.tools.id });
      idByKey.set(toolKey, ins!.id);
    }
  }

  // ── Bind each agent to exactly its declared tools ──
  let totalBindings = 0;
  for (const [agentId, { toolKeys }] of perAgent) {
    const toolIds = toolKeys.map((k) => idByKey.get(k)!).filter(Boolean);
    await setTools(db, agentId, toolIds);
    totalBindings += toolIds.length;
  }

  // ── Verify ──
  const kinds = await db.select().from(schema.tools).where(eq(schema.tools.tenantId, TENANT_ID));
  const mcpCount = kinds.filter((t) => t.kind === "mcp").length;
  const approvalCount = kinds.filter((t) => t.requiresApproval).length;
  const dbBindings = (await db.execute(
    `select count(*)::int as n from agent_tools l join agents a on a.id = l.agent_id where a.tenant_id = '${TENANT_ID}'`,
  )) as unknown as { n: number }[];

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("TOOL REGISTRY SUMMARY");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`  Catalog tools seeded:        ${kinds.length}  (mcp: ${mcpCount}, requires_approval: ${approvalCount})`);
  console.log(`  Agents bound:                ${perAgent.size}`);
  console.log(`  agent→tool bindings written: ${totalBindings}  (in DB: ${dbBindings[0]?.n})`);

  // Spot-check: a representative agent's resolved tools, and a high-value tool's consumers.
  for (const probeKey of ["ad-ops", "contract-drafter"]) {
    const probe = [...perAgent.values()].find((a) => a.key === probeKey);
    if (probe) console.log(`  ${probeKey} → ${probe.toolKeys.sort().join(", ")}`);
  }
  const launcherConsumers = (await db.execute(
    `select a.key from agent_tools l join agents a on a.id=l.agent_id join tools t on t.id=l.tool_id where t.tool_key='tool.2' and a.tenant_id='${TENANT_ID}' order by a.key`,
  )) as unknown as { key: string }[];
  console.log(`  tool.2 (Ad Launcher, gated) consumers: ${launcherConsumers.map((r) => r.key).join(", ") || "none"}`);

  if (dbBindings[0]?.n !== totalBindings) { console.error("\n✗ Binding count mismatch."); process.exit(1); }
  console.log("\n✓ Tool registry seeded and verified.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
