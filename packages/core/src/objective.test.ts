// Pure unit tests for the objective-driven reflexion retry loop (no DB required).
// Run: pnpm --filter @agent-os/core test:objective
import {
  composeReflexionContext,
  decideReflexion,
  DEFAULT_REFLEXION_CONFIG,
  runReflexion,
  type AttemptOutcome,
  type Objective,
  type ReflexionDecision,
  type ReflexionSink,
} from "./objective.js";

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

const obj = (overrides: Partial<Objective> = {}): Objective => ({
  id: "obj-1",
  tenantId: "t-1",
  agentId: "a-1",
  title: "Close out Q3 ad-spend audit",
  description: "Reconcile platform spend with general ledger.",
  status: "active",
  maxAttempts: 3,
  ...overrides,
});

const attempt = (n: number, status: AttemptOutcome["status"], verifierOk: boolean | null = null, summary = ""): AttemptOutcome => ({
  attemptNumber: n,
  status,
  verificationPassed: verifierOk,
  summary: summary || `attempt ${n} did some things`,
});

async function main() {
  console.log("\n[decideReflexion — success path]");
  {
    const d = decideReflexion(obj(), [attempt(1, "done", true)]);
    assert(d.action === "complete", "done + verifier passed → complete");
    assert(d.nextAttemptNumber === null, "complete has no nextAttemptNumber");
  }
  {
    // Verification not run (null) is treated as ok — the verifier wasn't part
    // of this objective's flow.
    const d = decideReflexion(obj(), [attempt(1, "done", null)]);
    assert(d.action === "complete", "done + verifier null → complete");
  }
  {
    // Verification ran and failed: NOT complete, even if lifecycle status says done.
    const d = decideReflexion(obj(), [attempt(1, "done", false)]);
    assert(d.action === "retry", "done + verifier FAILED → retry (not complete)");
  }

  console.log("\n[decideReflexion — retry under cap]");
  {
    const d = decideReflexion(obj({ maxAttempts: 3 }), [attempt(1, "failed", false)]);
    assert(d.action === "retry", "1 failed of 3 → retry");
    assert(d.nextAttemptNumber === 2, "next attempt is 2 (1-indexed)");
  }
  {
    const d = decideReflexion(obj({ maxAttempts: 3 }), [attempt(1, "failed", false), attempt(2, "failed", false)]);
    assert(d.action === "retry", "2 failed of 3 → retry");
    assert(d.nextAttemptNumber === 3, "next attempt is 3");
  }

  console.log("\n[decideReflexion — abandon at cap]");
  {
    const d = decideReflexion(obj({ maxAttempts: 3 }), [attempt(1, "failed"), attempt(2, "failed"), attempt(3, "failed")]);
    assert(d.action === "abandon", "3 failed of 3 → abandon (cap hit)");
    assert(d.nextAttemptNumber === null, "abandon has no nextAttemptNumber");
    assert(/max_attempts/.test(d.rationale), "rationale names the cap");
  }
  {
    // Cap respected even if it's lower than DEFAULT_REFLEXION_CONFIG.
    const d = decideReflexion(obj({ maxAttempts: 1 }), [attempt(1, "failed")]);
    assert(d.action === "abandon", "1/1 with cap=1 → abandon immediately");
  }

  console.log("\n[decideReflexion — default cap when maxAttempts unset]");
  {
    // maxAttempts <= 0 falls back to DEFAULT_REFLEXION_CONFIG.defaultMaxAttempts.
    const d = decideReflexion(obj({ maxAttempts: 0 }), [attempt(1, "failed")]);
    assert(d.action === "retry", "maxAttempts=0 falls back to default config (3)");
    assert(d.nextAttemptNumber === 2, "next attempt is 2 under the default cap");
  }

  console.log("\n[decideReflexion — terminal objective is a no-op]");
  {
    const d = decideReflexion(obj({ status: "completed" }), [attempt(1, "done", true)]);
    assert(d.action === "abandon", "already completed → abandon (no further work)");
    assert(/already completed/.test(d.rationale), "rationale explains terminal state");
  }
  {
    const d = decideReflexion(obj({ status: "abandoned" }), [attempt(1, "failed")]);
    assert(d.action === "abandon", "already abandoned → abandon");
  }

  console.log("\n[decideReflexion — empty attempts safeguard]");
  {
    const d = decideReflexion(obj(), []);
    assert(d.action === "abandon", "0 attempts → abandon (nothing to reflex against)");
  }

  console.log("\n[composeReflexionContext — bundle injection shape]");
  {
    const ctx = composeReflexionContext(obj({ title: "Reconcile ads → GL" }), [
      attempt(1, "failed", false, "Pulled Meta spend; failed to join on campaign_id (missing GL mapping)."),
    ]);
    assert(/# Objective: Reconcile ads → GL/.test(ctx), "block leads with objective title");
    assert(/## Prior attempts/.test(ctx), "block lists prior attempts");
    assert(/Attempt 1 — failed/.test(ctx), "attempt 1 appears with status");
    assert(/verification: failed/.test(ctx), "verifier outcome is surfaced");
    assert(/attempt 2/.test(ctx), "next-attempt advice references attempt 2");
    assert(/Do not repeat the steps/.test(ctx), "carryover includes do-not-repeat guidance");
  }
  {
    // Empty attempts → empty string (don't bloat the bundle with a useless header).
    assert(composeReflexionContext(obj(), []) === "", "no attempts → empty context");
  }

  console.log("\n[runReflexion — sink wiring + complete]");
  {
    const sink = makeSpySink({
      objective: obj(),
      attempts: [attempt(1, "done", true)],
    });
    const r = await runReflexion("obj-1", sink);
    assert(r != null, "runReflexion returns a result when objective exists");
    assert(r!.decision.action === "complete", "success attempt → decision.action complete");
    assert(r!.followupRunId === null, "no follow-up run on complete");
    assert(sink.calls.setStatus.length === 1, "setObjectiveStatus called once");
    assert(sink.calls.setStatus[0]![1] === "completed", "setObjectiveStatus marks completed");
    assert(sink.calls.queue.length === 0, "no follow-up queue on complete");
    assert(sink.calls.emit.length === 1, "decision emitted to relay");
    assert(sink.calls.emit[0]!.followupRunId === null, "emit carries null followupRunId on complete");
  }

  console.log("\n[runReflexion — sink wiring + retry queues follow-up + emits]");
  {
    const sink = makeSpySink({
      objective: obj({ maxAttempts: 3 }),
      attempts: [attempt(1, "failed", false, "GL join failed")],
      followupRunId: "run-followup-7",
    });
    const r = await runReflexion("obj-1", sink);
    assert(r!.decision.action === "retry", "failed attempt under cap → retry");
    assert(r!.followupRunId === "run-followup-7", "runner returns the new run id");
    assert(sink.calls.queue.length === 1, "queueFollowupRun called once");
    assert(sink.calls.queue[0]!.nextAttemptNumber === 2, "queued with attempt_number=2");
    assert(/# Objective:/.test(sink.calls.queue[0]!.reflexionContext), "queued with composed reflexion context");
    assert(sink.calls.setStatus.length === 0, "status NOT changed on retry");
    assert(sink.calls.emit[0]!.followupRunId === "run-followup-7", "emit carries the new run id");
  }

  console.log("\n[runReflexion — abandon at cap doesn't queue, marks abandoned]");
  {
    const sink = makeSpySink({
      objective: obj({ maxAttempts: 2 }),
      attempts: [attempt(1, "failed"), attempt(2, "failed")],
    });
    const r = await runReflexion("obj-1", sink);
    assert(r!.decision.action === "abandon", "2/2 failed → abandon");
    assert(sink.calls.queue.length === 0, "no follow-up queued on abandon");
    assert(sink.calls.setStatus[0]![1] === "abandoned", "objective marked abandoned");
    assert(sink.calls.emit.length === 1, "abandon still emits a decision");
  }

  console.log("\n[runReflexion — unknown objective is a no-op]");
  {
    const sink = makeSpySink({ objective: null, attempts: [] });
    const r = await runReflexion("obj-missing", sink);
    assert(r === null, "missing objective → null (no decision)");
    assert(sink.calls.emit.length === 0, "no emit when objective missing");
    assert(sink.calls.queue.length === 0, "no queue when objective missing");
  }

  console.log("\n[default config sanity]");
  assert(DEFAULT_REFLEXION_CONFIG.defaultMaxAttempts === 3, "default cap is 3");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

interface SpySinkState {
  objective: Objective | null;
  attempts: AttemptOutcome[];
  followupRunId?: string;
}

interface SpyCalls {
  setStatus: Array<[string, "completed" | "abandoned"]>;
  queue: Array<{ objectiveId: string; nextAttemptNumber: number; reflexionContext: string }>;
  emit: Array<{ objectiveId: string; action: ReflexionDecision["action"]; followupRunId: string | null }>;
}

function makeSpySink(state: SpySinkState): ReflexionSink & { calls: SpyCalls } {
  const calls: SpyCalls = { setStatus: [], queue: [], emit: [] };
  const sink: ReflexionSink & { calls: SpyCalls } = {
    calls,
    async loadObjective(id) {
      return state.objective && state.objective.id === id ? state.objective : null;
    },
    async loadAttempts() {
      return state.attempts;
    },
    async setObjectiveStatus(id, status) {
      calls.setStatus.push([id, status]);
    },
    async queueFollowupRun(input) {
      calls.queue.push({
        objectiveId: input.objective.id,
        nextAttemptNumber: input.nextAttemptNumber,
        reflexionContext: input.reflexionContext,
      });
      return state.followupRunId ?? "run-stub";
    },
    async emitDecision(input) {
      calls.emit.push({
        objectiveId: input.objective.id,
        action: input.decision.action,
        followupRunId: input.followupRunId,
      });
    },
  };
  return sink;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
