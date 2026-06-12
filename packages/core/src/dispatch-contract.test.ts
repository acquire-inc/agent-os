// Pure unit tests for the dispatch/results contract twin (I-002).
// Run: pnpm --filter @agent-os/core test:dispatch-contract
import { RUN_STATUSES, type RunStatus } from "@agent-os/shared";
import {
  RUN_CLAIMABLE_STATUSES,
  RUN_IN_FLIGHT_STATUSES,
  RUN_TERMINAL_STATUSES,
  RUN_WAITING_STATUSES,
  isClaimableStatus,
  isInFlightStatus,
  isTerminalStatus,
  isWaitingStatus,
  nextValidStatuses,
  orderClaimQueue,
  validateApprovalCycle,
  validateBundleShape,
  validateSessionEndInvariant,
  validateToolsRegistry,
  validRunTransition,
} from "./dispatch-contract.js";

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

const goodBundle = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  run: { id: "r1", status: "running", triggerSource: "manual", scheduledFor: null, sdkSessionId: null },
  job: null,
  agent: {
    id: "a1",
    tenantId: "t1",
    key: "ad-ops",
    name: "Ad Ops",
    persona: null,
    backend: "claude-agent-sdk",
    model: "claude-sonnet-4.6",
    thinkingLevel: "medium",
    autonomy: "propose",
    escalationPolicy: null,
    budgetCapUsd: 1.0,
    runnerKind: "local",
  },
  docs: [],
  skills: [],
  mcpServers: [],
  tools: [],
  knowledge: [],
  priorLearnings: [],
  envVars: {},
  autonomy: "propose",
  escalationPolicy: null,
  budgetCapUsd: 1.0,
  knowledgeScope: { folders: [], tags: [] },
  api: {
    statusUrl: "https://api.example.com/api/runs/r1/status",
    activityUrl: "https://api.example.com/api/runs/r1/activity",
    approvalsUrl: "https://api.example.com/api/runs/r1/approvals",
    validStatuses: [...RUN_STATUSES],
  },
  ...overrides,
});

async function main() {
  console.log("\n[partitions — every RUN_STATUS belongs to exactly one]");
  {
    // Exhaustiveness guard catches drift at typecheck; here we verify at runtime too.
    const all = new Set<string>(RUN_STATUSES);
    const covered = new Set<string>([
      ...RUN_TERMINAL_STATUSES,
      ...RUN_IN_FLIGHT_STATUSES,
      ...RUN_WAITING_STATUSES,
      ...RUN_CLAIMABLE_STATUSES,
    ]);
    assert(covered.size === all.size, "partitions cover every RUN_STATUSES value (no drift)");
    let overlaps = 0;
    const partitions = [RUN_TERMINAL_STATUSES, RUN_IN_FLIGHT_STATUSES, RUN_WAITING_STATUSES, RUN_CLAIMABLE_STATUSES];
    for (const s of RUN_STATUSES) {
      const hits = partitions.filter((p) => (p as readonly string[]).includes(s)).length;
      if (hits !== 1) overlaps++;
    }
    assert(overlaps === 0, "no status belongs to more than one partition");
  }
  {
    assert(isTerminalStatus("done") && isTerminalStatus("failed") && isTerminalStatus("skipped"), "isTerminalStatus matches the three terminal");
    assert(!isTerminalStatus("running") && !isTerminalStatus("scheduled"), "in-flight + claimable are NOT terminal");
    assert(isClaimableStatus("pending") && isClaimableStatus("scheduled"), "pending + scheduled are claimable");
    assert(isWaitingStatus("waiting") && !isWaitingStatus("pending"), "waiting is the human-decision parking lot");
    assert(isInFlightStatus("running"), "running is in-flight");
  }

  console.log("\n[state machine — valid transitions]");
  {
    const allowed: Array<[RunStatus, RunStatus]> = [
      ["scheduled", "running"],
      ["scheduled", "skipped"],
      ["running", "done"],
      ["running", "failed"],
      ["running", "skipped"],
      ["running", "waiting"],
      ["waiting", "pending"],
      ["waiting", "skipped"],
      ["pending", "running"],
    ];
    for (const [f, t] of allowed) {
      assert(validRunTransition(f, t), `${f} → ${t} is allowed`);
    }
  }
  {
    const forbidden: Array<[RunStatus, RunStatus]> = [
      ["scheduled", "done"],          // can't terminate without ever running
      ["scheduled", "pending"],       // scheduled never enters resume lane
      ["scheduled", "waiting"],       // can't park before running
      ["running", "scheduled"],       // can't go backwards
      ["running", "pending"],         // pending only reached via waiting
      ["done", "running"],            // terminal is terminal
      ["failed", "running"],          // terminal is terminal
      ["skipped", "running"],         // terminal is terminal
      ["waiting", "running"],         // must resolve to pending first
      ["pending", "done"],            // must re-enter running before terminating
    ];
    for (const [f, t] of forbidden) {
      assert(!validRunTransition(f, t), `${f} → ${t} is REFUSED`);
    }
  }
  {
    // Self-transition: explicitly refused.
    for (const s of RUN_STATUSES) {
      assert(!validRunTransition(s, s), `${s} → ${s} self-transition is refused`);
    }
  }
  {
    assert(nextValidStatuses("running").length === 4, "running has 4 successors");
    assert(nextValidStatuses("done").length === 0, "done is terminal (zero successors)");
    assert(nextValidStatuses("scheduled").includes("running"), "scheduled enumerates 'running' as a successor");
  }

  console.log("\n[claim ordering — pending before scheduled, then FIFO]");
  {
    const t0 = new Date("2026-06-01T00:00:00Z").toISOString();
    const t1 = new Date("2026-06-01T01:00:00Z").toISOString();
    const t2 = new Date("2026-06-01T02:00:00Z").toISOString();
    const ordered = orderClaimQueue([
      { id: "s2", status: "scheduled", scheduledFor: t2 },
      { id: "p1", status: "pending", scheduledFor: t1 },
      { id: "s1", status: "scheduled", scheduledFor: t1 },
      { id: "p0", status: "pending", scheduledFor: t0 },
      { id: "wait", status: "waiting", scheduledFor: t0 }, // not claimable — drops out
      { id: "done", status: "done", scheduledFor: t0 }, // not claimable — drops out
    ]);
    assert(ordered.map((r) => r.id).join(",") === "p0,p1,s1,s2", "pending-first, then FIFO by scheduledFor");
    assert(ordered.length === 4, "non-claimable statuses dropped from the queue");
  }
  {
    // Null scheduledFor sorts to the front of its priority group (treated as 0).
    const ordered = orderClaimQueue([
      { id: "s1", status: "scheduled", scheduledFor: new Date("2026-06-01T00:00:00Z").toISOString() },
      { id: "s0", status: "scheduled", scheduledFor: null },
    ]);
    assert(ordered[0]!.id === "s0", "null scheduledFor sorts first (0 epoch)");
  }

  console.log("\n[bundle shape — full success + drift catches]");
  {
    const r = validateBundleShape(goodBundle(), "https://api.example.com");
    assert(r.ok && r.reasons.length === 0, "complete bundle passes validation");
  }
  {
    const bad = goodBundle({ run: { id: "r1", status: "frobnicated", triggerSource: "manual" } });
    const r = validateBundleShape(bad);
    assert(!r.ok && r.reasons.some((s) => /not in RUN_STATUSES/.test(s)), "unknown status flagged as drift");
  }
  {
    const bad = goodBundle({ api: { statusUrl: "x", activityUrl: "y", approvalsUrl: "z", validStatuses: ["done", "running"] } });
    const r = validateBundleShape(bad);
    assert(!r.ok && r.reasons.some((s) => /validStatuses/.test(s)), "validStatuses set must match RUN_STATUSES");
  }
  {
    const bad = goodBundle({ tools: "not-an-array" });
    const r = validateBundleShape(bad);
    assert(r.reasons.includes("tools is not an array"), "array fields enforced");
  }
  {
    const bad = goodBundle({ api: { statusUrl: "https://wrong-host/api/runs/r1/status", activityUrl: "x", approvalsUrl: "y", validStatuses: [...RUN_STATUSES] } });
    const r = validateBundleShape(bad, "https://api.example.com");
    assert(r.reasons.some((s) => /baseUrl/.test(s)), "statusUrl baseUrl mismatch flagged");
  }
  {
    const r = validateBundleShape(null);
    assert(!r.ok && r.reasons[0] === "bundle is not an object", "null bundle rejected");
  }
  {
    // Missing agent fields.
    const bad = goodBundle({ agent: { id: "a1", tenantId: "t1", key: "ad-ops" } });
    const r = validateBundleShape(bad);
    assert(r.reasons.some((s) => /agent.model/.test(s)), "missing agent.model surfaced");
    assert(r.reasons.some((s) => /agent.autonomy/.test(s)), "missing agent.autonomy surfaced");
  }

  console.log("\n[approval cycle invariant]");
  {
    const r = validateApprovalCycle(["scheduled", "running", "waiting", "pending", "running", "done"]);
    assert(r.ok, "canonical approval cycle accepted");
  }
  {
    const r = validateApprovalCycle(["scheduled", "running", "waiting", "running"]);
    assert(!r.ok && r.reasons.some((s) => /pending/.test(s)), "skipping 'pending' rejected");
  }
  {
    const r = validateApprovalCycle(["scheduled", "waiting", "pending", "running"]);
    assert(!r.ok, "waiting before ever running is rejected");
  }
  {
    const r = validateApprovalCycle(["scheduled", "running"]);
    assert(!r.ok, "too short (no approval cycle present) rejected");
  }

  console.log("\n[session_end invariant — exactly 1 per terminal]");
  {
    const events = [
      { kind: "session_end", runId: "r1", rationale: "done" },
      { kind: "session_end", runId: "r2", rationale: "failed" },
      { kind: "allow", runId: "r1", rationale: null }, // non-session_end ignored
    ];
    const terminal = new Map([["r1", "done"], ["r2", "failed"]] as const);
    const r = validateSessionEndInvariant(events, terminal as ReadonlyMap<string, "done" | "failed" | "skipped">);
    assert(r.ok, "one session_end per terminal, rationales match");
  }
  {
    const events = [
      { kind: "session_end", runId: "r1", rationale: "done" },
      { kind: "session_end", runId: "r1", rationale: "done" },
    ];
    const terminal = new Map([["r1", "done"]] as const);
    const r = validateSessionEndInvariant(events, terminal as ReadonlyMap<string, "done" | "failed" | "skipped">);
    assert(!r.ok && r.reasons[0]!.includes("2 session_end"), "duplicate session_end rejected");
  }
  {
    const events: Array<{ kind: string; runId: string; rationale?: string | null }> = [];
    const terminal = new Map([["r1", "done"]] as const);
    const r = validateSessionEndInvariant(events, terminal as ReadonlyMap<string, "done" | "failed" | "skipped">);
    assert(!r.ok && r.reasons[0]!.includes("0 session_end"), "missing session_end rejected");
  }
  {
    const events = [{ kind: "session_end", runId: "r1", rationale: "failed" }];
    const terminal = new Map([["r1", "done"]] as const);
    const r = validateSessionEndInvariant(events, terminal as ReadonlyMap<string, "done" | "failed" | "skipped">);
    assert(!r.ok && r.reasons[0]!.includes("rationale"), "rationale mismatch with terminal status rejected");
  }
  {
    const events = [{ kind: "session_end", runId: "phantom", rationale: "done" }];
    const r = validateSessionEndInvariant(events, new Map());
    assert(!r.ok && r.reasons[0]!.includes("non-terminal"), "session_end for a non-terminal run rejected");
  }

  console.log("\n[tools registry contract]");
  {
    const r = validateToolsRegistry([
      { tenantId: "t1", key: "k1", requiresApproval: true },
      { tenantId: "t1", key: "k2", requiresApproval: true },
      { tenantId: "t2", key: "k1", requiresApproval: true }, // same key, different tenant — OK
    ]);
    assert(r.ok, "unique per-tenant keys + deny-by-default accepted");
  }
  {
    const r = validateToolsRegistry([
      { tenantId: "t1", key: "k1", requiresApproval: true },
      { tenantId: "t1", key: "k1", requiresApproval: true },
    ]);
    assert(!r.ok && r.reasons[0]!.includes("duplicate"), "same (tenant_id, key) rejected");
  }
  {
    const r = validateToolsRegistry([{ tenantId: "t1", key: "k1", requiresApproval: false }]);
    assert(!r.ok && r.reasons[0]!.includes("deny-by-default"), "requires_approval=false flagged");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
