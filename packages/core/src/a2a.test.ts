// Pure unit tests for V2 P7 A2A handoff chains.
// Run: pnpm --filter @agent-os/core test:a2a
import {
  composeHandoffContext,
  decideHandoff,
  runHandoff,
  type HandoffDecision,
  type HandoffRequest,
  type HandoffSink,
  type HandoffTargetAgent,
} from "./a2a.js";

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

const req = (overrides: Partial<HandoffRequest> = {}): HandoffRequest => ({
  fromRunId: "r-from",
  fromAgentId: "agent-A",
  fromAgentKey: "lead-triage",
  tenantId: "t-1",
  toAgentKey: "outreach-writer",
  objectiveId: "obj-1",
  summary: "Triaged lead L-1; classified as warm.",
  artifactRefs: ["artifact-classification-1"],
  ...overrides,
});

const target = (overrides: Partial<HandoffTargetAgent> = {}): HandoffTargetAgent => ({
  id: "agent-B",
  key: "outreach-writer",
  tenantId: "t-1",
  enabled: true,
  isCantFail: false,
  ...overrides,
});

async function main() {
  console.log("\n[decideHandoff — happy queue]");
  {
    const d = decideHandoff(req(), target());
    assert(d.action === "queue", "valid handoff → queue");
    assert(d.warning === null, "no warning on normal handoff");
  }

  console.log("\n[decideHandoff — unknown target refused]");
  {
    const d = decideHandoff(req({ toAgentKey: "phantom" }), null);
    assert(d.action === "refuse_unknown", "missing target → refuse_unknown");
    assert(/not found/.test(d.rationale), "rationale names the key");
  }

  console.log("\n[decideHandoff — cross-tenant refused (defense-in-depth)]");
  {
    const d = decideHandoff(req(), target({ tenantId: "t-OTHER" }));
    assert(d.action === "refuse_cross_tenant", "different tenant → refuse_cross_tenant");
    assert(/cross-tenant/.test(d.rationale), "rationale says cross-tenant");
  }

  console.log("\n[decideHandoff — paused target refused (would silently park)]");
  {
    const d = decideHandoff(req(), target({ enabled: false }));
    assert(d.action === "refuse_paused", "paused target → refuse_paused");
    assert(/silently park/.test(d.rationale), "rationale names the silent-park failure mode");
  }

  console.log("\n[decideHandoff — self-handoff queues with a warning]");
  {
    const d = decideHandoff(req(), target({ id: "agent-A", key: "lead-triage" }));
    assert(d.action === "queue", "self-handoff still queues (retry pattern)");
    assert(d.warning !== null && /self-handoff/.test(d.warning), "warning surfaces the loop-bug risk");
  }

  console.log("\n[decideHandoff — handoff to cant-fail is allowed (cant-fail dispatch rules still apply)]");
  {
    const d = decideHandoff(req({ toAgentKey: "ad-claim-compliance" }), target({ key: "ad-claim-compliance", isCantFail: true }));
    assert(d.action === "queue", "cant-fail target queues");
  }

  console.log("\n[composeHandoffContext — receiving bundle shape]");
  {
    const ctx = composeHandoffContext(req());
    assert(/# Handoff from lead-triage/.test(ctx), "block leads with the source agent");
    assert(/## What was just done/.test(ctx), "section: what was done");
    assert(/Triaged lead L-1/.test(ctx), "summary carried");
    assert(/## Artifacts produced/.test(ctx), "artifacts listed when present");
    assert(/artifact-classification-1/.test(ctx), "artifact ref carried");
    assert(/## Your part/.test(ctx), "section: receiving agent's task");
    assert(/Do not redo/.test(ctx), "no-redo guidance present");
  }
  {
    const ctx = composeHandoffContext(req({ artifactRefs: [] }));
    assert(!/## Artifacts produced/.test(ctx), "artifacts section omitted when none");
  }

  console.log("\n[runHandoff — sink wiring + queue path]");
  {
    const sink = makeSpySink({ target: target(), handoffId: "h-1", nextRunId: "r-next" });
    const r = await runHandoff(req(), sink);
    assert(r.decision.action === "queue", "happy path queues");
    assert(r.handoffId === "h-1", "returns handoff id");
    assert(r.nextRunId === "r-next", "returns next run id");
    assert(sink.calls.queued.length === 1, "queueHandoff called once");
    assert(/# Handoff from/.test(sink.calls.queued[0]!.handoffContext), "context piped to sink");
    assert(sink.calls.emitted.length === 1, "decision emitted to relay");
  }

  console.log("\n[runHandoff — refuse paths don't queue, still emit]");
  {
    const sink = makeSpySink({ target: target({ enabled: false }) });
    const r = await runHandoff(req(), sink);
    assert(r.decision.action === "refuse_paused", "paused → refuse_paused");
    assert(sink.calls.queued.length === 0, "no queue on refusal");
    assert(sink.calls.emitted.length === 1, "refusal still emitted for audit trail");
  }
  {
    const sink = makeSpySink({ target: null });
    const r = await runHandoff(req(), sink);
    assert(r.decision.action === "refuse_unknown", "missing target → refuse_unknown");
    assert(sink.calls.queued.length === 0, "no queue");
    assert(sink.calls.emitted.length === 1, "emit fires for unknown target");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

interface SpyState {
  target: HandoffTargetAgent | null;
  handoffId?: string;
  nextRunId?: string;
}

interface QueuedCall {
  handoffContext: string;
}

function makeSpySink(state: SpyState): HandoffSink & {
  calls: { queued: QueuedCall[]; emitted: Array<{ action: HandoffDecision["action"] }> };
} {
  const calls = { queued: [] as QueuedCall[], emitted: [] as Array<{ action: HandoffDecision["action"] }> };
  return {
    calls,
    async resolveTarget() {
      return state.target;
    },
    async queueHandoff(input) {
      calls.queued.push({ handoffContext: input.handoffContext });
      return { handoffId: state.handoffId ?? "h-stub", nextRunId: state.nextRunId ?? "r-stub" };
    },
    async emit(input) {
      calls.emitted.push({ action: input.decision.action });
    },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
