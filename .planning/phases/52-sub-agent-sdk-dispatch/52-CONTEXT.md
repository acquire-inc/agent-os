# Phase 52 — Sub-agent SDK dispatch (live model fork mid-run)

**Status:** planned
**Triggered by:** Phase 32-41 emit `model.routed` events but don't actually swap the SDK session model. This phase closes the gap.

## Goal

When `pickModelIntelligently` returns a different model for a skill/tool than the agent's baseline, actually re-dispatch that sub-task on the picked model — not just emit the audit signal. Use Claude Agent SDK's sub-agent dispatch primitive so the main session stays on the baseline but the sub-task runs on the optimal model.

## Architecture

```
Run starts on agent's baseline model (Hermes-4-70b say)
  ↓
Agent invokes skill X
  ↓ runner intercepts via custom tool
  ↓ pickModelIntelligently returns gemini-2-flash
  ↓ runner spawns sub-agent with Sonnet's session
  ↓ sub-agent runs the skill, returns result
  ↓ runner merges result into parent session
  ↓
Agent continues on baseline
```

Cost attribution: each sub-agent invocation gets its own
BudgetTracker reservation against the parent run's cap.
`model.routed` events fire at the actual swap (not just at run start).

## Deliverables

1. **SubAgentDispatcher class** in `apps/runner/src/sub-agent.ts`:
   - `dispatchAsSubAgent(parentBundle, modelSlug, skillKey, input)`
   - Wraps `@anthropic-ai/claude-agent-sdk` sub-agent API
   - Per-sub-agent BudgetTracker reserve/commit
   - Per-sub-agent timeout (default 30s; configurable)

2. **Runner integration** in `execute.ts`:
   - PreSkillUse hook: when the agent is about to use a skill that has
     `preferredModelTier` or `task_profile`, intercept and route via
     SubAgentDispatcher
   - PostSkillUse hook: merge sub-agent result back into parent context

3. **Per-skill cost tracking** — extends Phase 26's per-tool reserve to
   per-skill. Adds `skills.cost_estimate_usd` for sub-agent budget reserves.

4. **Migration 0025** — `skills.cost_estimate_usd NUMERIC(12,4) DEFAULT 0`

5. **Tests**:
   - SubAgentDispatcher with stubbed SDK
   - Reserve-before / commit-after on sub-agent invocation
   - Cap breach in sub-agent → CapBreachError + Approval, parent run continues with operator decision

## Out of scope

- Parallel sub-agent dispatch (one at a time per parent run for v1)
- Cross-sub-agent state sharing (each sub-agent is isolated)
- Sub-agent autonomy override (inherits parent's autonomy minus the ratchet)

## Acceptance

- Agent on Hermes-4-70b invokes `briefing-synthesis` skill (T-reason
  preference) → sub-agent dispatches on Hermes-4-405b → result merged
  → parent continues on Hermes-4-70b
- `model.routed` event fires at actual swap with `source: catalog_picker`
- BudgetTracker shows two committed spends: parent + sub-agent
- Cap breach during sub-agent invocation raises Approval per Phase 28

## Risks

- SDK API surface for sub-agents may not exist yet at the required
  detail level (vision-only, no parallel, no streaming back). Phase
  might require building a thin in-process orchestrator instead of
  using the SDK primitive.
- Timeout coordination — parent waits on sub-agent; if sub-agent
  hangs, parent's max-turns budget burns. Mitigated by the 30s
  sub-agent default timeout.
