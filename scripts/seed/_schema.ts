// scripts/seed/_schema.ts
// v3 enhancement G — lightweight, zero-dependency record validation for seeded DATA.
// The uploaded agentic-templates repo validates every build spec against JSON Schema before
// acting (build_lib/spec_io.assert_valid). We do the same for our registry records: catch
// drift (bad model slug, missing prompt, unknown autonomy, stray tool kind) at seed time
// instead of at runtime. Pure functions; no deps so the seeders stay fast.

export type ValidationError = { path: string; message: string };

const AUTONOMY = new Set(["propose", "execute_safe", "execute_full"]);
const BACKENDS = new Set(["claude-agent-sdk", "managed-agents"]);
const TOOL_KINDS = new Set(["custom", "mcp"]);
const TOOL_STATUS = new Set(["planned", "active", "deprecated"]);
const EVAL_KINDS = new Set(["output_contains", "tool_called", "no_tool", "refusal", "manual"]);
const SEVERITIES = new Set(["normal", "critical"]);
// Allowed model slugs (CLAUDE.md tier table + the live Hermes override). Keep in sync with doctrine.
const MODELS = new Set([
  "nousresearch/hermes-4-405b",
  "nousresearch/hermes-4-70b",
  "nousresearch/hermes-2-pro-llama-3-8b",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4-5",
]);

const KEY_RE = /^[a-z0-9][a-z0-9.-]*$/; // kebab/dotted lowercase keys

function req(obj: Record<string, unknown>, field: string, errs: ValidationError[], path: string) {
  const v = obj[field];
  if (v === undefined || v === null || v === "") errs.push({ path: `${path}.${field}`, message: "required" });
}

export interface AgentRecord {
  key: string; name: string; model: string; backend: string; autonomy: string;
  systemPrompt?: string; budgetCapUsd?: number | null;
}

/** Validate an agent registry record. Returns [] when valid. */
export function validateAgent(a: AgentRecord): ValidationError[] {
  const e: ValidationError[] = [];
  const p = `agent[${a.key ?? "?"}]`;
  req(a as never, "key", e, p); req(a as never, "name", e, p); req(a as never, "model", e, p);
  if (a.key && !KEY_RE.test(a.key)) e.push({ path: `${p}.key`, message: `must match ${KEY_RE}` });
  if (a.model && !MODELS.has(a.model)) e.push({ path: `${p}.model`, message: `unknown model slug '${a.model}'` });
  if (a.backend && !BACKENDS.has(a.backend)) e.push({ path: `${p}.backend`, message: `unknown backend '${a.backend}'` });
  if (a.autonomy && !AUTONOMY.has(a.autonomy)) e.push({ path: `${p}.autonomy`, message: `unknown autonomy '${a.autonomy}'` });
  if (a.systemPrompt !== undefined && a.systemPrompt.trim().length < 20)
    e.push({ path: `${p}.systemPrompt`, message: "system prompt too short (<20 chars)" });
  if (a.budgetCapUsd != null && (a.budgetCapUsd < 0 || a.budgetCapUsd > 1000))
    e.push({ path: `${p}.budgetCapUsd`, message: "budget cap out of range [0,1000]" });
  return e;
}

export interface ToolRecord {
  toolKey: string; name: string; kind: string; status: string;
  requiresApproval?: boolean; reversible?: boolean;
}

/** Validate a tool catalog record. */
export function validateTool(t: ToolRecord): ValidationError[] {
  const e: ValidationError[] = [];
  const p = `tool[${t.toolKey ?? "?"}]`;
  req(t as never, "toolKey", e, p); req(t as never, "name", e, p);
  if (t.toolKey && !/^tool\.[a-z0-9][a-z0-9-]*$/.test(t.toolKey))
    e.push({ path: `${p}.toolKey`, message: "must look like tool.<key>" });
  if (t.kind && !TOOL_KINDS.has(t.kind)) e.push({ path: `${p}.kind`, message: `unknown kind '${t.kind}'` });
  if (t.status && !TOOL_STATUS.has(t.status)) e.push({ path: `${p}.status`, message: `unknown status '${t.status}'` });
  // Safety invariant: an irreversible tool must require approval (defense in depth).
  if (t.reversible === false && t.requiresApproval === false)
    e.push({ path: `${p}`, message: "irreversible tool must requires_approval=true" });
  return e;
}

export interface EvalRecord {
  agentKey: string; name: string; input: string; assertion: string; kind: string; severity?: string;
}

/** Validate an eval-case record. */
export function validateEvalCase(c: EvalRecord): ValidationError[] {
  const e: ValidationError[] = [];
  const p = `eval[${c.agentKey ?? "?"}/${c.name ?? "?"}]`;
  req(c as never, "agentKey", e, p); req(c as never, "name", e, p);
  req(c as never, "input", e, p); req(c as never, "assertion", e, p);
  if (c.kind && !EVAL_KINDS.has(c.kind)) e.push({ path: `${p}.kind`, message: `unknown kind '${c.kind}'` });
  if (c.severity && !SEVERITIES.has(c.severity)) e.push({ path: `${p}.severity`, message: `unknown severity '${c.severity}'` });
  return e;
}

/** Throw with a readable summary if any errors exist. Used by seeders (fail loud). */
export function assertValid(errors: ValidationError[], context: string): void {
  if (errors.length === 0) return;
  const lines = errors.slice(0, 20).map((e) => `  - ${e.path}: ${e.message}`).join("\n");
  throw new Error(`${context}: ${errors.length} validation error(s)\n${lines}`);
}
