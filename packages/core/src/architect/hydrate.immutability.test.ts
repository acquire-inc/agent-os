// Pin AgentOS can't-fail safety invariants:
//   1. CANT_FAIL_KEYS membership is exactly the 14 doctrine keys.
//   2. hydrate() refuses to assemble ANY can't-fail blueprint.
//   3. WR-06: blueprint.key passes through hydrate() byte-for-byte.
//      The runtime can't-fail gate (apps/runner/src/execute.ts:assertCantFailModel)
//      reads bundle.agent.key — silent key rewrites here would bypass it.
// Run: pnpm --filter @agent-os/core test:immutability

import { hydrate, isCantFail, type ResolverContext } from "./hydrate.js";
import type { TeamBlueprintProposal } from "./types.js";

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

const TENANT = "11111111-1111-1111-1111-111111111111";

// WR-06 pin: if CANT_FAIL_KEYS in hydrate.ts grows or shrinks, update this list
// explicitly. AgentOS scope only — cliently.dev intentionally excluded (Cliently
// product track owns that doctrine).
const EXPECTED_CANT_FAIL = [
  "ad-claim-compliance",
  "tenant-isolation-tester",
  "security-anomaly-watchdog",
  "access-auditor",
  "secrets-rotation",
  "contract-drafter",
  "contract-lifecycle-manager",
  "pricing-architect",
  "discount-governor",
  "decision-memo-drafter",
  "offer-architect",
  "offer-validator",
  "reinvestment-advisor",
  "risk-register-keeper",
];

function makeBlueprint(key: string) {
  return {
    key,
    name: "Test Agent",
    role: "Test role.",
    systemPrompt: "You are a test agent.",
    model: "nousresearch/hermes-4-70b",
    thinkingLevel: "low" as const,
    autonomy: "propose" as const,
    knowledgeScope: { folders: ["test"], tags: [] },
    budgetCapUsd: "0.10",
    cron: { schedule: "0 9 * * *", jobName: "Test cron" },
    skillKeys: [],
    mcpNames: [],
  };
}

function makeProposal(key: string): TeamBlueprintProposal {
  return {
    teamName: "Test Team",
    rationale: "Single-agent proposal for testing.",
    agents: [makeBlueprint(key)],
    proposedSkills: [],
    proposedMcps: [],
  };
}

function emptyCtx(): ResolverContext {
  return { knownSkillKeys: new Set<string>(), knownMcpNames: new Set<string>() };
}

async function main() {
  console.log("• Group 1 — CANT_FAIL_KEYS membership is the 14 doctrine keys");
  for (const key of EXPECTED_CANT_FAIL) {
    assert(isCantFail(key) === true, `${key} is can't-fail`);
  }
  assert(
    isCantFail("definitely-not-cant-fail-monitor") === false,
    "non-listed key is NOT can't-fail (predicate isn't degenerately true)",
  );
  assert(
    isCantFail("cliently.dev") === false,
    "cliently.dev is NOT in AgentOS can't-fail set (out of AgentOS scope)",
  );

  console.log("\n• Group 2 — hydrate() refuses every can't-fail key");
  for (const key of EXPECTED_CANT_FAIL) {
    const out = hydrate(TENANT, makeProposal(key), emptyCtx());
    assert(out.agents.length === 0, `hydrate refused ${key} (no agents emitted)`);
    assert(
      out.warnings.some((w) => w.includes(key)),
      `warning mentions refused key ${key}`,
    );
    assert(
      out.warnings.some((w) => w.includes("can't-fail")),
      `warning labels refusal as can't-fail for ${key}`,
    );
  }

  console.log("\n• Group 3 — WR-06 immutability: blueprint.key passes through verbatim");
  const inKey = "monitor-ad-pacing";
  const out = hydrate(TENANT, makeProposal(inKey), emptyCtx());
  assert(out.agents.length === 1, "non-can't-fail blueprint hydrates to one spec");
  assert(
    out.agents[0]?.key === inKey,
    "key passes through byte-for-byte — no titleize, no normalize, no rewrite",
  );
  assert(
    out.agents[0]?.autonomy === "propose",
    "autonomy clamped to propose floor (existing invariant still holds)",
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("unexpected:", e);
  process.exit(1);
});
