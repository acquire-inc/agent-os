# Model Intelligence — choosing the best model per task

> The fleet routes each agent to the model **best suited to its task**, decided by capability, not
> cost. This is the knowledge + decision layer behind that. Code: `@agent-os/core` →
> `packages/core/src/model-registry.ts`. Decision is capability-driven; pricing is reference
> knowledge refreshed from OpenRouter.

## How a model gets chosen (the decision)

1. Each agent has a **tier** → a **task profile**: `T-cheap→speed`, `T-reason→reasoning`,
   `T-work→agentic`, `T-critical→judgment`; the **can't-fail** list → `critical-judgment` (Claude-only).
2. `selectBestModel(profile)` scores every **eligible** model on the capability axes that profile
   weights, and picks the top fit. `rankModelsForTask(profile)` returns the full comparison (why X
   beat Y). `modelForAgent(key, tier)` in the seeders calls this — so seeding is the intelligence
   layer's output, not a hardcoded map.
3. **Safety rule:** a can't-fail task is `requireClaude` → a Hermes/open model can never win it.

## Current model knowledge (candidates)

Capability scores are **relative** among these candidates (1 weak … 5 best-in-class). Pricing is
seed/reference (USD per 1M tokens), refreshed from OpenRouter.

| Model | Best at | speed | volume | reasoning | agentic | coding | judgment | longCtx | eligible for |
|---|---|--|--|--|--|--|--|--|---|
| **Hermes 4 70B** | cheap always-on throughput, triage | 5 | 5 | 3 | 2 | 3 | 2 | 3 | speed |
| **Hermes 4 405B** | multi-step reasoning/synthesis | 3 | 3 | 5 | 3 | 4 | 3 | 4 | reasoning |
| **Claude Haiku 4.5** | fast reliable tool-use | 5 | 4 | 3 | 4 | 4 | 3 | 4 | speed, agentic |
| **Claude Sonnet 4.6** | best agentic orchestration, coding | 4 | 2 | 4 | 5 | 5 | 4 | 5 | agentic, judgment |
| **Claude Opus 4.8** | top judgment + safety, deepest reasoning | 2 | 1 | 5 | 5 | 5 | 5 | 5 | critical-judgment |

> **Eligibility encodes reservation policy.** A strong-everywhere model (Opus) would otherwise win
> every profile, so it is only a *candidate* for `critical-judgment` (the can't-fail list). That's
> why routine reasoning routes to 405B and routine agentic to Sonnet, not Opus.

## What gets picked today

| Task profile (tier) | Winner | Why (vs runner-up) |
|---|---|---|
| speed (T-cheap) | Hermes 70B | top speed+volume fit (vs Haiku) |
| reasoning (T-reason) | Hermes 405B | reasoning workhorse |
| agentic (T-work) | Claude Sonnet | best tool-use (vs Haiku) |
| judgment (T-critical, non-can't-fail) | Claude Sonnet | high-stakes reliable, never Hermes |
| critical-judgment (can't-fail) | Claude Opus | top judgment + safety, Claude-only |

## Keeping the knowledge current (the looping refresh)

- **Pricing/availability** comes from the live OpenRouter catalogue:
  `pnpm --filter @agent-os/seed exec tsx refresh-model-pricing.ts` →
  `fetchOpenRouterModels()` + `applyOpenRouterPricing()` merge per-token pricing → per-M, mark
  `source=openrouter` + `updatedAt`. **Requires `openrouter.ai` in the environment network
  allowlist** (otherwise HTTP 403; the job exits cleanly and keeps seed pricing — selection is
  unaffected because it's capability-driven).
- **Capability scores** are curated intelligence (not derivable from pricing) — update them in
  `MODEL_REGISTRY` when a new model lands or a benchmark shifts. Wire the refresh to a cron/agent to
  keep "what models exist + what they cost" congruent over time.

## Adding / forking a model

1. Add a `ModelInfo` to `MODEL_REGISTRY` (slug, provider, context, capability scores, strengths,
   reference pricing).
2. List the **task profiles** it should compete for in `eligibleProfiles`.
3. `selectBestModel`/`rankModelsForTask` immediately consider it — if it out-fits the incumbent for
   a profile, the fleet routes to it on the next seed. No code change to the seeders.
4. Never make a Hermes/open model eligible for `critical-judgment` (the can't-fail safety rule;
   enforced by `requireClaude` + `validateAgent`).
