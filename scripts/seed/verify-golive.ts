// scripts/seed/verify-golive.ts — acceptance gate after a go-live seed.
// Confirms the fleet seeded substantially, the safety-critical tables exist, every can't-fail
// agent is PRESENT, and every present can't-fail agent sits at autonomy=propose (the enforced
// ceiling). The pass/fail decision is a pure function (evaluateGoLive) so it's unit-tested
// without a DB; main() just gathers the facts and prints the checklist.
// Usage: DATABASE_URL=... pnpm --filter @agent-os/seed exec tsx verify-golive.ts
import { createDb, schema } from "@agent-os/db";
import { CANT_FAIL_AGENTS, TENANT_IDS } from "@agent-os/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";

// Floors tied to the known-good go-live (93 agents, 63 tools, 12 eval cases). Set conservatively
// BELOW current counts so adding agents never trips them — they exist to catch a half-seeded
// fleet (e.g. a fleet seed that died partway), not to pin an exact number.
export const GOLIVE_FLOORS = { agents: 90, tools: 60, evalCases: 8 } as const;

// Tables a live fleet must have (migrations 0010 metering + 0011 memory). Missing any means an
// incomplete migration — the run loop (burn on done, continuity read) would fail at runtime.
export const REQUIRED_TABLES = ["run_summaries", "usage_events", "credit_ledger", "tenant_credits"] as const;

export interface GoLiveFacts {
  totalAgents: number;
  enabledAgents: number;
  toolCount: number;
  evalCaseCount: number;
  /** can't-fail keys that actually exist in the fleet. */
  presentCantFail: string[];
  /** present can't-fail agents whose autonomy is NOT propose (a ceiling violation). */
  offPropose: { key: string; autonomy: string }[];
  /** table name → exists. */
  tablesPresent: Record<string, boolean>;
  /** tool keys that are irreversible but NOT approval-gated — a safety-gate hole (should be empty). */
  unsafeTools: string[];
  /** can't-fail agents with NO critical eval_case row seeded — not measurable before launch. */
  cantFailWithoutEval: string[];
  /** count of seeded skill rows whose allowed_tools_json is empty (least-privilege not set). */
  skillsMissingAllowedTools: number;
}

export interface GoLiveCheck { name: string; ok: boolean; detail: string }
export interface GoLiveResult { ok: boolean; checks: GoLiveCheck[] }

/**
 * Pure: turn gathered facts into a pass/fail checklist. The safety-critical checks — every
 * can't-fail agent PRESENT, and every present one at propose — are exact; the rest are floors.
 */
export function evaluateGoLive(facts: GoLiveFacts): GoLiveResult {
  const checks: GoLiveCheck[] = [];

  // Safety: a can't-fail agent missing entirely is just as unsafe as one off-propose — the old
  // gate only flagged present-but-off-propose, so a half-seeded fleet could pass. Both fail now.
  const missing = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => !facts.presentCantFail.includes(k));
  checks.push({
    name: "can't-fail agents present",
    ok: missing.length === 0,
    detail: missing.length ? `MISSING: ${missing.join(", ")}` : `all ${CANT_FAIL_AGENTS.length} present`,
  });
  checks.push({
    name: "can't-fail at autonomy=propose",
    ok: facts.offPropose.length === 0,
    detail: facts.offPropose.length ? facts.offPropose.map((v) => `${v.key}=${v.autonomy}`).join(", ") : "none off-propose",
  });

  checks.push({ name: "agent-count floor", ok: facts.totalAgents >= GOLIVE_FLOORS.agents, detail: `${facts.totalAgents} (need ≥${GOLIVE_FLOORS.agents})` });
  checks.push({ name: "enabled agents", ok: facts.enabledAgents > 0, detail: `${facts.enabledAgents} enabled` });
  checks.push({ name: "tool-catalog floor", ok: facts.toolCount >= GOLIVE_FLOORS.tools, detail: `${facts.toolCount} (need ≥${GOLIVE_FLOORS.tools})` });
  checks.push({ name: "eval-case floor", ok: facts.evalCaseCount >= GOLIVE_FLOORS.evalCases, detail: `${facts.evalCaseCount} (need ≥${GOLIVE_FLOORS.evalCases})` });

  for (const t of REQUIRED_TABLES) {
    checks.push({ name: `table ${t}`, ok: facts.tablesPresent[t] === true, detail: facts.tablesPresent[t] ? "present" : "MISSING" });
  }

  // Safety: no tool may be irreversible yet not approval-gated (registry requires_approval is
  // authoritative at the PreToolUse gate). Complements the seed-time validateTool invariant.
  checks.push({
    name: "no irreversible tool ungated",
    ok: facts.unsafeTools.length === 0,
    detail: facts.unsafeTools.length ? `UNGATED: ${facts.unsafeTools.join(", ")}` : "all irreversible tools require approval",
  });

  // Readiness (mirrors readiness.test at the DB level): every can't-fail agent must have a critical
  // eval row actually seeded — manifest-ready isn't the same as actually-seeded.
  checks.push({
    name: "can't-fail eval coverage",
    ok: facts.cantFailWithoutEval.length === 0,
    detail: facts.cantFailWithoutEval.length ? `NO critical eval: ${facts.cantFailWithoutEval.join(", ")}` : "every can't-fail agent has a critical eval",
  });
  // Least-privilege actually persisted on the skill rows.
  checks.push({
    name: "skills carry allowed-tools",
    ok: facts.skillsMissingAllowedTools === 0,
    detail: facts.skillsMissingAllowedTools ? `${facts.skillsMissingAllowedTools} skill(s) missing allowed_tools_json` : "all skills carry allowed-tools",
  });

  return { ok: checks.every((c) => c.ok), checks };
}

async function gatherFacts(db: ReturnType<typeof createDb>, tenantId: string): Promise<GoLiveFacts> {
  const agentRows = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, tenantId));
  const toolRows = await db.select().from(schema.tools).where(eq(schema.tools.tenantId, tenantId));
  const evalRows = await db.select().from(schema.evalCases).where(eq(schema.evalCases.tenantId, tenantId));

  const cantFailRows = await db
    .select({ key: schema.agents.key, autonomy: schema.agents.autonomy })
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, tenantId), inArray(schema.agents.key, CANT_FAIL_AGENTS as unknown as string[])));

  const tablesPresent: Record<string, boolean> = {};
  for (const t of REQUIRED_TABLES) {
    const reg = (await db.execute(sql`select to_regclass(${"public." + t}) as t`)) as unknown as { t: string | null }[];
    tablesPresent[t] = Boolean(reg[0]?.t);
  }

  const unsafeTools = toolRows
    .filter((t) => t.reversible === false && t.requiresApproval === false)
    .map((t) => t.toolKey);

  // can't-fail agents with a critical eval_case row seeded.
  const cantFailCriticalEvals = new Set(
    evalRows.filter((e) => e.severity === "critical" && (CANT_FAIL_AGENTS as readonly string[]).includes(e.agentKey)).map((e) => e.agentKey),
  );
  const cantFailWithoutEval = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => !cantFailCriticalEvals.has(k));

  const skillRows = await db.select({ allowed: schema.skills.allowedToolsJson }).from(schema.skills).where(eq(schema.skills.tenantId, tenantId));
  const skillsMissingAllowedTools = skillRows.filter((s) => !Array.isArray(s.allowed) || (s.allowed as unknown[]).length === 0).length;

  return {
    totalAgents: agentRows.length,
    enabledAgents: agentRows.filter((a) => a.enabled).length,
    toolCount: toolRows.length,
    evalCaseCount: evalRows.length,
    presentCantFail: cantFailRows.map((r) => r.key),
    offPropose: cantFailRows.filter((r) => r.autonomy !== "propose").map((r) => ({ key: r.key, autonomy: r.autonomy })),
    tablesPresent,
    unsafeTools,
    cantFailWithoutEval,
    skillsMissingAllowedTools,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const facts = await gatherFacts(db, TENANT_IDS.acqu);
  const result = evaluateGoLive(facts);

  for (const c of result.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(28)} ${c.detail}`);

  if (!result.ok) {
    console.error("\n✗ Go-live verification failed.");
    process.exit(1);
  }
  console.log("\n✓ Go-live verification passed.");
  process.exit(0);
}

// Only run when invoked directly, so the pure evaluateGoLive can be imported by tests.
const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
