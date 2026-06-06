// packages/core/src/model-registry.ts — MODEL INTELLIGENCE.
//
// A knowledge base of the models we can route to, scored on the capability axes that matter, plus
// the decision logic that picks the BEST-SUITED model for a task by comparing models — not by cost.
// This is what lets the fleet "deploy the optimal model for the specific task it does best."
//
// Two layers:
//   1. KNOWLEDGE — `MODEL_REGISTRY`: per-model capability scores (1-5), context window, strengths,
//      and reference pricing. Curated from current public model intelligence; refreshable from
//      OpenRouter (`applyOpenRouterPricing`) so the pricing/availability stays congruent over time.
//   2. DECISION — `rankModelsForTask` / `selectBestModel`: score each ELIGIBLE model against a task
//      profile's capability weights and pick the highest fit. Explainable (returns the ranking +
//      why), comparable (see how each model stacks up), and safe (can't-fail tasks never route to a
//      non-Claude model).
//
// Selection is capability-driven. Pricing is carried as reference knowledge (and for the OpenRouter
// refresh loop), NOT as a selection input.

/** The capability axes a task can care about (1 = weak, 5 = best-in-class among our candidates). */
export interface Capabilities {
  speed: number;        // latency / throughput for always-on, high-frequency work
  volume: number;       // fitness to run constantly at scale (throughput economics)
  reasoning: number;    // multi-step analysis / synthesis depth
  agentic: number;      // reliable multi-step tool orchestration
  coding: number;       // code generation + review quality
  judgment: number;     // high-stakes correctness + safety
  longContext: number;  // large-context retention
}

export interface ModelInfo {
  slug: string;                 // OpenRouter slug (the routed identifier)
  provider: "nousresearch" | "anthropic" | string;
  label: string;
  contextLength: number;
  capabilities: Capabilities;
  strengths: string[];          // human-readable "what it's best at"
  /** Task profiles this model is a CANDIDATE for. Encodes reservation policy (e.g. Opus is reserved
   *  for can't-fail judgment, not routine reasoning) so a strong-everywhere model doesn't dominate. */
  eligibleProfiles: TaskProfile[];
  /** Reference pricing (USD per 1M tokens). Knowledge only — NOT a selection input. */
  pricing?: { promptPerM: number; completionPerM: number; source: "seed" | "openrouter"; updatedAt: string };
  notes?: string;
}

/** Task profiles = what kind of work this run is. Each agent tier maps to one. */
export type TaskProfile = "speed" | "reasoning" | "agentic" | "judgment" | "critical-judgment";

// Curated current-model intelligence (Jan-2026 knowledge; pricing is seed → refresh from OpenRouter).
// Scores are RELATIVE among these candidates, not absolute benchmarks.
export const MODEL_REGISTRY: ModelInfo[] = [
  {
    slug: "nousresearch/hermes-4-70b", provider: "nousresearch", label: "Hermes 4 70B", contextLength: 131072,
    capabilities: { speed: 5, volume: 5, reasoning: 3, agentic: 2, coding: 3, judgment: 2, longContext: 3 },
    strengths: ["cheap always-on throughput", "fast classification/triage", "templated summaries"],
    eligibleProfiles: ["speed"],
    pricing: { promptPerM: 0.1, completionPerM: 0.3, source: "seed", updatedAt: "2026-01-01" },
    notes: "Volume default — most runs are bounded monitors where its output is indistinguishable from larger models.",
  },
  {
    slug: "nousresearch/hermes-4-405b", provider: "nousresearch", label: "Hermes 4 405B", contextLength: 131072,
    capabilities: { speed: 3, volume: 3, reasoning: 5, agentic: 3, coding: 4, judgment: 3, longContext: 4 },
    strengths: ["multi-step analysis/synthesis", "open-weight reasoning workhorse", "cost-efficient thinking"],
    eligibleProfiles: ["reasoning"],
    pricing: { promptPerM: 0.7, completionPerM: 0.9, source: "seed", updatedAt: "2026-01-01" },
    notes: "Reasoning carrier — reserve for tasks where reasoning moves the output.",
  },
  {
    slug: "anthropic/claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5", contextLength: 200000,
    capabilities: { speed: 5, volume: 4, reasoning: 3, agentic: 4, coding: 4, judgment: 3, longContext: 4 },
    strengths: ["fast reliable tool-use", "cheap Claude-quality agentic", "low-latency client-facing"],
    eligibleProfiles: ["speed", "agentic"],
    pricing: { promptPerM: 1.0, completionPerM: 5.0, source: "seed", updatedAt: "2026-01-01" },
    notes: "Lighter agentic option when Sonnet is overkill.",
  },
  {
    slug: "anthropic/claude-sonnet-4.6", provider: "anthropic", label: "Claude Sonnet 4.6", contextLength: 200000,
    capabilities: { speed: 4, volume: 2, reasoning: 4, agentic: 5, coding: 5, judgment: 4, longContext: 5 },
    strengths: ["best-in-class agentic tool orchestration", "strong coding", "client-facing reliability"],
    eligibleProfiles: ["agentic", "judgment"],
    pricing: { promptPerM: 3.0, completionPerM: 15.0, source: "seed", updatedAt: "2026-01-01" },
    notes: "Reliable agentic default; high-stakes-but-not-can't-fail judgment.",
  },
  {
    slug: "anthropic/claude-opus-4.8", provider: "anthropic", label: "Claude Opus 4.8", contextLength: 200000,
    capabilities: { speed: 2, volume: 1, reasoning: 5, agentic: 5, coding: 5, judgment: 5, longContext: 5 },
    strengths: ["top judgment + safety", "deepest reasoning", "can't-fail decisions"],
    eligibleProfiles: ["critical-judgment"],
    pricing: { promptPerM: 15.0, completionPerM: 75.0, source: "seed", updatedAt: "2026-01-01" },
    notes: "Reserved for the can't-fail list — never used for routine work.",
  },
];

// Each profile weights the axes that matter for that kind of task. Selection = highest weighted fit.
const PROFILE_WEIGHTS: Record<TaskProfile, Partial<Capabilities>> = {
  speed: { speed: 3, volume: 2, reasoning: 0.5 },
  reasoning: { reasoning: 3, coding: 1, longContext: 1 },
  agentic: { agentic: 3, coding: 1.5, reasoning: 1, longContext: 1 },
  judgment: { judgment: 3, reasoning: 1.5, agentic: 1 },
  "critical-judgment": { judgment: 4, reasoning: 2, agentic: 1.5, coding: 1 },
};

/** Weighted capability fit of a model for a task profile (higher = better suited). Pure. */
export function fitScore(model: ModelInfo, profile: TaskProfile): number {
  const w = PROFILE_WEIGHTS[profile];
  let s = 0;
  for (const [axis, weight] of Object.entries(w)) s += (model.capabilities[axis as keyof Capabilities] ?? 0) * (weight as number);
  return s;
}

export interface RankedModel { slug: string; label: string; fit: number; provider: string; strengths: string[] }

/**
 * Rank the eligible models for a task profile, best-first, with their fit scores — the "compared to
 * other models" view. `requireClaude` enforces the can't-fail safety rule (never a Hermes/open model).
 */
export function rankModelsForTask(
  profile: TaskProfile,
  opts: { requireClaude?: boolean; registry?: ModelInfo[] } = {},
): RankedModel[] {
  const registry = opts.registry ?? MODEL_REGISTRY;
  return registry
    .filter((m) => m.eligibleProfiles.includes(profile))
    .filter((m) => !opts.requireClaude || m.provider === "anthropic")
    .map((m) => ({ slug: m.slug, label: m.label, fit: fitScore(m, profile), provider: m.provider, strengths: m.strengths }))
    .sort((a, b) => b.fit - a.fit || a.slug.localeCompare(b.slug));
}

export interface ModelChoice { slug: string; profile: TaskProfile; fit: number; rationale: string }

/** Decide the best-suited model for a task. Throws only if the registry has no eligible candidate. */
export function selectBestModel(profile: TaskProfile, opts: { requireClaude?: boolean; registry?: ModelInfo[] } = {}): ModelChoice {
  const ranked = rankModelsForTask(profile, opts);
  const top = ranked[0];
  if (!top) throw new Error(`no eligible model for profile '${profile}'${opts.requireClaude ? " (Claude-only)" : ""}`);
  const runnerUp = ranked[1];
  const rationale = `best ${profile} fit (${top.fit.toFixed(1)})${runnerUp ? ` vs ${runnerUp.label} ${runnerUp.fit.toFixed(1)}` : ""}: ${top.strengths[0]}`;
  return { slug: top.slug, profile, fit: top.fit, rationale };
}

/** Lookup a model's knowledge by slug. */
export function modelInfo(slug: string, registry: ModelInfo[] = MODEL_REGISTRY): ModelInfo | undefined {
  return registry.find((m) => m.slug === slug);
}

// ── The "looping knowledge" — keep the registry congruent with current OpenRouter data ──

export interface OpenRouterModel { id: string; context_length?: number; pricing?: { prompt?: string | number; completion?: string | number } }

/**
 * Pure merge of fetched OpenRouter model data into the registry: refreshes pricing (per-token →
 * per-M) and context length for known slugs, marks them source='openrouter' + updatedAt. Never
 * changes capability scores (those are curated intelligence, not derivable from pricing). Returns a
 * NEW registry + a report of what refreshed. The network fetch lives in `fetchOpenRouterModels`.
 */
export function applyOpenRouterPricing(
  registry: ModelInfo[],
  openrouter: OpenRouterModel[],
  now: string = new Date().toISOString().slice(0, 10),
): { registry: ModelInfo[]; refreshed: string[]; unmatched: string[] } {
  const byId = new Map(openrouter.map((m) => [m.id, m]));
  const refreshed: string[] = [];
  const next = registry.map((m) => {
    const or = byId.get(m.slug);
    if (!or) return m;
    const promptPerM = or.pricing?.prompt != null ? Number(or.pricing.prompt) * 1_000_000 : m.pricing?.promptPerM;
    const completionPerM = or.pricing?.completion != null ? Number(or.pricing.completion) * 1_000_000 : m.pricing?.completionPerM;
    refreshed.push(m.slug);
    return {
      ...m,
      contextLength: or.context_length ?? m.contextLength,
      pricing: promptPerM != null && completionPerM != null
        ? { promptPerM, completionPerM, source: "openrouter" as const, updatedAt: now }
        : m.pricing,
    };
  });
  const known = new Set(registry.map((m) => m.slug));
  const unmatched = registry.filter((m) => !byId.has(m.slug)).map((m) => m.slug);
  return { registry: next, refreshed, unmatched: [...new Set(unmatched)].filter((s) => known.has(s)) };
}

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/**
 * Fetch the live OpenRouter model catalogue (id + context + pricing). The public endpoint needs no
 * auth. Requires `openrouter.ai` to be in the environment's network allowlist — otherwise the host
 * is refused (HTTP 403 "Host not in allowlist") and this throws a clear error. Network only; the
 * merge logic (`applyOpenRouterPricing`) is pure and tested separately.
 */
export async function fetchOpenRouterModels(url: string = OPENROUTER_MODELS_URL): Promise<OpenRouterModel[]> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`OpenRouter fetch failed (HTTP ${res.status}). If 403, add 'openrouter.ai' to the environment network allowlist.`);
  }
  const json = (await res.json()) as { data?: OpenRouterModel[] };
  return json.data ?? [];
}

/** Fetch + merge in one call — the refresh step the "looping knowledge" job runs on a schedule. */
export async function refreshRegistryPricing(
  registry: ModelInfo[] = MODEL_REGISTRY,
): Promise<{ registry: ModelInfo[]; refreshed: string[]; unmatched: string[] }> {
  return applyOpenRouterPricing(registry, await fetchOpenRouterModels());
}
