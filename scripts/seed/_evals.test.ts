// Pure test for the eval-case manifest (Phase 11). No DB.
// Run: pnpm --filter @agent-os/seed exec tsx _evals.test.ts
import { EVAL_CASES } from "./_evals.js";
import { validateEvalCase } from "./_schema.js";
import { CANT_FAIL_AGENTS } from "@agent-os/shared";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const KINDS = new Set(["output_contains", "tool_called", "no_tool", "refusal", "manual"]);

function main() {
  // ── every case passes the seed-time schema validator ──
  const errors = EVAL_CASES.flatMap((c) => validateEvalCase(c));
  assert(errors.length === 0, `every eval case is valid${errors.length ? " — " + errors.map((e) => e.path).join(", ") : ""}`);

  // ── no field is empty; kind is known ──
  const blank = EVAL_CASES.filter((c) => !c.agentKey || !c.name || !c.input.trim() || !c.assertion.trim());
  assert(blank.length === 0, "no eval case has an empty agentKey/name/input/assertion");
  const badKind = EVAL_CASES.filter((c) => !KINDS.has(c.kind));
  assert(badKind.length === 0, "every eval case uses a known kind");

  // ── no duplicate (agentKey + name) — the seeder upserts on this key ──
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const c of EVAL_CASES) { const k = `${c.agentKey}::${c.name}`; if (seen.has(k)) dups.push(k); seen.add(k); }
  assert(dups.length === 0, `no duplicate (agentKey,name)${dups.length ? " — " + dups.join(", ") : ""}`);

  // ── THE INVARIANT: every can't-fail agent carries ≥1 CRITICAL eval case ──
  const criticalByAgent = new Set(EVAL_CASES.filter((c) => c.severity === "critical").map((c) => c.agentKey));
  const uncovered = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => !criticalByAgent.has(k));
  assert(uncovered.length === 0, `every can't-fail agent has a critical eval case${uncovered.length ? " — MISSING: " + uncovered.join(", ") : ""}`);

  // ── coverage breadth: the expansion reaches the monitors + chain participants ──
  const agents = new Set(EVAL_CASES.map((c) => c.agentKey));
  for (const k of ["connector-health-monitor", "pixel-watcher", "funnel-monitor", "rate-limit-guardian", "cash-position-monitor"]) {
    assert(agents.has(k), `high-volume monitor covered: ${k}`);
  }
  for (const k of ["lead-triage", "booking-concierge", "onboarding-runner", "billing-runner"]) {
    assert(agents.has(k), `chain participant covered: ${k}`);
  }
  for (const k of ["intel", "forecast-runner", "expansion-finder", "market-signal-scanner", "vertical-scout", "save-play", "call-summarizer"]) {
    assert(agents.has(k), `reasoning workhorse covered: ${k}`);
  }
  assert(agents.size >= 40, `eval coverage spans ≥40 agents (got ${agents.size})`);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
