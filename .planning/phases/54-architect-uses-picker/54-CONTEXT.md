# Phase 54 — Architect uses pickBestModel during blueprint synthesis

**Status:** planned
**Triggered by:** Phases 38-40 ship the catalog + picker. The architect currently lets the LLM emit `blueprint.model` per agent — no intelligence applied.

## Goal

When the architect assembles a new agent (via `/api/admin/architect/seed`), run `pickBestModel` against the blueprint's intended skills + task profiles + budget constraints to suggest the optimal starting model. Operator sees the recommendation in the blueprint preview UI and can accept or override.

## Architecture

```
LLM emits TeamBlueprintProposal with agents[]
  ↓
For each agent in proposal:
  - Aggregate task profiles from blueprint.skillKeys → look up
    skills.task_profile for each → merge weights
  - Build composite TaskProfile from the union
  - pickBestModel(catalog, compositeProfile, { budgetCapUsd })
  → recommended model + alternatives + filtered
  ↓
Mutate blueprint.agents[i].model with the recommendation
  unless LLM emitted an explicit override
  ↓
Persist with `model_recommendation` audit field on agents.template_id
```

## Deliverables

1. **`packages/core/src/architect/model-suggestion.ts`** — pure module:
   - `composeTaskProfileFromSkills(skillKeys, skillRegistry)`
   - `suggestModelForBlueprint(blueprint, catalog, skillRegistry, opts)`

2. **Architect hydrate.ts upgrade** — after the LLM emits the proposal:
   - For each blueprint with NO explicit `model` field (let LLM intent
     win when expressed), run `suggestModelForBlueprint`
   - Mutate `blueprint.model = suggestion.pick.slug`
   - Append a warning with the rationale + alternatives

3. **Audit field on agents** — `agents.model_recommendation_rationale TEXT`
   (Phase 54 migration 0026) — stores the picker's reason for future
   review.

4. **Tests**:
   - Composite profile assembly from multi-skill agents
   - Suggestion respects T-critical safety floors (architect refuses
     CRA-prohibited blueprints + can't-fail keys remain intact)
   - Override path: if LLM emits `model: "anthropic/claude-opus-4.8"`
     explicitly, suggestion does NOT overwrite

## Out of scope

- Re-suggesting on existing agents (Phase 54 is seed-time only)
- Multi-model agents (one model per agent)
- Operator-side UI for accept/reject (separate UI session)

## Acceptance

- Architect proposes a 3-agent team where each agent's skills imply
  different profiles → each agent gets a different optimal model
- T-critical agent in the proposal still pins to Opus regardless
- Operator dashboard sees `model_recommendation_rationale` on the
  proposed blueprint preview
- Existing `/api/admin/architect/seed` API contract unchanged
