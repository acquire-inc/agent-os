// Phase 52 tests: sub-agent SDK dispatch.
//
// Run: pnpm --filter @agent-os/runner test:sub-agent

import { dispatchSubAgent, type SubAgentSdkLike } from "./sub-agent.js";
import { getBudgetTracker, resetBudgetTrackerForTests } from "./budget.js";
import type { Bundle } from "./api-client.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function makeBundle(runId: string): Bundle {
  return {
    run: { id: runId, status: "running", triggerSource: "test", scheduledFor: null, sdkSessionId: null },
    job: null,
    agent: {
      id: "agent-1", tenantId: "tenant-1", key: "parent-agent", name: "Parent Agent",
      persona: null, backend: "claude-agent-sdk", model: "nousresearch/hermes-4-70b",
      thinkingLevel: "low", autonomy: "execute_safe",
      escalationPolicy: null, budgetCapUsd: 2.0, runnerKind: "local",
    },
    skills: [], mcpServers: [], tools: [], knowledge: [], envVars: {},
    autonomy: "execute_safe",
    api: { statusUrl: "", activityUrl: "", approvalsUrl: "", validStatuses: [] },
  };
}

/** Stub SDK that yields a single `result` message with a known cost. */
function makeStubSdk(opts: { result: string; costUsd: number; capturedModel?: { slug?: string }; delayMs?: number; throwError?: boolean }): SubAgentSdkLike {
  return {
    async *query(args) {
      if (opts.capturedModel) {
        opts.capturedModel.slug = (args.options?.model as string | undefined) ?? undefined;
      }
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throwError) throw new Error("stub sdk thrown");
      yield { type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } };
      yield {
        type: "result",
        result: opts.result,
        total_cost_usd: opts.costUsd,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "stub-session",
      };
    },
  };
}

async function main() {
  console.log("• Group 1 — happy path: sub-agent dispatches on the picked model");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("sub-A", 2.0);
    const captured: { slug?: string } = {};
    const sdk = makeStubSdk({ result: "sub answer here", costUsd: 0.03, capturedModel: captured });

    const r = await dispatchSubAgent({
      bundle: makeBundle("sub-A"),
      modelSlug: "anthropic/claude-sonnet-4.6",
      prompt: "Summarize this paragraph: ...",
      taskLabel: "skill:briefing-synthesis",
      costEstimateUsd: 0.05,
      sdkOverride: sdk,
    });

    assert(r.ok === true, "result.ok = true");
    assert(r.result === "sub answer here", "result.result captured");
    assert(r.costUsd === 0.03, "result.costUsd captured");
    assert(r.tokensIn === 100 && r.tokensOut === 50, "tokens captured");
    assert(r.modelRan === "anthropic/claude-sonnet-4.6", "modelRan echoes the picked model");
    assert(captured.slug === "anthropic/claude-sonnet-4.6", "stub SDK saw the picked model in options");
    // Reservation committed -> reservedTotal 0, committedTotal 0.03
    const snap = tracker.snapshot("sub-A");
    assert(snap?.reservedTotal === 0, "reservation cleared after commit");
    assert(Math.abs((snap?.committedTotal ?? 0) - 0.03) < 1e-9, `committed = 0.03 (got ${snap?.committedTotal})`);
  }

  console.log("\n• Group 2 — cap breach refuses sub-agent dispatch");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("sub-B", 0.1);
    const sdk = makeStubSdk({ result: "ignored", costUsd: 0.05 });

    const r = await dispatchSubAgent({
      bundle: makeBundle("sub-B"),
      modelSlug: "anthropic/claude-sonnet-4.6",
      prompt: "x",
      taskLabel: "skill:expensive",
      costEstimateUsd: 0.5, // would breach cap=0.1
      sdkOverride: sdk,
    });

    assert(r.ok === false, "sub-agent refused on cap breach");
    assert(r.error?.includes("would_breach_cap") || r.error?.includes("reserve refused"), `error mentions breach (got: ${r.error})`);
    assert(r.result === "", "no result");
  }

  console.log("\n• Group 3 — timeout terminates dispatch and releases reservation");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("sub-C", 2.0);
    // SDK takes 200ms; timeout is 50ms.
    const sdk = makeStubSdk({ result: "would have answered", costUsd: 0.04, delayMs: 200 });

    const r = await dispatchSubAgent({
      bundle: makeBundle("sub-C"),
      modelSlug: "anthropic/claude-sonnet-4.6",
      prompt: "x",
      taskLabel: "skill:slow",
      costEstimateUsd: 0.05,
      timeoutMs: 50,
      sdkOverride: sdk,
    });

    assert(r.ok === false, "timeout marks ok=false");
    assert(r.error?.includes("timeout") || r.error?.includes("30000") || r.error?.includes("50ms") || r.error?.includes("50"),
      `error mentions timeout (got: ${r.error})`);
    const snap = tracker.snapshot("sub-C");
    assert(snap?.reservedTotal === 0, "reservation cleared on timeout");
    assert(snap?.releasedTotal === 0.05, "0.05 released (no commit on timeout)");
  }

  console.log("\n• Group 4 — sdk exception releases reservation");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("sub-D", 2.0);
    const sdk = makeStubSdk({ result: "n/a", costUsd: 0, throwError: true });

    const r = await dispatchSubAgent({
      bundle: makeBundle("sub-D"),
      modelSlug: "anthropic/claude-sonnet-4.6",
      prompt: "x",
      taskLabel: "skill:broken",
      costEstimateUsd: 0.04,
      sdkOverride: sdk,
    });

    assert(r.ok === false, "sdk error marks ok=false");
    assert(r.error?.includes("stub sdk thrown"), `error message captured (got: ${r.error})`);
    const snap = tracker.snapshot("sub-D");
    assert(snap?.releasedTotal === 0.04, "0.04 released on SDK throw");
    assert(snap?.committedTotal === 0, "no commit on SDK throw");
  }

  console.log("\n• Group 5 — no tracker open: dispatch still works, no reserve");
  {
    resetBudgetTrackerForTests();
    const sdk = makeStubSdk({ result: "ok", costUsd: 0.01 });
    const r = await dispatchSubAgent({
      bundle: makeBundle("sub-no-tracker"),
      modelSlug: "anthropic/claude-sonnet-4.6",
      prompt: "x",
      taskLabel: "skill:no-tracker",
      costEstimateUsd: 0.05,
      sdkOverride: sdk,
    });
    assert(r.ok === true, "no-tracker mode still completes");
    assert(r.reservationId === null, "no reservationId when tracker has no open run");
  }

  console.log("\n• Group 6 — zero estimate skips reserve cleanly");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("sub-E", 2.0);
    const sdk = makeStubSdk({ result: "ok", costUsd: 0.005 });
    const r = await dispatchSubAgent({
      bundle: makeBundle("sub-E"),
      modelSlug: "anthropic/claude-haiku-4-5",
      prompt: "x",
      taskLabel: "skill:free-classify",
      costEstimateUsd: 0,
      sdkOverride: sdk,
    });
    assert(r.ok === true, "zero-estimate path completes");
    assert(r.reservationId === null, "no reservation when estimate is 0");
    const snap = tracker.snapshot("sub-E");
    assert(snap?.committedTotal === 0, "no committed for zero-reserve path (commit only happens on reserved)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
