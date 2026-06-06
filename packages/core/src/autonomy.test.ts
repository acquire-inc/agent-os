// Pure test for the autonomy gate's tool-name reasoning, esp. MCP runtime names. No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/autonomy.test.ts
import { parseToolVerb, isIrreversibleTool, autonomyGate } from "./autonomy.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // ── parseToolVerb understands the shapes the SDK reports ──
  assert(parseToolVerb("mcp__close__list_leads") === "list", "MCP read op → 'list' (was wrongly 'mcp')");
  assert(parseToolVerb("mcp__close__create_lead") === "create", "MCP write op → 'create'");
  assert(parseToolVerb("mcp__pipeboard-meta__get_insights") === "get", "MCP read op with hyphenated server → 'get'");
  assert(parseToolVerb("close.update_lead") === "update", "dotted connector name → 'update'");
  assert(parseToolVerb("tool.dunning-engine") === "dunning", "custom tool key → leading word");
  assert(parseToolVerb("Read") === "read", "SDK built-in → 'read'");

  // ── the practical consequence: MCP READS must NOT gate (Wave-1 agents read constantly) ──
  const readCtx = { toolName: "mcp__close__list_leads", autonomy: "execute_safe" };
  assert(!isIrreversibleTool(readCtx), "an MCP read is reversible (no approval)");
  assert(autonomyGate(readCtx) === "allow", "MCP read auto-allows under execute_safe (no approval storm)");

  // ── MCP writes DO gate under execute_safe/propose ──
  assert(isIrreversibleTool({ toolName: "mcp__close__create_lead", autonomy: "execute_safe" }), "an MCP write is irreversible");
  assert(autonomyGate({ toolName: "mcp__close__create_lead", autonomy: "execute_safe" }) === "propose", "MCP write proposes under execute_safe");

  // ── registry requires_approval stays authoritative over the heuristic ──
  assert(isIrreversibleTool({ toolName: "mcp__close__list_leads", autonomy: "execute_safe", requiresApproval: true }), "registry requires_approval overrides a read-verb");
  assert(!isIrreversibleTool({ toolName: "tool.cash-feed", autonomy: "execute_safe", requiresApproval: false }), "registry reversible overrides a non-read custom-tool name");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
