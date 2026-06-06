// Pure test for per-task model tiering (Phase 17). No DB.
// Run: pnpm --filter @agent-os/seed exec tsx _model-tiering.test.ts
import { modelForAgent, MODEL_FOR_TIER, CANT_FAIL_MODEL, isCantFailOnHermes, type Tier } from "./_shared.js";
import { CANT_FAIL_AGENTS } from "@agent-os/shared";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const HERMES = "nousresearch/";

function main() {
  // ── tier → optimal model ──
  assert(modelForAgent("vitals", "T-cheap") === "nousresearch/hermes-4-70b", "T-cheap → Hermes 70B (volume)");
  assert(modelForAgent("intel", "T-reason") === "nousresearch/hermes-4-405b", "T-reason → Hermes 405B (reasoning)");
  assert(modelForAgent("ad-ops", "T-work") === "anthropic/claude-sonnet-4.6", "T-work → Claude Sonnet (agentic)");
  assert(modelForAgent("some-non-cantfail-x", "T-critical") === "anthropic/claude-sonnet-4.6", "non-can't-fail T-critical → Sonnet (not Opus cost)");

  // ── Opus is reserved exclusively for can't-fail ──
  assert(CANT_FAIL_MODEL === "anthropic/claude-opus-4.8", "can't-fail model is Opus 4.8");
  const opusForNonCantFail = (["T-cheap", "T-reason", "T-work", "T-critical"] as Tier[]).some((t) => modelForAgent("ordinary-agent", t) === CANT_FAIL_MODEL);
  assert(!opusForNonCantFail, "no ordinary agent is routed to Opus");

  // ── THE SAFETY INVARIANT: every can't-fail agent → Opus, NEVER Hermes, on every tier ──
  let onHermes: string[] = [];
  let notOpus: string[] = [];
  for (const k of CANT_FAIL_AGENTS as readonly string[]) {
    for (const t of ["T-cheap", "T-reason", "T-work", "T-critical"] as Tier[]) {
      const m = modelForAgent(k, t);
      if (m.startsWith(HERMES)) onHermes.push(`${k}@${t}`);
      if (m !== CANT_FAIL_MODEL) notOpus.push(`${k}@${t}=${m}`);
    }
  }
  assert(onHermes.length === 0, `no can't-fail agent routes to Hermes${onHermes.length ? " — " + onHermes.slice(0, 4).join(", ") : ""}`);
  assert(notOpus.length === 0, `every can't-fail agent routes to Opus regardless of tier${notOpus.length ? " — " + notOpus.slice(0, 4).join(", ") : ""}`);

  // ── isCantFailOnHermes guard ──
  assert(isCantFailOnHermes("ad-claim-compliance", "nousresearch/hermes-4-405b") === true, "guard flags a can't-fail agent on Hermes");
  assert(isCantFailOnHermes("ad-claim-compliance", CANT_FAIL_MODEL) === false, "guard passes a can't-fail agent on Opus");
  assert(isCantFailOnHermes("vitals", "nousresearch/hermes-4-70b") === false, "guard ignores an ordinary agent on Hermes");

  // ── the tier map only routes Hermes to the cheap/reason tiers (volume + thinking) ──
  assert(MODEL_FOR_TIER["T-work"].startsWith("anthropic/") && MODEL_FOR_TIER["T-critical"].startsWith("anthropic/"), "agentic + critical tiers are Claude");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
