// Enumerations shared across the Agent OS object model (Master doc Part III–V).

export const TENANT_TYPES = ["internal", "client"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const AGENT_BACKENDS = ["claude-agent-sdk", "codex", "gemini"] as const;
export type AgentBackend = (typeof AGENT_BACKENDS)[number];

export const AUTONOMY_LEVELS = ["propose", "execute_safe", "execute_full"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

// ── Can't-fail agents (CLAUDE.md "ALWAYS Claude (T-critical), never Hermes") ──
// High-stakes judgment + safety roles. The doctrine's intent was "run these on Claude." The
// active operator override (2026-05) runs the WHOLE fleet on Hermes 4 405B and explicitly
// supersedes the "never Hermes" rule — so we DON'T re-tier these back to Claude (that needs an
// explicit operator instruction). Instead, the compensating control that makes Hermes-on-can't-
// fail safe is enforced in CODE: a can't-fail agent may never be AUTO-promoted past `propose`
// (every irreversible action keeps hitting the Approvals inbox). Safety comes from the runtime
// gate, not the model — exactly the doctrine's "safety via hooks" principle. Single source of
// truth for the list (was prose-only in CLAUDE.md + scattered roster comments).
export const CANT_FAIL_AGENTS = [
  "ad-claim-compliance",
  "tenant-isolation-tester",
  "security-anomaly-watchdog",
  "access-auditor",
  "contract-drafter",
  "contract-lifecycle-manager",
  "pricing-architect",
  "discount-governor",
  "decision-memo-drafter",
  "offer-architect",
  "offer-validator",
  "reinvestment-advisor",
  "risk-register-keeper",
  "cliently.dev",
] as const;
export type CantFailAgent = (typeof CANT_FAIL_AGENTS)[number];

/** Is this agent on the can't-fail list? (high-stakes judgment/safety → human gate required) */
export function isCantFailAgent(key: string): boolean {
  return (CANT_FAIL_AGENTS as readonly string[]).includes(key);
}

/**
 * The highest autonomy an agent may EARN from eval metrics (auto-promotion ceiling).
 * Can't-fail agents are capped at `propose` — they can never auto-promote out of the human
 * approval gate, regardless of how good their scorecard looks. (An operator can still set a
 * higher autonomy by hand; this only bounds *automatic* promotion.) All other agents have the
 * full ladder available.
 */
export function maxAutonomyForAgent(key: string): Autonomy {
  return isCantFailAgent(key) ? "propose" : "execute_full";
}

export const THINKING_LEVELS = ["none", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const RUNNER_KINDS = ["local", "remote"] as const;
export type RunnerKind = (typeof RUNNER_KINDS)[number];

// Run lifecycle (Master doc §2.2)
export const RUN_STATUSES = [
  "scheduled",
  "running",
  "done",
  "failed",
  "skipped",
  "waiting",
  "pending",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TRIGGER_SOURCES = ["schedule", "manual", "routine", "api"] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const ROUTINE_CADENCES = ["daily", "weekly", "monthly", "cron"] as const;
export type RoutineCadence = (typeof ROUTINE_CADENCES)[number];

export const SKILL_SOURCES = ["github", "builtin", "custom"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export const SCOPES = ["global", "project"] as const;
export type Scope = (typeof SCOPES)[number];

export const MCP_TRANSPORTS = ["stdio", "http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_AUTH_TYPES = ["none", "api_key", "oauth"] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];

export const CONNECTION_STATUSES = [
  "connected",
  "needs_reauth",
  "disconnected",
  "error",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const DOC_SOURCES = [
  "upload",
  "drive-sync",
  "agent-generated",
  "call-transcript",
] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

export const APPROVAL_STATUSES = ["open", "decided", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const API_KEY_KINDS = ["runner", "external", "admin"] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

export const REF_TYPES = ["doc", "skill", "mcp", "database", "envvar"] as const;
export type RefType = (typeof REF_TYPES)[number];

// Starter function-tag taxonomy (Master doc §Tag taxonomy)
export const STARTER_TAGS = [
  "meta",
  "marketing",
  "sales",
  "systems",
  "ops",
  "dev",
  "content",
  "finance",
  "client-success",
  "creative",
  "research",
] as const;
