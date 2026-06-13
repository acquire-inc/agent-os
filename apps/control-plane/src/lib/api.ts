// Thin client for the Hono API (apps/api). Reads the admin API key from
// localStorage so an operator can paste their key on /settings and the UI
// can call /api/admin/* routes. Falls back to demo-disabled state if absent.

const KEY_STORAGE = "aos-admin-api-key";
const URL_STORAGE = "aos-api-url";
const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export function getApiUrl(): string {
  return (typeof localStorage !== "undefined" && localStorage.getItem(URL_STORAGE)) || DEFAULT_API_URL;
}
export function setApiUrl(url: string) {
  localStorage.setItem(URL_STORAGE, url);
}
export function getAdminKey(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(KEY_STORAGE) : null;
}
export function setAdminKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key);
}
export function clearAdminKey() {
  localStorage.removeItem(KEY_STORAGE);
}
export function hasAdminKey(): boolean {
  return Boolean(getAdminKey());
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = getAdminKey();
  if (!key)
    throw new ApiError(401, "No admin API key set — paste one on /settings.");
  const res = await fetch(`${getApiUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (data as { error?: string; code?: string } | null) ?? {};
    throw new ApiError(res.status, err.error ?? `HTTP ${res.status}`, err.code);
  }
  return data as T;
}

// ---------- Architect ----------

export interface AgentBlueprintRow {
  tenantId: string;
  key: string;
  name: string;
  systemPrompt: string;
  model: string;
  thinkingLevel?: "low" | "medium" | "high";
  autonomy: "propose" | "execute_safe" | "execute_full";
  knowledgeScope: { folders: string[]; tags: string[] };
  budgetCapUsd: string;
  cron?: { schedule: string; jobName: string } | null;
  skills: { key: string; name: string }[];
  mcpNames: string[];
  enabled?: boolean;
}

export interface Blueprint {
  id: string;
  tenantId: string;
  prompt: string;
  teamName: string;
  rationale: string;
  agents: AgentBlueprintRow[];
  warnings: string[];
  proposedSkills: { key: string; name: string; why: string }[];
  proposedMcps: { name: string; why: string }[];
  llmModel: string;
  llmCostUsd: number;
  status: "proposed" | "approved" | "seeded" | "rejected" | "superseded";
  createdAt: string;
}

// Phase 64: model suggestion threaded from the API per agent so the
// architect UI can surface why a given model was picked.
export interface ModelSuggestion {
  recommendedModel: string;
  rationale: string;
  llmEmittedModel: string | null;
  alternatives: Array<{
    slug: string;
    capabilityMatchScore: number;
    costIndex: number;
  }>;
}

export type ProposeResponse = { blueprint: Blueprint; modelSuggestions?: Record<string, ModelSuggestion | null> };

export const architect = {
  propose: (args: { prompt: string; mode?: "team" | "single" | "remix"; baseAgentKey?: string }) =>
    call<ProposeResponse>("POST", "/api/admin/architect/propose", args),
  remix: (baseAgentKey: string, instruction: string) =>
    call<ProposeResponse>("POST", "/api/admin/architect/propose", {
      prompt: instruction,
      mode: "remix",
      baseAgentKey,
    }),
  list: () => call<{ blueprints: Blueprint[] }>("GET", "/api/admin/architect/blueprints?limit=30"),
  get: (id: string) => call<{ blueprint: Blueprint }>("GET", `/api/admin/architect/blueprints/${id}`),
  seed: (blueprintId: string) =>
    call<{ blueprintId: string; seeded: { key: string; agentId: string; autonomy: string; enabled: boolean }[] }>(
      "POST",
      "/api/admin/architect/seed",
      { blueprintId },
    ),
};

// ---------- Tier overrides (Phase 65) ----------

export interface TierOverrideRow {
  tier: "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical";
  defaultModel: string;
  override: string | null;
  effective: string;
  pinned: boolean;
}

export const tierOverrides = {
  list: () => call<{ tiers: TierOverrideRow[] }>("GET", "/api/admin/tenants/me/tier-overrides"),
  set: (tier: TierOverrideRow["tier"], model: string | null) =>
    call<{ tenant: { id: string; tierOverrides: Record<string, string> } }>(
      "PUT",
      "/api/admin/tenants/me/tier-overrides",
      { tier, model },
    ),
};

// ---------- Scorecard thresholds (I-001 / B6) ----------

export type ScorecardThresholdKey =
  | "minSampleSize"
  | "minApprovalRateForPromote"
  | "minVerificationRate"
  | "minVerificationRateForPromote"
  | "maxCostUtilization"
  | "maxCostUtilizationForPromote"
  | "maxFindingsRatePerRun"
  | "maxScopeLockRefusalsPerRun"
  | "maxOutputQualityFailureRate";

export type ScorecardThresholds = Record<ScorecardThresholdKey, number>;
export type ScorecardThresholdPatch = Partial<ScorecardThresholds>;

export const scorecardThresholds = {
  get: () =>
    call<{
      defaults: ScorecardThresholds;
      override: ScorecardThresholdPatch;
      effective: ScorecardThresholds;
    }>("GET", "/api/admin/tenants/me/scorecard-thresholds"),
  set: (patch: ScorecardThresholdPatch) =>
    call<{
      tenant: { id: string };
      override: ScorecardThresholdPatch;
      effective: ScorecardThresholds;
    }>("PUT", "/api/admin/tenants/me/scorecard-thresholds", patch),
};
