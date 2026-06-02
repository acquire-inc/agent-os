// Pure structural test for the two universal safety skills (Phase 10). No DB.
// These two are bound to ~every agent (verification: 92, clarify: 42), so their SKILL.md must
// stay in canonical anatomy: frontmatter (name/description/allowed-tools), ## Steps, ## Guardrails,
// real depth, and the domain anchors that tie them to the runtime contract.
// Run: pnpm --filter @agent-os/seed exec tsx _safety-skills.test.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "..", "external", "acqu-skills");

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function read(skill: string): string {
  return readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8");
}

function checkAnatomy(skill: string, md: string) {
  const fmClose = md.indexOf("\n---", 3);
  const fm = fmClose > 0 ? md.slice(0, fmClose) : "";
  assert(md.startsWith("---") && fmClose > 0, `${skill}: has frontmatter block`);
  assert(/\nname:\s*\S/.test(fm), `${skill}: frontmatter has name`);
  assert(/\ndescription:\s*\S/.test(fm), `${skill}: frontmatter has description`);
  assert(/\nallowed-tools:\s*\[.*tool\./.test(fm), `${skill}: declares allowed-tools`);
  assert(/^##\s+Steps/m.test(md), `${skill}: has a ## Steps section`);
  assert(/^##\s+Guardrails/m.test(md), `${skill}: has a ## Guardrails section`);
  const steps = (md.match(/^\d+\.\s+\*\*/gm) ?? []).length;
  assert(steps >= 4, `${skill}: has ≥4 numbered steps (got ${steps})`);
}

function main() {
  const verification = read("verification-before-completion");
  const clarify = read("clarify-before-acting");

  checkAnatomy("verification-before-completion", verification);
  checkAnatomy("clarify-before-acting", clarify);

  // Domain anchors — verification ties its outcome to the run-summary contract.
  assert(/verification_result/.test(verification), "verification: records outcome as verification_result");
  assert(/proposed|queued|"done"/i.test(verification), "verification: distinguishes proposed vs done");

  // Domain anchors — clarify routes through the approval gate + always offers 'do nothing'.
  assert(/tool\.17|Approval/i.test(clarify), "clarify: raises an Approval (tool.17 / approvals bridge)");
  assert(/do nothing/i.test(clarify), "clarify: always includes a 'do nothing' option");
  assert(/irreversible/i.test(clarify), "clarify: scoped to irreversible / side-effecting actions");
  assert(/waiting|suspend/i.test(clarify), "clarify: suspends the run rather than proceeding");

  // The thin original is gone (a guard against regressing it back to a one-liner).
  assert(clarify.length > 800, `clarify is a full playbook, not a stub (len ${clarify.length})`);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
