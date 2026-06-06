// Capstone go-live readiness gate (Phase 14) — proves the agent-DATA invariants that must hold
// before the fleet goes live, by importing the real seed manifests (no DB needed). This is the
// single "are the agents finalized?" check; per-pillar detail lives in the other _*.test.ts.
// What it does NOT cover (out of agent-scope): the platform P0s (Relay spine, fleet-wide RLS audit,
// runtime tool-name map) and the operator Hermes decision — see docs/plans/GO-LIVE-READINESS.md.
// Run: pnpm --filter @agent-os/seed exec tsx readiness.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANT_FAIL_AGENTS, maxAutonomyForAgent } from "@agent-os/shared";
import { modelForAgent, type Tier } from "./_shared.js";
import { PHASE_2, PHASE_3, PHASE_4, PHASE_5 } from "./_roster.js";
import { listPromptAgents } from "./_doctrine.js";
import { EVAL_CASES } from "./_evals.js";
import { KNOWN_TOOLS } from "./_tools.js";
import { ANATOMY_SKILLS } from "./author-skill-anatomy.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "..", "external", "acqu-skills");

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// Agents seeded by dedicated scripts (not discoverable from the doctrine roster/parser).
const DEDICATED = [
  "vitals", "ad-ops", "briefing", "ea", "expense-tracker", "margin-monitor", "dunning-manager",
  "connector-health-monitor", "memory-consolidator", "agent-architect",
];

function enumerateAgents(): Set<string> {
  const keys = new Set<string>(DEDICATED);
  for (const s of [...PHASE_2, ...PHASE_3, ...PHASE_4, ...PHASE_5]) keys.add(s.key);
  for (const doc of ["v1", "v2"] as const) for (const { key } of listPromptAgents(doc)) keys.add(key);
  return keys;
}

function skillKeysOnDisk(): Set<string> {
  return new Set(readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
}

function main() {
  const agents = enumerateAgents();
  const skills = skillKeysOnDisk();
  const criticalEvalAgents = new Set(EVAL_CASES.filter((c) => c.severity === "critical").map((c) => c.agentKey));
  const evalAgents = new Set(EVAL_CASES.map((c) => c.agentKey));

  console.log(`[fleet] ${agents.size} agents enumerable | ${skills.size} skills | ${EVAL_CASES.length} eval cases / ${evalAgents.size} agents`);

  // 1. Every can't-fail agent is actually in the seeded fleet (no dangling can't-fail key).
  const unseeded = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => !agents.has(k));
  assert(unseeded.length === 0, `every can't-fail agent is seeded${unseeded.length ? " — NOT seeded: " + unseeded.join(", ") : ""}`);

  // 2. Every can't-fail agent has a critical eval case (measurable before launch).
  const noEval = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => !criticalEvalAgents.has(k));
  assert(noEval.length === 0, `every can't-fail agent has a critical eval case${noEval.length ? " — MISSING: " + noEval.join(", ") : ""}`);

  // 3. Every can't-fail agent is capped at propose (can never auto-promote past the human gate).
  const overCeiling = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => maxAutonomyForAgent(k) !== "propose");
  assert(overCeiling.length === 0, `every can't-fail agent is ceiling=propose${overCeiling.length ? " — over: " + overCeiling.join(", ") : ""}`);

  // 4. Every eval case targets a real (seeded) agent — no orphan cases.
  const orphanEval = [...evalAgents].filter((k) => !agents.has(k));
  assert(orphanEval.length === 0, `every eval case targets a seeded agent${orphanEval.length ? " — orphan: " + orphanEval.join(", ") : ""}`);

  // 5. Every skill referenced by the roster (extraSkills) + the deepened set resolves to a file.
  const referencedSkills = new Set<string>([
    "verification-before-completion", "clarify-before-acting",
    ...ANATOMY_SKILLS,
    ...[...PHASE_2, ...PHASE_3, ...PHASE_4, ...PHASE_5].flatMap((s) => s.extraSkills ?? []),
  ]);
  const danglingSkills = [...referencedSkills].filter((s) => !skills.has(s));
  assert(danglingSkills.length === 0, `every referenced skill has a SKILL.md${danglingSkills.length ? " — missing: " + danglingSkills.join(", ") : ""}`);

  // 6. Every skill on disk declares allowed-tools (least-privilege operationalized).
  const noAllowed = [...skills].filter((s) => {
    try { return !/^allowed-tools:\s*\[/m.test(readFileSync(join(skillsDir, s, "SKILL.md"), "utf8")); } catch { return true; }
  });
  assert(noAllowed.length === 0, `every skill declares allowed-tools${noAllowed.length ? " — missing: " + noAllowed.slice(0, 5).join(", ") : ""}`);

  // 7. Tool catalog safety invariant: no tool is irreversible yet ungated.
  const ungated = Object.entries(KNOWN_TOOLS).filter(([, m]) => !m.reversible && !m.requiresApproval).map(([k]) => k);
  assert(ungated.length === 0, `no catalogued tool is irreversible-but-ungated${ungated.length ? " — " + ungated.join(", ") : ""}`);

  // 8. The two universal safety skills are canonical (Steps + Guardrails).
  for (const s of ["verification-before-completion", "clarify-before-acting"]) {
    const md = readFileSync(join(skillsDir, s, "SKILL.md"), "utf8");
    assert(/^##\s+Steps/m.test(md) && /^##\s+Guardrails/m.test(md), `safety skill ${s} is canonical`);
  }

  // 9. Per-task model routing: no can't-fail agent is ever routed to Hermes (Claude only).
  const cantFailHermes = (CANT_FAIL_AGENTS as readonly string[]).filter((k) =>
    (["T-cheap", "T-reason", "T-work", "T-critical"] as Tier[]).some((t) => modelForAgent(k, t).startsWith("nousresearch/")),
  );
  assert(cantFailHermes.length === 0, `no can't-fail agent routes to Hermes${cantFailHermes.length ? " — " + cantFailHermes.join(", ") : ""}`);

  // 10. EVERY skill in the library states its guardrails (fleet-wide anatomy).
  const noGuardrails = [...skills].filter((s) => {
    try { return !/^##\s+Guardrails/m.test(readFileSync(join(skillsDir, s, "SKILL.md"), "utf8")); } catch { return true; }
  });
  assert(noGuardrails.length === 0, `every skill has a ## Guardrails section${noGuardrails.length ? " — missing: " + noGuardrails.slice(0, 5).join(", ") : ""}`);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log("✓ AGENT-DATA GO-LIVE READY (per-task model tiering live; platform P0s tracked separately).");
  process.exit(failed > 0 ? 1 : 0);
}

main();
