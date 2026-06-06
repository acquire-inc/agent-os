// Drizzle schema mirroring supabase/migrations/0001_init.sql (Master doc Part V).
// The SQL migration is the deploy source of truth; this gives typed queries.
import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().default("internal"),
  status: text("status").notNull().default("active"),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 12, scale: 2 }),
  // DEPRECATED — use tierOverrides for per-tier control. This blunt-instrument
  // column applies to all non-critical tiers when set; tierOverrides wins when
  // both are present. Migration 0009 (autonomous-team), superseded by 0013.
  defaultModelOverride: text("default_model_override"),
  // Per-tier per-tenant model override. Shape:
  //   { "T-cheap": "deepseek/deepseek-v3", "T-reason": "nousresearch/hermes-4-405b" }
  // T-critical is NEVER honored here — resolveModel() ignores it. Migration 0013.
  tierOverrides: jsonb("tier_overrides")
    .$type<Partial<Record<"T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical", string>>>()
    .notNull()
    .default({}),
  /** Phase 27: per-tenant scorecard threshold overrides. Shape mirrors
   *  ScorecardThresholds; partial — only the keys the tenant tunes. The
   *  scheduled scorecard job merges DEFAULT_THRESHOLDS with this jsonb
   *  before calling scoreAgent. Empty/null = use defaults verbatim. */
  scorecardThresholds: jsonb("scorecard_thresholds")
    .$type<Partial<{
      minSampleSize: number;
      minApprovalRateForPromote: number;
      minVerificationRate: number;
      minVerificationRateForPromote: number;
      maxCostUtilization: number;
      maxCostUtilizationForPromote: number;
      maxFindingsRatePerRun: number;
      maxScopeLockRefusalsPerRun: number;
      maxOutputQualityFailureRate: number;
    }>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
});

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const entityTags = pgTable(
  "entity_tags",
  {
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.entityId, t.tagId] })],
);

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  persona: text("persona"),
  backend: text("backend").notNull().default("claude-agent-sdk"),
  model: text("model").notNull().default("anthropic/claude-sonnet-4.6"),
  // Tier intent (declared); the router resolves this to `model` at seed time
  // via DEFAULT_TIER_MODELS + tenants.tier_overrides. Migration 0013.
  modelTier: text("model_tier").$type<
    "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical"
  >(),
  thinkingLevel: text("thinking_level").notNull().default("medium"),
  autonomy: text("autonomy").notNull().default("propose"),
  knowledgeScopeJson: jsonb("knowledge_scope_json").notNull().default({ folders: [], tags: [] }),
  budgetCapUsd: numeric("budget_cap_usd", { precision: 12, scale: 2 }),
  escalationPolicy: text("escalation_policy"),
  runnerKind: text("runner_kind").notNull().default("local"),
  enabled: boolean("enabled").notNull().default(true),
  // Richer state machine for autonomous-team operation. draft = new agent
  // awaiting approval; active = running normally; paused = temporarily off
  // (manager can resume); archived = retired (history kept). Migration 0009.
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  templateId: uuid("template_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectEntities = pgTable(
  "project_entities",
  {
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.entityType, t.entityId] })],
);

export const agentSkills = pgTable(
  "agent_skills",
  {
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.skillId] })],
);

export const agentMcps = pgTable(
  "agent_mcps",
  {
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    mcpId: uuid("mcp_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.mcpId] })],
);

// Mirrors supabase/migrations/0007_tools_registry.sql (agent_tools join).
export const agentTools = pgTable(
  "agent_tools",
  {
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.toolId] })],
);

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scheduleCron: text("schedule_cron").notNull(),
  instructions: text("instructions").notNull().default(""),
  modelOverride: text("model_override"),
  thinkingOverride: text("thinking_override"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobRefs = pgTable(
  "job_refs",
  {
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.refType, t.refId] })],
);

export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  status: text("status").notNull().default("scheduled"),
  triggerSource: text("trigger_source").notNull().default("schedule"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  claimedBy: text("claimed_by"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  summary: text("summary"),
  sdkSessionId: text("sdk_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const runActivity = pgTable("run_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
});

export const routines = pgTable("routines", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  cadence: text("cadence").notNull(),
  jobIds: uuid("job_ids").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
});

export const skills = pgTable("skills", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: text("version").notNull().default("0.1.0"),
  source: text("source").notNull().default("custom"),
  repoPath: text("repo_path"),
  scope: text("scope").notNull().default("global"),
  enabled: boolean("enabled").notNull().default(true),
  /** Phase 32: per-skill preferred model tier. When the agent invokes
   *  this skill, the router can fork to this tier for the sub-task.
   *  NULL = no preference; the agent's resolved model is used. T-critical
   *  agents ignore the preference (safety floor). Mirrors migration 0019. */
  preferredModelTier: text("preferred_model_tier").$type<
    "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical" | null
  >(),
  /** Phase 40: TaskProfile JSON for the intelligent model picker. Shape
   *  matches packages/core/src/router/intelligence.ts TaskProfile. Empty
   *  {} = no profile; the tier fork (preferredModelTier) applies instead. */
  taskProfile: jsonb("task_profile").$type<Record<string, unknown>>().notNull().default({}),
  /** Phase 52: estimated USD cost when this skill is dispatched as a
   *  sub-agent on a forked model. Used by the runner's sub-agent
   *  dispatcher (apps/runner/src/sub-agent.ts) to reserve before
   *  invoking. 0 = free/no estimate. Mirrors migration 0024. */
  costEstimateUsd: numeric("cost_estimate_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mcps = pgTable("mcps", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  transport: text("transport").notNull().default("http"),
  endpoint: text("endpoint"),
  authType: text("auth_type").notNull().default("none"),
  scope: text("scope").notNull().default("global"),
  status: text("status").notNull().default("disconnected"),
  lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Mirrors supabase/migrations/0007_tools_registry.sql (tools registry).
export const tools = pgTable("tools", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind").notNull(),
  mcpId: uuid("mcp_id").references(() => mcps.id, { onDelete: "set null" }),
  inputSchema: jsonb("input_schema").notNull().default({}),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  reversible: boolean("reversible").notNull().default(false),
  status: text("status").notNull().default("active"),
  /** Phase 26: per-invocation USD cost estimate. Used by the runner's
   *  reserve-before / commit-after wrapping in dispatchCustomTool. 0 means
   *  free / no estimate. Mirrors migration 0016. */
  costEstimateUsd: numeric("cost_estimate_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  /** Phase 32: per-tool preferred model tier. When the agent invokes
   *  this tool, the router can fork to this tier. NULL = no preference;
   *  the agent's resolved model is used. T-critical agents ignore the
   *  preference (safety floor). Mirrors migration 0019. */
  preferredModelTier: text("preferred_model_tier").$type<
    "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical" | null
  >(),
  /** Phase 40: TaskProfile JSON for the intelligent model picker. Same
   *  shape as skills.taskProfile. */
  taskProfile: jsonb("task_profile").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const oauthCredentials = pgTable("oauth_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  mcpId: uuid("mcp_id").notNull().references(() => mcps.id, { onDelete: "cascade" }),
  vaultRef: text("vault_ref").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("connected"),
});

export const envVars = pgTable("env_vars", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  key: text("key").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  pinned: boolean("pinned").notNull().default(false),
});

export const knowledgeFolders = pgTable("knowledge_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  path: text("path").notNull(),
});

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  folderId: uuid("folder_id").references(() => knowledgeFolders.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("markdown"),
  source: text("source").notNull().default("upload"),
  vectorNamespace: text("vector_namespace"),
  vectorIndexed: boolean("vector_indexed").notNull().default(false),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const docChunks = pgTable("doc_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  vectorNamespace: text("vector_namespace"),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
});

export const databases = pgTable("databases", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  schemaJson: jsonb("schema_json").notNull().default({}),
});

export const databaseRows = pgTable("database_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  rowJson: jsonb("row_json").notNull().default({}),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  context: text("context").notNull(),
  proposedAction: text("proposed_action").notNull(),
  optionsJson: jsonb("options_json").notNull().default([]),
  status: text("status").notNull().default("open"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentPrompts = pgTable("agent_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  systemPrompt: text("system_prompt").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentTriggers = pgTable("agent_triggers", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  schedule: text("schedule"),
  eventKey: text("event_key"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const autonomyEvents = pgTable("autonomy_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  kind: text("kind").notNull(),
  toolName: text("tool_name"),
  rationale: text("rationale"),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  toolName: text("tool_name").notNull(),
  inputHash: text("input_hash"),
  result: text("result"),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Architect blueprints — proposed agent teams awaiting operator review/seed.
 * Spec: docs/specs/agent-architect.md
 */
export const architectBlueprints = pgTable("architect_blueprints", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id"),
  prompt: text("prompt").notNull(),
  teamName: text("team_name").notNull(),
  rationale: text("rationale").notNull(),
  llmModel: text("llm_model").notNull(),
  llmCostUsd: numeric("llm_cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("proposed"),
  warningsJson: jsonb("warnings_json").notNull().default([]),
  agentsJson: jsonb("agents_json").notNull(),
  proposedSkillsJson: jsonb("proposed_skills_json").notNull().default([]),
  proposedMcpsJson: jsonb("proposed_mcps_json").notNull().default([]),
  seededAgentIds: jsonb("seeded_agent_ids").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Security findings — durable artifact every Phase-9 security agent writes.
 * One table; per-category structure lives in payload jsonb (CONTEXT D-05).
 * Mirrors supabase/migrations/0010_security_findings.sql.
 */
export const securityFindings = pgTable("security_findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  category: text("category").$type<"isolation" | "rotation" | "access" | "anomaly">().notNull(),
  severity: text("severity").$type<"low" | "medium" | "high" | "critical">().notNull(),
  status: text("status").$type<"open" | "acknowledged" | "resolved" | "suppressed">().notNull().default("open"),
  title: text("title").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Relay events — the unified event bus. Every meaningful state change in the OS
 * lands here exactly once. Mirrors supabase/migrations/0011_relay_events.sql.
 * Schema contract: docs/plans/AGENT-OS-PLAN.md §8.2. Closed event-name namespace
 * lives in packages/core/src/relay/events.ts (code-enforced via emit()).
 */
export const relayEvents = pgTable("relay_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
  actor: text("actor").$type<"agent" | "system" | "human" | "external">().notNull(),
  actorId: text("actor_id"),
  eventName: text("event_name").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  correlationId: uuid("correlation_id"),
  causationId: uuid("causation_id"),
  eventKey: text("event_key"),
  consentScope: text("consent_scope")
    .$type<"tenant_only" | "cross_tenant_aggregated">()
    .notNull()
    .default("tenant_only"),
  piiClass: text("pii_class")
    .$type<"none" | "internal_id" | "client_pii">()
    .notNull()
    .default("none"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Run summaries — the P0 outcome surface. One row per terminal run, composed at
 * SessionEnd by composeRunSummary(). Mirrors supabase/migrations/0012_run_summaries.sql.
 * Schema contract: docs/plans/AGENT-OS-PLAN.md §8.2.
 */
export const runSummaries = pgTable("run_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id")
    .notNull()
    .unique()
    .references(() => runs.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  status: text("status")
    .$type<"done" | "failed" | "escalated" | "skipped" | "quarantined">()
    .notNull(),
  deliverableKind: text("deliverable_kind"),
  deliverableRef: text("deliverable_ref"),
  evidencePaths: jsonb("evidence_paths").$type<string[]>().notNull().default([]),
  costActualUsd: numeric("cost_actual_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  findingCount: integer("finding_count").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  approvalCount: integer("approval_count").notNull().default(0),
  summaryText: text("summary_text"),
  highlights: jsonb("highlights").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  consentScope: text("consent_scope")
    .$type<"tenant_only" | "cross_tenant_aggregated">()
    .notNull()
    .default("tenant_only"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Phase 31: budget_reservations — transient per-run reservation ledger.
 * Survives runner restart so in-flight reservations can be re-hydrated.
 * Mirrors supabase/migrations/0018_budget_reservations.sql.
 */
export const budgetReservations = pgTable("budget_reservations", {
  id: text("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 4 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Phase 20: agent_scorecards — persisted output of the eval scorecard job.
 * Mirrors supabase/migrations/0014_agent_scorecards.sql.
 */
export const agentScorecards = pgTable("agent_scorecards", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  agentKey: text("agent_key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  sampleSize: integer("sample_size").notNull(),
  verificationRate: numeric("verification_rate", { precision: 7, scale: 6 }),
  approvalRate: numeric("approval_rate", { precision: 7, scale: 6 }),
  avgCostUtilization: numeric("avg_cost_utilization", { precision: 7, scale: 6 }),
  findingsRatePerRun: numeric("findings_rate_per_run", { precision: 10, scale: 6 }),
  scopeLockRefusalsPerRun: numeric("scope_lock_refusals_per_run", { precision: 10, scale: 6 }),
  outputQualityFailureRate: numeric("output_quality_failure_rate", { precision: 7, scale: 6 }),
  cantfailEvents: integer("cantfail_events").notNull().default(0),
  verdict: text("verdict")
    .$type<"promote" | "hold" | "demote" | "force_demote_safety" | "insufficient_data">()
    .notNull(),
  rationale: text("rationale").notNull(),
  triggeredThresholds: jsonb("triggered_thresholds").$type<string[]>().notNull().default([]),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedAutonomy: text("applied_autonomy"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Phase 38: model catalog. Cost-per-token + per-task capability scores for
 * every model the platform can dispatch to. Mirrors supabase/migrations/
 * 0020_model_catalog.sql. Powers the Phase 39 pickBestModel scoring.
 */
export const models = pgTable("models", {
  slug: text("slug").primaryKey(),
  provider: text("provider").notNull(),
  family: text("family").notNull(),
  generation: text("generation").notNull(),
  status: text("status")
    .$type<"preferred" | "secondary" | "deprecated" | "experimental">()
    .notNull()
    .default("preferred"),
  costInputPerMillionUsd: numeric("cost_input_per_million_usd", { precision: 12, scale: 4 }).notNull(),
  costOutputPerMillionUsd: numeric("cost_output_per_million_usd", { precision: 12, scale: 4 }).notNull(),
  contextWindowTokens: integer("context_window_tokens").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  supportsTools: boolean("supports_tools").notNull().default(true),
  supportsReasoning: boolean("supports_reasoning").notNull().default(false),
  supportsVision: boolean("supports_vision").notNull().default(false),
  supportsStreaming: boolean("supports_streaming").notNull().default(true),
  /** Per-task scores 0..10. Canonical keys: reasoning, tool_use,
   *  classification, summarization, code_generation, multilingual, vision,
   *  long_context, factuality, latency_sensitivity. Absent keys default
   *  to neutral 5 in the scorer. */
  capabilityScores: jsonb("capability_scores")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  /** Which tier this model is canonical for under the legacy tier router. */
  tierAffinity: text("tier_affinity").$type<
    "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical" | null
  >(),
  latencyP50Ms: integer("latency_p50_ms"),
  enabled: boolean("enabled").notNull().default(true),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Phase 45: model_feedback_proposals — pending and historical proposed
 * updates to models.capability_scores produced by aggregateModelObservations.
 * Mirrors supabase/migrations/0022_model_feedback_proposals.sql.
 */
export const modelFeedbackProposals = pgTable("model_feedback_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  modelSlug: text("model_slug").notNull().references(() => models.slug, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  currentScore: numeric("current_score", { precision: 4, scale: 2 }).notNull(),
  observedScore: numeric("observed_score", { precision: 4, scale: 2 }).notNull(),
  proposedScore: numeric("proposed_score", { precision: 4, scale: 2 }).notNull(),
  sampleSize: integer("sample_size").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status")
    .$type<"pending" | "applied" | "rejected" | "superseded">()
    .notNull()
    .default("pending"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedBy: text("applied_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Phase 47: artifacts — output files / structured payloads / external
 * links produced by an agent run. The runner / executor writes one row
 * per artifact at run close so the front-end's "output type of interface"
 * can render everything an agent produced.
 *
 * Mirrors supabase/migrations/0023_artifacts.sql.
 */
export const artifacts = pgTable("artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  /** Canonical kind hint: file | doc | spreadsheet | image | link |
   *  json | markdown | code. The front-end picks a renderer from this. */
  kind: text("kind").notNull(),
  /** Display name (e.g. "Q3 revenue.xlsx"). */
  name: text("name").notNull(),
  /** Storage URI or absolute path (s3://, file://, https://). NULL when
   *  the payload is inline. */
  uri: text("uri"),
  /** Inline payload — small artifacts (under a few KB) ride here so the
   *  front-end can render without a second fetch. NULL when uri is set. */
  inlinePayload: jsonb("inline_payload").$type<Record<string, unknown>>(),
  /** Free-form metadata: { byteSize, contentType, generatedBy, ... } */
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
