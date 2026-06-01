// seedAgent.cantfail.test.ts — regression lock for AGENT-OS-PLAN.md Open Q #1
// (RESOLVED 2026-06-01): T-critical / can't-fail agents are EXEMPT from
// tenants.default_model_override. Tier wins, override loses.
//
// This is a UNIT test against the override resolution logic in seedAgent.ts.
// No live DB. The companion live-state proof is Gate 2 (pnpm seed:phase-9
// against a tenant with default_model_override='nousresearch/hermes-4-405b' —
// expect the 4 T-critical rows to land on claude-opus-4.8 regardless).
//
// Run: pnpm --filter @agent-os/core run test:cantfail

import { seedAgent, inMemorySkillSource, type AgentSpec } from "../index.js";
import { isCantFail } from "../architect/hydrate.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const SKILL_SOURCE = inMemorySkillSource({});

/** Mock Db that:
 *  - returns the configured tenant row for the tenants select
 *  - records every upsertAgent insert/update value (so we can read the
 *    persisted model)
 *  - no-ops every other table operation (skills/mcps/tools/triggers/jobs)
 */
function mockDb(opts: { defaultModelOverride: string | null }) {
  const captured: { agentModel?: string; agentKey?: string } = {};
  let selectCallIdx = 0;

  const baseSelect = (rows: unknown[]) => {
    const result = Object.assign(Promise.resolve(rows), {
      limit: async () => rows,
    });
    return {
      from: () => ({
        where: () => result,
      }),
    };
  };

  const stubAgent = (values: Record<string, unknown>) => ({
    id: "mock-agent-id",
    tenantId: values.tenantId,
    key: values.key,
    model: values.model,
    autonomy: values.autonomy,
    budgetCapUsd: values.budgetCapUsd,
    name: values.name,
    persona: values.persona,
    backend: values.backend,
    thinkingLevel: values.thinkingLevel,
    knowledgeScopeJson: values.knowledgeScopeJson,
    escalationPolicy: values.escalationPolicy ?? null,
    runnerKind: values.runnerKind ?? "local",
    lifecycleState: values.lifecycleState ?? "active",
    lifecycleChangedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const stubPrompt = () => ({
    id: "mock-prompt-id",
    agentId: "mock-agent-id",
    version: 1,
    body: "x",
    isCurrent: true,
    createdAt: new Date(),
  });

  const stubTrigger = () => ({
    id: "mock-trigger-id",
    agentId: "mock-agent-id",
    kind: "cron",
    schedule: null,
    config: {},
    enabled: true,
    createdAt: new Date(),
  });

  const db = {
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db),
    select: (() => () => {
      const idx = selectCallIdx++;
      // The seedAgent flow (with empty spec.skills/mcpNames/tools) makes select
      // calls in this order:
      //   0: tenant lookup (db.select({defaultModelOverride}).from(tenants))
      //   1: agents lookup inside upsertAgent — we want this to return empty
      //      so upsertAgent takes the insert branch.
      //   2+: subsequent reads (prompts, triggers, etc.) — empty is fine.
      if (idx === 0) {
        return baseSelect([{ defaultModelOverride: opts.defaultModelOverride }]);
      }
      return baseSelect([]);
    })(),
    insert: (table: object) => {
      // Drizzle stores the bare SQL name under Symbol("drizzle:Name").
      const nameSym = Object.getOwnPropertySymbols(table).find(
        (s) => s.toString() === "Symbol(drizzle:Name)",
      );
      const tableName = nameSym
        ? ((table as unknown as Record<symbol, unknown>)[nameSym] as string)
        : "?";
      return {
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            if (tableName === "agents") {
              captured.agentKey = values.key as string;
              captured.agentModel = values.model as string;
              return [stubAgent(values)];
            }
            if (tableName === "agent_prompts") return [stubPrompt()];
            if (tableName === "agent_triggers") return [stubTrigger()];
            if (tableName === "jobs") return [{ id: "mock-job-id", ...values }];
            return [{ id: `mock-${tableName}-id`, ...values }];
          },
          onConflictDoUpdate: () => ({
            returning: async () => {
              if (tableName === "agents") {
                captured.agentKey = values.key as string;
                captured.agentModel = values.model as string;
                return [stubAgent(values)];
              }
              if (tableName === "agent_prompts") return [stubPrompt()];
              return [{ id: `mock-${tableName}-id`, ...values }];
            },
          }),
          onConflictDoNothing: () => ({
            returning: async () => [{ id: `mock-id`, ...values }],
          }),
        }),
      };
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [],
        }),
      }),
    }),
    delete: () => ({
      where: async () => undefined,
    }),
    execute: async () => [] as unknown as never,
  };

  return { db, captured };
}

function buildSpec(overrides: Partial<AgentSpec>): AgentSpec {
  return {
    tenantId: "00000000-0000-0000-0000-000000000001",
    key: "test-agent",
    name: "Test Agent",
    systemPrompt: "x",
    model: "anthropic/claude-opus-4.8",
    autonomy: "execute_safe",
    knowledgeScope: { folders: [], tags: [] },
    budgetCapUsd: "0.50",
    skills: [],
    mcpNames: [],
    ...overrides,
  };
}

async function main() {
  console.log("• isCantFail recognizes the 4 Phase-9 T-critical agents");
  assert(isCantFail("tenant-isolation-tester"), "isCantFail('tenant-isolation-tester')");
  assert(isCantFail("secrets-rotation"), "isCantFail('secrets-rotation')");
  assert(isCantFail("access-auditor"), "isCantFail('access-auditor')");
  assert(isCantFail("security-anomaly-watchdog"), "isCantFail('security-anomaly-watchdog')");

  console.log("• REGRESSION LOCK — T-critical agent under Hermes override stays on Opus");
  // This is the test that proves Open Q #1 RESOLVED at unit scope. Before the
  // exemption shipped, this assertion would fail (effectiveModel = override =
  // hermes-4-405b). After the exemption, the script literal wins.
  const { db: critDb, captured: critCap } = mockDb({
    defaultModelOverride: "nousresearch/hermes-4-405b",
  });
  await seedAgent(
    critDb as unknown as Parameters<typeof seedAgent>[0],
    buildSpec({
      key: "tenant-isolation-tester",
      model: "anthropic/claude-opus-4.8",
    }),
    { skillSource: SKILL_SOURCE },
  );
  assert(
    critCap.agentKey === "tenant-isolation-tester",
    "agents.key insert captured",
  );
  assert(
    critCap.agentModel === "anthropic/claude-opus-4.8",
    `INVARIANT: tenant-isolation-tester persists model=opus despite override (got ${critCap.agentModel})`,
  );

  console.log("• NON-CRITICAL CONTROL — override still applies to non-T-critical agents");
  // The exemption must NOT short-circuit the override globally. Non-critical
  // tiers still rewrite — that's the cost-saver design.
  const { db: normalDb, captured: normalCap } = mockDb({
    defaultModelOverride: "nousresearch/hermes-4-405b",
  });
  await seedAgent(
    normalDb as unknown as Parameters<typeof seedAgent>[0],
    buildSpec({
      key: "vitals",
      model: "nousresearch/hermes-4-70b",
    }),
    { skillSource: SKILL_SOURCE },
  );
  assert(
    normalCap.agentKey === "vitals",
    "non-critical agents.key insert captured",
  );
  assert(
    normalCap.agentModel === "nousresearch/hermes-4-405b",
    `non-critical agent rewrites to override (got ${normalCap.agentModel})`,
  );

  console.log("• NO OVERRIDE — script literal wins on both critical and non-critical");
  const { db: noOverrideCritDb, captured: noOverrideCritCap } = mockDb({
    defaultModelOverride: null,
  });
  await seedAgent(
    noOverrideCritDb as unknown as Parameters<typeof seedAgent>[0],
    buildSpec({
      key: "secrets-rotation",
      model: "anthropic/claude-opus-4.8",
    }),
    { skillSource: SKILL_SOURCE },
  );
  assert(
    noOverrideCritCap.agentModel === "anthropic/claude-opus-4.8",
    "no override + T-critical → opus literal",
  );

  const { db: noOverrideNormalDb, captured: noOverrideNormalCap } = mockDb({
    defaultModelOverride: null,
  });
  await seedAgent(
    noOverrideNormalDb as unknown as Parameters<typeof seedAgent>[0],
    buildSpec({
      key: "briefing",
      model: "nousresearch/hermes-4-70b",
    }),
    { skillSource: SKILL_SOURCE },
  );
  assert(
    noOverrideNormalCap.agentModel === "nousresearch/hermes-4-70b",
    "no override + non-critical → hermes literal",
  );

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
