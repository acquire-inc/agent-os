// Pure unit tests for the real-time anomaly circuit-breaker (no DB required).
// Run: pnpm --filter @agent-os/core test:circuit-breaker
import {
  DEFAULT_BREAKER_CONFIG,
  evaluateCircuitBreaker,
  runCircuitBreaker,
  type CircuitBreakerAction,
  type CircuitBreakerSample,
  type CircuitBreakerSink,
} from "./circuit-breaker.js";

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

const ok = (): CircuitBreakerSample => ({ status: "done", cantfailEventCount: 0 });
const fail = (): CircuitBreakerSample => ({ status: "failed", cantfailEventCount: 0 });
const cf = (): CircuitBreakerSample => ({ status: "failed", cantfailEventCount: 1 });

async function main() {
  console.log("\n[evaluate — failure streak]");
  assert(evaluateCircuitBreaker([ok(), fail(), fail()], "execute_safe").action === "none", "2 trailing failures < threshold → none");
  const d3 = evaluateCircuitBreaker([fail(), fail(), fail()], "execute_safe");
  assert(d3.tripped && d3.action === "demote_to_propose", "3 consecutive failures at execute_safe → demote_to_propose");
  const dFull = evaluateCircuitBreaker([fail(), fail(), fail()], "execute_full");
  assert(dFull.action === "demote_to_propose", "execute_full + streak → demote straight to propose");

  console.log("\n[evaluate — already at propose floor]");
  const dPause = evaluateCircuitBreaker([fail(), fail(), fail()], "propose");
  assert(dPause.tripped && dPause.action === "pause", "streak while already at propose → pause agent");

  console.log("\n[evaluate — streak must be CONSECUTIVE from newest]");
  assert(evaluateCircuitBreaker([fail(), fail(), ok()], "execute_safe").action === "none", "failures broken by a recent success → none");
  assert(evaluateCircuitBreaker([fail(), ok(), fail(), fail(), fail()], "execute_safe").action === "demote_to_propose", "3 trailing failures trip even with older success");

  console.log("\n[evaluate — cant-fail event is the hardest signal]");
  const dcf = evaluateCircuitBreaker([ok(), ok(), cf()], "execute_safe");
  assert(dcf.tripped && dcf.action === "demote_to_propose", "single cant-fail event → trip immediately (no streak needed)");
  assert(evaluateCircuitBreaker([cf()], "propose").action === "pause", "cant-fail at propose → pause");

  console.log("\n[evaluate — never ratchets up; empty window]");
  assert(evaluateCircuitBreaker([], "execute_full").action === "none", "empty window → none");
  assert(evaluateCircuitBreaker([ok(), ok(), ok()], "execute_safe").tripped === false, "all-clean window never trips (never ratchets up)");

  console.log("\n[runCircuitBreaker — sink side effects]");
  const calls: string[] = [];
  const sink: CircuitBreakerSink = {
    fetchRecent: async () => [fail(), fail(), fail()],
    setAutonomyPropose: async () => { calls.push("setAutonomyPropose"); },
    pauseAgent: async () => { calls.push("pauseAgent"); },
    emitTripped: async (i: { action: CircuitBreakerAction }) => { calls.push(`emit:${i.action}`); },
  };
  const dec = await runCircuitBreaker({ tenantId: "t", agentId: "a", currentAutonomy: "execute_safe" }, sink);
  assert(dec.action === "demote_to_propose", "runner returns the decision");
  assert(calls.includes("setAutonomyPropose") && calls.includes("emit:demote_to_propose"), "trip → setAutonomyPropose + emit");
  assert(!calls.includes("pauseAgent"), "demote path does not pause");

  const calls2: string[] = [];
  const cleanSink: CircuitBreakerSink = {
    fetchRecent: async () => [ok(), ok(), ok()],
    setAutonomyPropose: async () => { calls2.push("setAutonomyPropose"); },
    pauseAgent: async () => { calls2.push("pauseAgent"); },
    emitTripped: async () => { calls2.push("emit"); },
  };
  await runCircuitBreaker({ tenantId: "t", agentId: "a", currentAutonomy: "execute_safe" }, cleanSink);
  assert(calls2.length === 0, "clean window → no side effects");

  console.log("\n[config defaults]");
  assert(DEFAULT_BREAKER_CONFIG.consecutiveFailures === 3 && DEFAULT_BREAKER_CONFIG.cantfailTrip === 1, "sane defaults (3 failures / 1 cant-fail)");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
