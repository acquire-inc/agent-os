import type {
  AgentBackend,
  ApiKeyKind,
  ApprovalStatus,
  Autonomy,
  ConnectionStatus,
  DocSource,
  McpAuthType,
  McpTransport,
  MemberRole,
  RoutineCadence,
  RunStatus,
  RunnerKind,
  Scope,
  SkillSource,
  TenantType,
  ThinkingLevel,
  TriggerSource,
} from "./enums.js";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: TenantType;
  status: "active" | "suspended";
  monthlyBudgetUsd: number | null;
  createdAt: string;
}

export interface TenantMember {
  tenantId: string;
  userId: string;
  role: MemberRole;
}

export interface Profile {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
}

export interface Tag {
  id: string;
  tenantId: string;
  name: string;
}

export interface KnowledgeScope {
  folders: string[];
  tags: string[];
}

export interface Agent {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  persona: string | null;
  backend: AgentBackend;
  model: string;
  thinkingLevel: ThinkingLevel;
  autonomy: Autonomy;
  knowledgeScope: KnowledgeScope;
  budgetCapUsd: number | null;
  escalationPolicy: string | null;
  runnerKind: RunnerKind;
  enabled: boolean;
  templateId: string | null;
  // Derived/joined fields for the UI
  projectIds?: string[];
  tags?: string[];
  skillKeys?: string[];
  mcpKeys?: string[];
}

export interface Job {
  id: string;
  tenantId: string;
  agentId: string;
  name: string;
  scheduleCron: string;
  instructions: string;
  modelOverride: string | null;
  thinkingOverride: ThinkingLevel | null;
  enabled: boolean;
  tags?: string[];
}

export interface Run {
  id: string;
  tenantId: string;
  agentId: string;
  jobId: string | null;
  status: RunStatus;
  triggerSource: TriggerSource;
  scheduledFor: string | null;
  claimedBy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  summary: string | null;
  sdkSessionId: string | null;
}

export interface RunActivity {
  id: string;
  runId: string;
  ts: string;
  kind: string;
  message: string;
}

export interface Routine {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  cadence: RoutineCadence;
  jobIds: string[];
  enabled: boolean;
}

export interface Skill {
  id: string;
  tenantId: string;
  projectId: string | null;
  key: string;
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  repoPath: string | null;
  scope: Scope;
  enabled: boolean;
  tags?: string[];
}

export interface Mcp {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  transport: McpTransport;
  endpoint: string | null;
  authType: McpAuthType;
  scope: Scope;
  status: ConnectionStatus;
  lastHealthCheck: string | null;
  tags?: string[];
}

export interface OAuthCredential {
  id: string;
  tenantId: string;
  mcpId: string;
  vaultRef: string;
  scopes: string[];
  expiresAt: string | null;
  status: ConnectionStatus;
}

export interface KnowledgeFolder {
  id: string;
  tenantId: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  path: string;
}

export interface Document {
  id: string;
  tenantId: string;
  projectId: string | null;
  folderId: string | null;
  name: string;
  type: string;
  source: DocSource;
  vectorNamespace: string | null;
  vectorIndexed: boolean;
  version: number;
  updatedAt: string;
  tags?: string[];
}

export interface ApprovalOption {
  key: string; // "1A", "2B", "none"
  label: string;
}

export interface Approval {
  id: string;
  runId: string;
  tenantId: string;
  agentId: string;
  context: string;
  proposedAction: string;
  options: ApprovalOption[];
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  /** V2 P6 — 'human' for operator decisions (default), 'critic_quorum' when
   *  the peer layer auto-approved. Optional for back-compat with rows that
   *  predate migration 0028. */
  decidedVia?: "human" | "critic_quorum";
  /** V2 P6 — set when a critic rejection bounced this proposal back to the
   *  human inbox. The approval stays open; this flag surfaces "a peer
   *  flagged this" in the UI. */
  escalated?: boolean;
  createdAt: string;
}

export interface CostDay {
  tenantId: string;
  projectId: string | null;
  agentId: string | null;
  day: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

// Phase 60-61: a single model-pick decision recorded in the relay_events
// stream. The control-plane Model Routing page renders these as a table so
// operators can see what model ran for which agent and why.
export interface ModelRoutingEvent {
  id: string;
  tenantId: string;
  agentId: string | null;
  runId: string | null;
  occurredAt: string;
  // Payload echoed from relay_events.payload — superset across audit-only
  // (applied=false; recommended_slug present) and realized (applied=true;
  // model_ran present) shapes.
  payload: {
    agent_model: string;
    applied: boolean;
    model_ran?: string;
    recommended_slug?: string;
    recommended_tier?: string;
    source?: string;
    task_label?: string;
    reason?: string;
    cost_usd?: number;
    tokens_in?: number;
    tokens_out?: number;
  };
}

// Phase 62: live tenant budget posture surfaced on the cost dashboard.
// Mirrors the /api/admin/tenants/me/budget-status response shape so the
// same model serves the API client and the SPA's direct-from-Supabase
// path.
export interface TenantBudgetStatus {
  capUsd: number | null;
  monthToDateUsd: number;
  remainingUsd: number | null;
  percentUsed: number;
  projectionEomUsd: number;
  level: "ok" | "warn" | "over";
}

// Agent performance dashboard (fleet throughput / reliability / cost). One
// daily point in the selected window.
export interface AgentPerfPoint {
  day: string; // YYYY-MM-DD (UTC)
  runs: number;
  failures: number;
  costUsd: number;
}

// Per-agent roll-up over the selected window — the leaderboard row.
export interface AgentPerfRow {
  agentId: string;
  runs: number;
  failures: number;
  successRate: number; // 0..1
  costUsd: number;
  avgCostUsd: number;
  avgDurationSec: number;
  lastActiveIso: string | null;
}

export interface AgentPerformance {
  series: AgentPerfPoint[]; // fleet daily over the window (oldest → newest)
  prevTotals: { runs: number; failures: number; costUsd: number }; // previous equal-length window, for deltas
  byAgent: AgentPerfRow[];
}

// Fleet activity feed — one thing an agent did. The platform's visibility layer:
// what every agent is doing across connectors, in one stream.
export type FleetActivityKind = "tool" | "proposal" | "summary" | "start" | "status";

export interface FleetActivityItem {
  id: string;
  ts: string; // ISO
  agentId: string;
  runId: string | null;
  kind: FleetActivityKind;
  connector: string | null; // the tool/connector acted through, when kind === "tool"
  message: string;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  kind: ApiKeyKind;
  name: string;
  hashPreview: string;
  createdBy: string | null;
  createdAt: string;
}
