// packages/core/src/isolation-tester.ts — the deterministic tool behind tool.isolation-test-suite,
// used by the can't-fail tenant-isolation-tester agent (Gate 2: no external multi-tenant Cliently
// until this passes). Pure: the agent/runtime runs the cross-tenant probes (authenticated as tenant
// A, read tenant B's rows on every tenant-scoped table); this evaluates the results. The RLS
// guarantee holds ONLY if every probe returns ZERO rows AND every required table was actually
// probed — you can't claim isolation for a table you never tested (build-spec acceptance test).

/** Tenant-scoped tables whose cross-tenant read MUST return zero rows. Mirrors the `tenant_id`
 *  tables in the schema; newer tables (0009/0010) included — the historically under-audited ones. */
export const TENANT_SCOPED_TABLES = [
  "agents", "agent_prompts", "agent_skills", "agent_tools", "agent_mcps", "agent_triggers",
  "skills", "tools", "mcps", "jobs", "runs", "run_activity", "run_summaries", "approvals",
  "autonomy_events", "audit_log", "eval_cases", "agent_metrics", "documents", "doc_chunks",
  "knowledge_folders", "env_vars", "oauth_credentials", "api_keys",
  "tenant_credits", "usage_events", "credit_ledger",
] as const;

export interface IsolationProbe {
  table: string;
  /** Rows of ANOTHER tenant visible while authenticated as the probing tenant. Must be 0. */
  rowsVisibleCrossTenant: number;
}

export interface IsolationViolation { table: string; rows: number }

export interface IsolationResult {
  pass: boolean;
  decision: "pass" | "block";
  leaks: IsolationViolation[];      // tables that returned >0 cross-tenant rows
  unprobed: string[];               // required tables with no probe (unverified ⇒ not a pass)
  tablesProbed: number;
  summary: string;
}

/**
 * Evaluate cross-tenant isolation probes. PASS only when every probe is 0 rows AND every required
 * table was probed. Pure. A single leak OR an unprobed required table → BLOCK (P0).
 */
export function evaluateIsolation(
  probes: IsolationProbe[],
  opts: { requiredTables?: readonly string[] } = {},
): IsolationResult {
  const required = opts.requiredTables ?? TENANT_SCOPED_TABLES;
  const probed = new Set(probes.map((p) => p.table));
  const leaks = probes
    .filter((p) => p.rowsVisibleCrossTenant > 0)
    .map((p) => ({ table: p.table, rows: p.rowsVisibleCrossTenant }))
    .sort((a, b) => b.rows - a.rows);
  const unprobed = required.filter((t) => !probed.has(t));
  const pass = leaks.length === 0 && unprobed.length === 0;
  const summary = pass
    ? `PASS — cross-tenant read returned zero rows across all ${probed.size} tenant-scoped tables.`
    : `BLOCK (P0) — ${leaks.length ? `${leaks.length} table(s) LEAKED cross-tenant rows: ${leaks.map((l) => `${l.table}(${l.rows})`).join(", ")}. ` : ""}${unprobed.length ? `${unprobed.length} required table(s) UNPROBED: ${unprobed.join(", ")}.` : ""}`.trim();
  return { pass, decision: pass ? "pass" : "block", leaks, unprobed, tablesProbed: probed.size, summary };
}
