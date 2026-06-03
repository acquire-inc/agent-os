// Pure test for canonical skill anatomy on the deepened primary skills (Phase 12). No DB.
// Run: pnpm --filter @agent-os/seed exec tsx _skill-anatomy.test.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANATOMY_SKILLS } from "./author-skill-anatomy.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "..", "external", "acqu-skills");

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const read = (s: string) => readFileSync(join(skillsDir, s, "SKILL.md"), "utf8");

function main() {
  for (const skill of ANATOMY_SKILLS) {
    const md = read(skill);
    assert(/^##\s+Steps\b/m.test(md), `${skill}: has a ## Steps section`);
    assert(/^##\s+Guardrails\b/m.test(md), `${skill}: has a ## Guardrails section`);
    // ≥1 guardrail bullet after the Guardrails header.
    const guard = md.slice(md.indexOf("## Guardrails"));
    assert((guard.match(/^- /gm) ?? []).length >= 1, `${skill}: has ≥1 guardrail bullet`);
    // Frontmatter survived the rewrite (allowed-tools still present from 09-03).
    assert(/^allowed-tools:\s*\[.*tool\./m.test(md), `${skill}: allowed-tools preserved`);
    // Original step content survived.
    assert(/^1\.\s/m.test(md), `${skill}: numbered steps preserved`);
  }

  // Doctrine anchors landed in the guardrails (the safety value-add).
  assert(/first_payment\.received/.test(read("client-onboarding")), "client-onboarding guardrail: payment gate (E.1)");
  assert(/human sign-off|never commit a price/i.test(read("proposal-drafting")), "proposal-drafting guardrail: pricing sign-off");
  assert(/ad-claim-compliance/.test(read("creative-generation")), "creative-generation guardrail: ad-claim gate");
  assert(/never auto-send/i.test(read("churn-risk-detection")), "churn-risk guardrail: no auto-send");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
