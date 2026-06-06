# Phase 19 — Model Intelligence (PLAN + DONE)

> Operator direction: "decision-making on the best possible model for that specific task compared to
> other models — model intelligence, not budgeting." Plus: a knowledge base on current models, an
> OpenRouter pricing connection, and the ability to spin up the optimal model per task.

## Built
- **`@agent-os/core` `model-registry.ts`** — the intelligence layer:
  - **Knowledge:** `MODEL_REGISTRY` scores each candidate model (Hermes 70B/405B, Claude
    Haiku/Sonnet/Opus) on capability axes (speed, volume, reasoning, agentic, coding, judgment,
    longContext) + strengths + context + reference pricing.
  - **Decision:** `selectBestModel(profile)` / `rankModelsForTask(profile)` score the *eligible*
    models on the profile's capability weights and pick/rank the best fit — explainable (rationale
    vs runner-up), comparable (full ranking). Capability-driven; pricing is NOT a selection input.
  - **Safety:** `requireClaude` for can't-fail → a Hermes/open model can never win a critical task.
  - **Looping knowledge:** `fetchOpenRouterModels` + `applyOpenRouterPricing` (pure merge:
    per-token → per-M, marks source/date, never touches capability scores) + `refreshRegistryPricing`.
- **Wired into seeding:** `_shared.modelForAgent` now calls `selectBestModel` (tier → task profile;
  can't-fail → critical-judgment). Behavior preserved (same slugs) but now *decided* by the layer.
- **`refresh-model-pricing.ts`** — the scheduled refresh job; graceful (exit 0) when `openrouter.ai`
  isn't allowlisted, since selection doesn't depend on pricing.
- **Knowledge doc** `docs/knowledge/model-intelligence.md` — current-model knowledge, how a model is
  chosen, what's picked today + why, the refresh loop, and how to add/fork a model.
- **`model-registry.test`** (22): per-profile picks, comparison/ranking, can't-fail Claude-only,
  capability-not-price (zero-cost Opus still doesn't win agentic), and the OpenRouter merge.

## Spinning up the optimal model / forking
Add a `ModelInfo` + its `eligibleProfiles`; `selectBestModel` immediately considers it and the fleet
routes to it on the next seed if it out-fits the incumbent. No seeder change. (Never make an open
model eligible for `critical-judgment`.)

## Live refresh — operator action
To turn on live pricing/availability, add `openrouter.ai` to the environment network allowlist; the
refresh job then populates `source=openrouter` pricing. Capability scores stay curated.

## Verify
`model-registry` 22/22; seed suite unaffected (modelForAgent unchanged outputs); typecheck clean.
