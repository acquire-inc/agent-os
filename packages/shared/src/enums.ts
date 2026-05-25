// Enumerations shared across the Agent OS object model (Master doc Part III–V).

export const TENANT_TYPES = ["internal", "client"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const AGENT_BACKENDS = ["claude-agent-sdk", "codex", "gemini"] as const;
export type AgentBackend = (typeof AGENT_BACKENDS)[number];

export const AUTONOMY_LEVELS = ["propose", "execute_safe", "execute_full"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

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
