// Pure unit test for the cross-model fallback (Nebius SPOF). No DB / no network.
// Run: pnpm --filter @agent-os/core exec tsx src/model-fallback.test.ts
import { fallbackModel, isProviderUnavailable, planModelFallback } from "./model-fallback.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // ── fallback mapping ──
  assert(fallbackModel("nousresearch/hermes-4-405b") === "anthropic/claude-haiku-4-5", "405b → haiku fallback");
  assert(fallbackModel("nousresearch/hermes-4-70b") === "anthropic/claude-haiku-4-5", "70b → haiku fallback");
  assert(fallbackModel("anthropic/claude-haiku-4-5") === null, "claude has no Hermes fallback (already cross-provider)");

  // ── availability detection ──
  assert(isProviderUnavailable(new Error("No instances available for nousresearch/hermes-4-405b")), "detects 'no instances available'");
  assert(isProviderUnavailable("503 Service Unavailable"), "detects 503");
  assert(isProviderUnavailable(new Error("upstream provider returned error")), "detects upstream error");
  assert(isProviderUnavailable("ETIMEDOUT"), "detects timeout");
  assert(!isProviderUnavailable(new Error("invalid request: prompt too long")), "ignores genuine request errors");
  assert(!isProviderUnavailable(new Error("401 unauthorized")), "ignores auth errors");
  assert(!isProviderUnavailable(""), "empty error is not availability");

  // ── plan: retry once on fallback for availability errors ──
  const r1 = planModelFallback({ model: "nousresearch/hermes-4-405b", error: new Error("no instances available"), alreadyFellBack: false });
  assert(r1.retry === true && r1.model === "anthropic/claude-haiku-4-5", "availability error → retry on fallback");
  assert(typeof r1.reason === "string" && r1.reason!.includes("→"), "retry carries a human reason");

  const r2 = planModelFallback({ model: "nousresearch/hermes-4-405b", error: new Error("no instances available"), alreadyFellBack: true });
  assert(r2.retry === false, "never falls back twice");

  const r3 = planModelFallback({ model: "nousresearch/hermes-4-405b", error: new Error("bad prompt"), alreadyFellBack: false });
  assert(r3.retry === false, "non-availability error does not trigger fallback");

  const r4 = planModelFallback({ model: "anthropic/claude-haiku-4-5", error: new Error("503"), alreadyFellBack: false });
  assert(r4.retry === false, "no fallback defined → no retry");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
