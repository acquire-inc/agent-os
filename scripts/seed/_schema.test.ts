// Unit test for the record validators (v3 G). No DB — pure validation assertions.
import { validateAgent, validateTool, validateEvalCase, assertValid } from "./_schema.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // ── agents ──
  assert(validateAgent({ key: "vitals", name: "Vitals", model: "nousresearch/hermes-4-405b", backend: "claude-agent-sdk", autonomy: "execute_safe", systemPrompt: "You are the vitals agent. Post the morning snapshot." }).length === 0, "valid agent passes");
  assert(validateAgent({ key: "BadKey", name: "X", model: "nousresearch/hermes-4-405b", backend: "claude-agent-sdk", autonomy: "execute_safe" }).some((e) => e.path.endsWith(".key")), "uppercase key rejected");
  assert(validateAgent({ key: "x", name: "X", model: "gpt-4o", backend: "claude-agent-sdk", autonomy: "propose" }).some((e) => e.message.includes("unknown model")), "unknown model slug rejected");
  assert(validateAgent({ key: "x", name: "X", model: "nousresearch/hermes-4-405b", backend: "claude-agent-sdk", autonomy: "yolo" }).some((e) => e.path.endsWith(".autonomy")), "unknown autonomy rejected");
  assert(validateAgent({ key: "x", name: "X", model: "nousresearch/hermes-4-405b", backend: "claude-agent-sdk", autonomy: "propose", systemPrompt: "too short" }).some((e) => e.path.endsWith(".systemPrompt")), "short prompt rejected");

  // ── tools ──
  assert(validateTool({ toolKey: "tool.proof-vault", name: "Proof Vault", kind: "custom", status: "active" }).length === 0, "valid tool passes");
  assert(validateTool({ toolKey: "proof-vault", name: "X", kind: "custom", status: "active" }).some((e) => e.path.endsWith(".toolKey")), "bad tool key shape rejected");
  assert(validateTool({ toolKey: "tool.x", name: "X", kind: "weird", status: "active" }).some((e) => e.path.endsWith(".kind")), "unknown kind rejected");
  assert(validateTool({ toolKey: "tool.launch", name: "Launcher", kind: "custom", status: "active", reversible: false, requiresApproval: false }).some((e) => e.message.includes("requires_approval")), "irreversible-without-approval rejected (safety invariant)");

  // ── eval cases ──
  assert(validateEvalCase({ agentKey: "ad-ops", name: "c1", input: "scenario", assertion: "asserts", kind: "output_contains", severity: "critical" }).length === 0, "valid eval case passes");
  assert(validateEvalCase({ agentKey: "ad-ops", name: "c1", input: "", assertion: "x", kind: "manual" }).some((e) => e.path.endsWith(".input")), "missing input rejected");
  assert(validateEvalCase({ agentKey: "a", name: "n", input: "i", assertion: "x", kind: "nope" }).some((e) => e.path.endsWith(".kind")), "unknown eval kind rejected");

  // ── assertValid throws ──
  let threw = false;
  try { assertValid(validateAgent({ key: "x", name: "", model: "bad", backend: "claude-agent-sdk", autonomy: "propose" }), "test"); } catch { threw = true; }
  assert(threw, "assertValid throws on errors");
  let ok = true;
  try { assertValid([], "test"); } catch { ok = false; }
  assert(ok, "assertValid is a no-op when valid");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
