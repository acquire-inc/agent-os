# Auto-Onboarding — The Viktor Flow (V2 P10)

**Audience:** anyone bringing a new tenant onto the platform (sales,
operator, the eventual self-serve onboarding endpoint).

> Pair: this doc + `packages/core/src/onboarding.ts` + `onboarding.test.ts`
> (36 assertions, offline).

## What this is

The end state: a company answers an onboarding interview, the Architect
auto-provisions a tailored fleet (hard floors intact), the fleet self-tunes
against real outcomes. P10 is the buildable-now pure pieces of that flow.

No LLM call in this module. The Architect already does the LLM-shaped
work (TeamBlueprintProposal generation); P10 just frames the prompt and
sequences the side effects.

## The three pure pieces

### 1. `validateOnboardingInterview(iv)` — fail-loud shape + content check

Catches:
- Missing required fields (companyName, description, industry, goals)
- Description / goals too short (< 20 chars — typo/empty defense)
- Invalid budget (NaN, negative)
- Bad slug shape (not `[a-z0-9][a-z0-9-]*`)
- **CRA trigger keywords** in description/goals/industry (credit,
  underwriting, tenant screening, employment screening, housing applicant,
  loan approval, insurance underwriting, background check). The operator
  must explicitly confirm via `craAcknowledgement: "confirmed_not_eligibility_decisioning"`
  to proceed. This catches the CRA-territory hand off cleanly at the
  interview layer — the Architect's hard refusal at blueprint time is the
  belt-and-suspenders.

Suggests a slug derived from the company name if none provided.

### 2. `composeArchitectPrompt(iv)` — deterministic Architect prompt

Same interview → same prompt string. The Architect's prompt has every
non-negotiable constraint embedded:

- Refuse CRA blueprints (eligibility decisioning in credit, employment,
  housing, insurance, government-benefits).
- Cant-fail agents (14 doctrine keys) keep Opus pin.
- Skills referenced by key only (don't invent skill definitions).
- Architect output autonomy ceiling is `execute_safe`; never `execute_full`.

The Architect's existing CRA blocklist + cant-fail + autonomy guards
already enforce these at hydrate time — the prompt constraints are
upstream so the LLM doesn't try to violate them in the first place.

### 3. `planOnboardingSteps(iv)` — ordered checklist of side effects

9 steps, deterministic order:

1. `validate_interview` — auto
2. `create_tenant` — auto
3. `seed_baseline_skills` — auto
4. `seed_baseline_mcps` — auto, OR human-gated if connectors not specified
5. `architect_propose` — auto
6. `operator_review_blueprint` — **HUMAN-GATED** (review warnings, model
   picks, overlap warnings from B3)
7. `seed_blueprint` — auto (creates agents at autonomy=propose, enabled=false)
8. `enable_runners` — **HUMAN-GATED** (operator enables one at a time
   after first dry-run)
9. `post_onboarding_health_check` — auto (`pnpm launch:check`)

Caller walks the list, runs each step, surfaces progress, pauses for
human input on gated steps.

## How to use the flow

```ts
import {
  validateOnboardingInterview,
  composeArchitectPrompt,
  planOnboardingSteps,
} from "@agent-os/core";

const interview = await collectInterview();  // form data
const validation = validateOnboardingInterview(interview);
if (!validation.ok) return showErrors(validation.reasons);

const slug = interview.tenantSlug ?? validation.suggestedSlug!;
const architectPrompt = composeArchitectPrompt(interview);
const steps = planOnboardingSteps(interview);

for (const step of steps) {
  if (step.humanGated) {
    await waitForOperatorConfirmation(step);
  }
  await runStep(step, { interview, slug, architectPrompt });
}
```

## What's NOT in P10 (deliberate)

- **The actual side effects** (create_tenant SQL, seed scripts, architect
  endpoint call) — those use existing APIs and DB writes. P10 only owns
  the sequencing + validation.
- **A UI for the interview** — that's a follow-on (B12 or beyond). The
  shape of `OnboardingInterview` is the contract for any UI.
- **Industry-specific defaults** — picking the right Phase-1 skills /
  connectors per industry is a separate, evolvable mapping (operator
  layer, not core).

## Testing

```bash
pnpm --filter @agent-os/core test:onboarding   # 36/36 offline
```

## Compliance check

The interview validator is the FIRST gate against onboarding a CRA-territory
tenant. The Architect's hard refusal is the SECOND gate (it refuses to
generate any blueprint touching the prohibited categories). At runtime, a
manually-authored agent that bypassed both is caught by the runner's
`cantfail.cra_violation` SessionStart guard.

Three layers. Same doctrine. No silent fall-through.
