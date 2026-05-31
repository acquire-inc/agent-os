// Pure acceptance test for the workforce tools' SAFETY CONTRACT (GSD: test the invariant that
// matters). agent-architect can propose hiring/benching/firing agents — so the guarantee we
// must never regress is: every workforce MUTATION tool is approval-gated AND irreversible (so
// the runner's PreToolUse autonomy gate forces human sign-off via ctx.toolApproval), the
// registry READ is neither, and each record passes validateTool. No DB.
// Run: pnpm --filter @agent-os/seed exec tsx scripts/seed/_workforce-tools.test.ts
import { toolMeta, ACTION_TOOLS } from "./_tools.js";
import { validateTool, assertValid } from "./_schema.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const MUTATIONS = ["tool.spawn-agent", "tool.pause-agent", "tool.archive-agent", "tool.reactivate-agent"];
const READ = "tool.agent-registry";

function main() {
  // ── every mutation tool: approval-gated + irreversible (what trips the gate to 'propose') ──
  for (const key of MUTATIONS) {
    const m = toolMeta(key);
    assert(m.requiresApproval === true, `${key} requires approval`);
    assert(m.reversible === false, `${key} is irreversible`);
    assert(ACTION_TOOLS.has(key), `${key} is in ACTION_TOOLS (heuristic backstop)`);
    assertValid(
      validateTool({ toolKey: key, name: m.name, kind: m.kind, status: "active", requiresApproval: m.requiresApproval, reversible: m.reversible }),
      `${key} validates`,
    );
  }

  // ── the registry READ is safe: no approval, reversible (never gate a read) ──
  const r = toolMeta(READ);
  assert(r.requiresApproval === false, `${READ} does not require approval (read)`);
  assert(r.reversible === true, `${READ} is reversible (read)`);

  // ── defense-in-depth: a mutation tool can never be misconfigured as auto-runnable ──
  for (const key of MUTATIONS) {
    const m = toolMeta(key);
    assert(!(m.reversible === false && m.requiresApproval === false), `${key} can't be irreversible-and-auto`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
