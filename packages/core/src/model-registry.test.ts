// Pure test for the model-intelligence layer. No DB, no network.
// Run: pnpm --filter @agent-os/core exec tsx src/model-registry.test.ts
import {
  MODEL_REGISTRY, selectBestModel, rankModelsForTask, fitScore, modelInfo, applyOpenRouterPricing,
  type ModelInfo, type TaskProfile,
} from "./model-registry.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // ── DECISION: best-suited model per task profile ──
  assert(selectBestModel("speed").slug === "nousresearch/hermes-4-70b", "speed task → Hermes 70B (fast volume)");
  assert(selectBestModel("reasoning").slug === "nousresearch/hermes-4-405b", "reasoning task → Hermes 405B");
  assert(selectBestModel("agentic").slug === "anthropic/claude-sonnet-4.6", "agentic task → Claude Sonnet (best tool-use)");
  assert(selectBestModel("judgment").slug === "anthropic/claude-sonnet-4.6", "judgment task → Sonnet");
  assert(selectBestModel("critical-judgment", { requireClaude: true }).slug === "anthropic/claude-opus-4.8", "can't-fail → Opus (top judgment)");

  // ── the rationale explains the choice vs the runner-up (compared to other models) ──
  const agentic = selectBestModel("agentic");
  assert(/best agentic fit/.test(agentic.rationale) && /vs /.test(agentic.rationale), "choice carries a comparative rationale");

  // ── ranking is a real comparison: agentic ranks Sonnet over Haiku ──
  const ranked = rankModelsForTask("agentic");
  assert(ranked[0]!.slug === "anthropic/claude-sonnet-4.6" && ranked[1]!.slug === "anthropic/claude-haiku-4-5", "agentic ranking: Sonnet > Haiku");
  assert(ranked[0]!.fit > ranked[1]!.fit, "ranking is by descending fit score");

  // ── SAFETY: can't-fail selection never returns a non-Claude model ──
  assert(selectBestModel("critical-judgment", { requireClaude: true }).slug.startsWith("anthropic/"), "critical-judgment Claude-only");
  // requireClaude actually filters: a profile that lists a Hermes model drops it under requireClaude.
  const speedClaude = rankModelsForTask("speed", { requireClaude: true });
  assert(speedClaude.every((m) => m.provider === "anthropic"), "requireClaude excludes Hermes from any profile");
  assert(speedClaude[0]?.slug === "anthropic/claude-haiku-4-5", "speed + Claude-only → Haiku");

  // ── fitScore: Opus out-judges Sonnet on the critical-judgment axis weighting ──
  const opus = modelInfo("anthropic/claude-opus-4.8")!;
  const sonnet = modelInfo("anthropic/claude-sonnet-4.6")!;
  assert(fitScore(opus, "critical-judgment") > fitScore(sonnet, "critical-judgment"), "Opus > Sonnet on critical-judgment fit");

  // ── KNOWLEDGE integrity ──
  assert(MODEL_REGISTRY.length >= 5, "registry knows the candidate models");
  const validProfiles = new Set<TaskProfile>(["speed", "reasoning", "agentic", "judgment", "critical-judgment"]);
  const badElig = MODEL_REGISTRY.filter((m) => m.eligibleProfiles.length === 0 || m.eligibleProfiles.some((p) => !validProfiles.has(p)));
  assert(badElig.length === 0, "every model has valid eligible profiles");
  assert(MODEL_REGISTRY.every((m) => m.pricing && m.capabilities.judgment >= 1), "every model carries pricing + capability knowledge");

  // ── the looping-knowledge merge: OpenRouter pricing refresh ──
  const orData = [{ id: "anthropic/claude-sonnet-4.6", context_length: 250000, pricing: { prompt: "0.000004", completion: "0.00002" } }];
  const { registry: refreshed, refreshed: ids, unmatched } = applyOpenRouterPricing(MODEL_REGISTRY, orData, "2026-06-06");
  const s = refreshed.find((m) => m.slug === "anthropic/claude-sonnet-4.6")!;
  assert(ids.includes("anthropic/claude-sonnet-4.6"), "refresh reports the updated model");
  assert(s.pricing!.promptPerM === 4 && s.pricing!.completionPerM === 20, "per-token OpenRouter pricing → per-M (×1e6)");
  assert(s.pricing!.source === "openrouter" && s.pricing!.updatedAt === "2026-06-06", "refreshed pricing is marked openrouter + dated");
  assert(s.contextLength === 250000, "context length refreshed from OpenRouter");
  // capability scores are curated intelligence — pricing refresh must NOT touch them.
  const before = modelInfo("anthropic/claude-sonnet-4.6")!.capabilities.agentic;
  assert(s.capabilities.agentic === before, "refresh leaves capability scores untouched");
  assert(unmatched.length === MODEL_REGISTRY.length - 1, "models absent from the OpenRouter payload are reported unmatched");

  // ── selection is capability-driven, NOT price-driven: making Opus 'free' must not change picks ──
  const cheapOpus: ModelInfo[] = MODEL_REGISTRY.map((m) =>
    m.slug === "anthropic/claude-opus-4.8" ? { ...m, pricing: { promptPerM: 0, completionPerM: 0, source: "seed", updatedAt: "x" } } : m,
  );
  assert(selectBestModel("agentic", { registry: cheapOpus }).slug === "anthropic/claude-sonnet-4.6", "zero-cost Opus does not win agentic (capability, not price)");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
