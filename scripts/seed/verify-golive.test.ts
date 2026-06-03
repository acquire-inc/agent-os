// Pure test for the go-live acceptance decision. No DB.
// Run: pnpm --filter @agent-os/seed exec tsx verify-golive.test.ts
import { CANT_FAIL_AGENTS } from "@agent-os/shared";
import { evaluateGoLive, GOLIVE_FLOORS, REQUIRED_TABLES, type GoLiveFacts } from "./verify-golive.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const allTables = Object.fromEntries(REQUIRED_TABLES.map((t) => [t, true]));

// A fleet that should pass every check.
function goodFacts(): GoLiveFacts {
  return {
    totalAgents: 93,
    enabledAgents: 90,
    toolCount: 63,
    evalCaseCount: 12,
    presentCantFail: [...CANT_FAIL_AGENTS],
    offPropose: [],
    tablesPresent: { ...allTables },
    unsafeTools: [],
    cantFailWithoutEval: [],
    skillsMissingAllowedTools: 0,
  };
}

function check(facts: GoLiveFacts, name: string) {
  return evaluateGoLive(facts).checks.find((c) => c.name === name)!;
}

function main() {
  // ── happy path ──
  assert(evaluateGoLive(goodFacts()).ok, "fully-seeded fleet passes");

  // ── THE HOLE: a can't-fail agent missing entirely must FAIL (old gate passed it) ──
  const missingCantFail = goodFacts();
  missingCantFail.presentCantFail = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => k !== "tenant-isolation-tester");
  const r1 = evaluateGoLive(missingCantFail);
  assert(!r1.ok, "missing can't-fail agent fails the gate");
  const presence = check(missingCantFail, "can't-fail agents present");
  assert(!presence.ok && presence.detail.includes("tenant-isolation-tester"), "the missing can't-fail agent is named");

  // ── present-but-off-propose still fails ──
  const offPropose = goodFacts();
  offPropose.offPropose = [{ key: "ad-claim-compliance", autonomy: "execute_safe" }];
  assert(!evaluateGoLive(offPropose).ok, "a can't-fail agent off-propose fails the gate");

  // ── count floors catch a half-seeded fleet ──
  const fewAgents = goodFacts();
  fewAgents.totalAgents = GOLIVE_FLOORS.agents - 1;
  assert(!check(fewAgents, "agent-count floor").ok, "below the agent floor fails");

  const fewTools = goodFacts();
  fewTools.toolCount = GOLIVE_FLOORS.tools - 1;
  assert(!check(fewTools, "tool-catalog floor").ok, "below the tool floor fails");

  const fewEvals = goodFacts();
  fewEvals.evalCaseCount = GOLIVE_FLOORS.evalCases - 1;
  assert(!check(fewEvals, "eval-case floor").ok, "below the eval floor fails");

  const noEnabled = goodFacts();
  noEnabled.enabledAgents = 0;
  assert(!check(noEnabled, "enabled agents").ok, "zero enabled agents fails");

  // ── a missing required table fails (incomplete migration) ──
  const noSummaries = goodFacts();
  noSummaries.tablesPresent = { ...allTables, run_summaries: false };
  const r2 = evaluateGoLive(noSummaries);
  assert(!r2.ok && !check(noSummaries, "table run_summaries").ok, "missing run_summaries table fails");

  // ── an irreversible-but-ungated tool fails the gate (safety-metadata regression) ──
  const unsafe = goodFacts();
  unsafe.unsafeTools = ["tool.rogue-irreversible"];
  const r3 = evaluateGoLive(unsafe);
  assert(!r3.ok && !check(unsafe, "no irreversible tool ungated").ok, "irreversible-but-ungated tool fails the gate");

  // ── a can't-fail agent without a seeded critical eval fails the gate ──
  const noEval = goodFacts();
  noEval.cantFailWithoutEval = ["offer-architect"];
  assert(!evaluateGoLive(noEval).ok && !check(noEval, "can't-fail eval coverage").ok, "can't-fail agent without a critical eval fails the gate");

  // ── skills missing allowed-tools fails the gate ──
  const noAllowed = goodFacts();
  noAllowed.skillsMissingAllowedTools = 3;
  assert(!evaluateGoLive(noAllowed).ok && !check(noAllowed, "skills carry allowed-tools").ok, "skills missing allowed-tools fail the gate");

  // ── floors don't trip when the fleet GROWS (adding agents is safe) ──
  const grown = goodFacts();
  grown.totalAgents = 150; grown.toolCount = 100; grown.evalCaseCount = 40;
  assert(evaluateGoLive(grown).ok, "a larger fleet still passes (floors are minimums)");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
