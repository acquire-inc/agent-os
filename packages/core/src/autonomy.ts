// Autonomy gate — pure functions. Decides whether a given tool call is allowed
// outright, must be proposed to a human for approval, or denied. Backend-agnostic:
// works for the Anthropic Agent SDK's PreToolUse hook, a Hermes executor wrapper,
// or any future agent runtime.

/** Tool-name verbs that are always reversible — never gate-protect. */
const READ_ONLY_VERBS = new Set([
  "read", "get", "list", "search", "query", "fetch", "peek", "describe", "check",
  "scan", "view", "find", "preview", "resolve", "compute", "estimate", "head",
  "stat", "lookup", "show", "select", "watch", "stream",
]);

/** Extract the leading verb from a tool name like "close.update_lead". */
export function parseToolVerb(toolName: string): string {
  const action = toolName.split(".").slice(-1)[0] ?? toolName;
  return (action.split(/[_:-]/)[0] ?? action).toLowerCase();
}

export interface IrreversibilityCtx {
  toolName: string;
  autonomy: string;
  escalationPolicy?: string | null;
}

/**
 * Heuristic irreversibility check. Read-only verbs (read/get/list/search/...) are
 * always reversible. The escalation policy can include `always_allow: tool1,tool2`
 * to override irreversibility for specific tools the operator has pre-approved.
 */
export function isIrreversibleTool(ctx: IrreversibilityCtx): boolean {
  const ep = (ctx.escalationPolicy ?? "").toLowerCase();
  const allowMatch = ep.match(/always[_-]?allow\s*:\s*([^\n]+)/);
  if (allowMatch?.[1]) {
    const list = allowMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (list.some((t) => ctx.toolName.toLowerCase() === t)) return false;
  }
  return !READ_ONLY_VERBS.has(parseToolVerb(ctx.toolName));
}

export type GateDecision = "allow" | "propose" | "deny";

/**
 * The PreToolUse gate. Per the master doc:
 *  - execute_full → auto-runs narrow pre-approved scopes (we model as: allow all)
 *  - execute_safe → auto-runs reversible; PROPOSES irreversible
 *  - propose     → auto-runs reversible; PROPOSES irreversible (same shape as above;
 *                   distinguished by intent — `propose` is the conservative default)
 * `deny` is reserved for future explicit deny-lists (e.g. policy-blocked tools).
 */
export function autonomyGate(ctx: IrreversibilityCtx): GateDecision {
  if (ctx.autonomy === "execute_full") return "allow";
  return isIrreversibleTool(ctx) ? "propose" : "allow";
}

/** Default Approval option set for a proposed tool call (1A allow once / 1B
 *  always for this run / none deny). The dashboard + Slack mirror render these. */
export function buildApprovalOptions(toolName: string): { key: string; label: string }[] {
  return [
    { key: "1A", label: `Allow ${toolName} this once` },
    { key: "1B", label: `Always allow ${toolName} for this run` },
    { key: "none", label: "Deny" },
  ];
}
