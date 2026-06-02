// Pure test for skill allowed-tools inference + catalog validity (Phase 9, 09-03). No DB.
// (Coverage that every SKILL.md declares allowed-tools is gated separately by
//  `author-allowed-tools.ts --check` in test-all.sh.)
// Run: pnpm --filter @agent-os/seed exec tsx _skills.test.ts
import { inferAllowedTools } from "./author-allowed-tools.js";
import { KNOWN_TOOLS } from "./_tools.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // ── every skill gets the universal infra base (knowledge read + run-summary write) ──
  assert(inferAllowedTools("anything", "Anything").includes("tool.21"), "base includes tool.21 (Vector DB)");
  assert(inferAllowedTools("anything", "Anything").includes("tool.22"), "base includes tool.22 (Run-Summary Writer)");

  // ── every emitted tool is a real catalog key (never an undescribed stub) ──
  const samples = [
    "daily-ad-ops", "morning-vitals", "dunning-collections", "expense-tracking", "client-onboarding",
    "contract-drafting", "security-anomaly", "competitor-ad-teardown", "memory-consolidation",
    "workforce-planning", "clarify-before-acting", "verification-before-completion", "case-study-builder",
  ];
  let bad: string[] = [];
  for (const s of samples) for (const t of inferAllowedTools(s, s)) if (!KNOWN_TOOLS[t]) bad.push(`${s}:${t}`);
  assert(bad.length === 0, `every inferred tool is a real catalog key${bad.length ? " — bad: " + bad.join(", ") : ""}`);

  // ── domain sanity: the workflow's tools show up ──
  assert(inferAllowedTools("daily-ad-ops", "Daily Ad Ops").includes("tool.1"), "ad skill → Meta Adapter (tool.1)");
  assert(inferAllowedTools("dunning-collections", "Dunning").includes("tool.dunning-engine"), "dunning skill → dunning-engine");
  assert(inferAllowedTools("expense-tracking", "Expense Tracking").includes("tool.expense-feed"), "expense skill → expense-feed");
  assert(inferAllowedTools("contract-drafting", "Contract Drafting").includes("tool.contract-engine"), "contract skill → contract-engine");
  assert(inferAllowedTools("security-audit", "Security Audit").includes("tool.vault-auditor"), "security skill → vault-auditor");

  // ── infra skills stay minimal (no domain tools beyond the base + their interface) ──
  const verify = inferAllowedTools("verification-before-completion", "Verification Before Completion");
  assert(verify.length === 2 && verify.includes("tool.21") && verify.includes("tool.22"), "verification skill → base only");

  // ── output is sorted + deduped ──
  const a = inferAllowedTools("client-onboarding", "Client Onboarding");
  assert(new Set(a).size === a.length, "inferAllowedTools output is deduped");
  assert([...a].sort().join() === a.join(), "inferAllowedTools output is sorted");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
