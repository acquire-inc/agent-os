// Pure unit tests for V2 P8 autonomous manager.
// Run: pnpm --filter @agent-os/core test:manager
import {
  DEFAULT_MANAGER_POLICY,
  decideManagerAction,
  planManagerCycle,
  runManagerCycle,
  type AgentFleetSample,
  type ManagerAction,
  type ManagerSink,
} from "./manager.js";

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

const sample = (overrides: Partial<AgentFleetSample> = {}): AgentFleetSample => ({
  agentId: "agent-x",
  agentKey: "ad-ops",
  enabled: true,
  hoursSincePaused: null,
  hoursSinceLastSuccess: 4,
  trailingSuccessRate: 0.9,
  trailingSpendUsd: 12,
  tenantMonthlyBudgetUsd: 1000,
  monthlySpendShare: 0.05,
  isCantFail: false,
  ...overrides,
});

async function main() {
  console.log("\n[decideManagerAction — no-op when healthy]");
  assert(decideManagerAction(sample()).kind === "no_op", "healthy agent → no_op");

  console.log("\n[decideManagerAction — pause on failure streak]");
  {
    const d = decideManagerAction(sample({ trailingSuccessRate: 0.3 }));
    assert(d.kind === "pause", "low success rate → pause");
    assert(/30%/.test(d.rationale), "rationale carries the numbers");
  }
  {
    const d = decideManagerAction(sample({ trailingSuccessRate: null }));
    assert(d.kind === "no_op", "null success rate (no sample) → no_op");
  }

  console.log("\n[decideManagerAction — pause on budget hog]");
  {
    const d = decideManagerAction(sample({ monthlySpendShare: 0.55 }));
    assert(d.kind === "pause", "consuming > 40% of tenant budget → pause");
    assert(/55%/.test(d.rationale), "rationale carries the share");
  }

  console.log("\n[decideManagerAction — cant-fail is operator-only]");
  {
    const d = decideManagerAction(sample({ isCantFail: true, trailingSuccessRate: 0.1 }));
    assert(d.kind === "no_op", "cant-fail never auto-actioned");
    assert(/operator only/.test(d.rationale), "rationale names the rule");
  }

  console.log("\n[decideManagerAction — retire eligible after threshold]");
  {
    const d = decideManagerAction(
      sample({ enabled: false, hoursSincePaused: 24 * 14, hoursSinceLastSuccess: 24 * 30 }),
    );
    assert(d.kind === "retire", "paused 2 weeks + no success 1 month → retire");
  }
  {
    const d = decideManagerAction(
      sample({ enabled: false, hoursSincePaused: 24 * 14, hoursSinceLastSuccess: null }),
    );
    assert(d.kind === "retire", "paused 2 weeks + never succeeded → retire");
  }
  {
    const d = decideManagerAction(
      sample({ enabled: false, hoursSincePaused: 24 * 3, hoursSinceLastSuccess: 24 * 30 }),
    );
    assert(d.kind === "no_op", "paused only 3 days → not yet retire");
  }
  {
    const d = decideManagerAction(
      sample({ enabled: false, hoursSincePaused: 24 * 14, hoursSinceLastSuccess: 24 * 7 }),
    );
    assert(d.kind === "no_op", "succeeded 1 week ago → keep paused, not retire");
  }

  console.log("\n[planManagerCycle — pause prioritized + cap]");
  {
    const fleet = [
      sample({ agentId: "1", trailingSuccessRate: 0.1 }), // pause
      sample({ agentId: "2", trailingSuccessRate: 0.2 }), // pause
      sample({ agentId: "3", trailingSuccessRate: 0.3 }), // pause
      sample({ agentId: "4", trailingSuccessRate: 0.1 }), // would be 4th — cap at 3
      sample({ agentId: "5", enabled: false, hoursSincePaused: 24 * 30, hoursSinceLastSuccess: 24 * 60 }), // retire — but cap full
    ];
    const actions = planManagerCycle(fleet);
    assert(actions.length === 3, "cap enforced");
    assert(actions.every((a) => a.kind === "pause"), "pause-first ordering");
    assert(actions.map((a) => a.agentId).sort().join(",") === "1,2,3", "first 3 by encounter");
  }

  console.log("\n[planManagerCycle — empty + healthy fleets]");
  assert(planManagerCycle([]).length === 0, "empty fleet → no actions");
  assert(planManagerCycle([sample(), sample({ agentId: "2" })]).length === 0, "all healthy → no actions");

  console.log("\n[runManagerCycle — sink wiring]");
  {
    const fleet = [
      sample({ agentId: "1", trailingSuccessRate: 0.2 }),
      sample({ agentId: "2", monthlySpendShare: 0.7 }),
    ];
    const sink = makeSpySink(fleet);
    const r = await runManagerCycle("t-1", sink);
    assert(r.proposals.length === 2, "two actions proposed");
    assert(sink.calls.writes.length === 2, "writeProposal called per action");
    assert(sink.calls.emits.length === 2, "emit fires per action");
    assert(r.tenantId === "t-1", "tenant id flows through");
  }
  {
    const sink = makeSpySink([sample(), sample({ agentId: "2" })]);
    const r = await runManagerCycle("t-1", sink);
    assert(r.proposals.length === 0, "healthy fleet → no proposals");
    assert(sink.calls.writes.length === 0, "no writes");
    assert(sink.calls.emits.length === 0, "no emits");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function makeSpySink(fleet: AgentFleetSample[]): ManagerSink & {
  calls: { writes: ManagerAction[]; emits: Array<{ proposalId: string }> };
} {
  const calls = { writes: [] as ManagerAction[], emits: [] as Array<{ proposalId: string }> };
  let n = 0;
  return {
    calls,
    async loadFleet() {
      return fleet;
    },
    async writeProposal(_tenant, action) {
      calls.writes.push(action);
      n++;
      return `prop-${n}`;
    },
    async emit(input) {
      calls.emits.push({ proposalId: input.proposalId });
    },
  };
}

assert(DEFAULT_MANAGER_POLICY.maxActionsPerCycle === 3, "default cap is 3");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
