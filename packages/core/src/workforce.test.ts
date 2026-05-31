// Pure unit test for the workforce lifecycle rules. No DB — runs anywhere.
// Run: pnpm --filter @agent-os/core exec tsx src/workforce.test.ts
import { resolveLifecycle, LifecycleError, AGENT_STATUSES, type AgentStatus } from "./workforce.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function throws(fn: () => unknown, msg: string) {
  let t = false;
  try { fn(); } catch (e) { t = e instanceof LifecycleError; }
  assert(t, msg);
}

function main() {
  // ── spawn: hire lands proposed + disabled (a human must approve before it runs) ──
  const spawned = resolveLifecycle(null, "spawn");
  assert(spawned.status === "proposed" && spawned.enabled === false, "spawn → proposed + disabled");
  throws(() => resolveLifecycle("active", "spawn"), "spawn on an existing agent rejected");

  // ── activate: only enabled state is `active` ──
  assert(resolveLifecycle("proposed", "activate").status === "active", "approve proposed → active");
  assert(resolveLifecycle("proposed", "activate").enabled === true, "active is the only enabled state");
  assert(resolveLifecycle("paused", "activate").status === "active", "un-bench paused → active");
  throws(() => resolveLifecycle("archived", "activate"), "activate from archived rejected (use reactivate)");

  // ── pause: bench a live agent, reversible ──
  assert(resolveLifecycle("active", "pause").status === "paused", "active → paused (bench)");
  assert(resolveLifecycle("active", "pause").enabled === false, "paused is disabled");
  throws(() => resolveLifecycle("proposed", "pause"), "cannot pause a not-yet-live agent");

  // ── archive: fire from any non-archived state, terminal ──
  assert(resolveLifecycle("active", "archive").status === "archived", "active → archived (fire)");
  assert(resolveLifecycle("paused", "archive").status === "archived", "paused → archived");
  assert(resolveLifecycle("proposed", "archive").status === "archived", "reject a proposal via archive");

  // ── reactivate: bring back a benched/retired agent ──
  assert(resolveLifecycle("archived", "reactivate").status === "active", "archived → active (re-hire)");
  assert(resolveLifecycle("paused", "reactivate").enabled === true, "reactivate enables");

  // ── idempotency + guards ──
  assert(resolveLifecycle("paused", "pause").status === "paused", "pause is idempotent");
  assert(resolveLifecycle("archived", "archive").status === "archived", "archive is idempotent");
  throws(() => resolveLifecycle(null, "pause"), "cannot transition a non-existent agent");

  // ── never enable a non-active status (invariant matching the DB check) ──
  for (const action of ["spawn", "pause", "archive"] as const) {
    const r = resolveLifecycle(action === "spawn" ? null : "active", action);
    assert(!(r.enabled && r.status !== "active"), `${action}: enabled ⇒ active invariant holds`);
  }
  assert(AGENT_STATUSES.length === 4 && (AGENT_STATUSES as readonly AgentStatus[]).includes("archived"), "4 lifecycle states defined");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
