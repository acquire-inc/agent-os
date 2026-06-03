---
name: cost-ceiling-discipline
description: Use on any run or autonomous loop that accrues model spend. Two-tier ceiling — per-run hard-stop ($5 default via budget_cap_usd) + per-build/per-engagement cap ($15K default) requiring re-approval to cross. Reserve/commit pattern in the PreToolUse hook. Cost report is mandatory completion evidence; emits budget.cap_hit and halts on cross.
---
# SKILL: Cost Ceiling Discipline

The doctrine for the existing per-run cost meter at `apps/runner/src/execute.ts` (`budgetCapUsd`), extended with the per-build / per-engagement tier and the reserve/commit pattern that feeds the Tier 2 backlog work (`OPTIMIZATION-AUDIT.md` 2.B). The skill surfaces what is structurally true today (the per-run meter, the cap-hit halt, the cost field on `run_summaries`) and adds the per-build framing the operator needs to bound engagement spend.

Does NOT introduce new runtime code in this phase — the skill is documentation; the reserve/commit hook + the per-build singleton are Tier 2 work. Attached (when operator approves) to any agent that accrues model spend autonomously — almost every agent class.

## Purpose

A single Acqu / Cliently agent or a runaway autonomous loop cannot rack up unbounded cost. The structural answer is two ceilings: a per-run cap that halts the run the instant spend crosses it, and a per-build / per-engagement cap that blocks deployment past the threshold until the operator re-approves. The failure this prevents is the "ran overnight, spent $400 on a single autonomous loop" class — the per-run cap defaults conservative ($5) so the operator wakes up to a halted run, not a credit-card bill.

The per-build ceiling protects margin against the $2M/yr target — any engagement that crosses $15K becomes a sales conversation, not a quiet absorbed cost. Crossing it requires an `approval.requested` to the operator with the spend trajectory and the work remaining; the operator approves a higher cap or the build halts.

## Workflow

1. **At run start, read the budget cap.** The runner reads `agents.budget_cap_usd` for the per-run cap and (when the per-build singleton lands) the engagement's accumulated spend. Both are reads against the tenant's row; fail-closed semantics — an unreadable cap denies the run start.

2. **PreToolUse: reserve the maximum plausible cost of the next tool call.** The Tier 2 reserve/commit pattern: before dispatching a tool call, the hook reserves an upper-bound estimate (input tokens + max output tokens × per-1M-token rate for the resolved model). If the reservation would cross the per-run cap, the call is denied with `budget.warn` and the run prepares to halt; if the reservation crosses the per-build cap, the run escalates to operator. Reservation is a structural answer to "we did not know we'd cross the cap until after the call completed."

3. **PostToolUse: commit the actual cost.** After the tool call returns, the hook reads the actual token counts from the response envelope and commits the real cost against the reserved amount. The over-reservation flows back to available budget; the under-reservation is fine (the cap has the slack baked in). The committed cost lands in `runs.cost_usd` and the running per-run total.

4. **On per-run cap hit, halt immediately.** The runner breaks the stream with `stopReason="budget_exceeded"`, emits `budget.cap_hit`, and writes `runs.status="failed"` with the cost summary. The agent does not get a "finish the turn" grace period — the halt is structural to prevent a runaway loop from spending its way out of the cap.

5. **On per-build cap approach (e.g., 80% of $15K), emit budget.warn.** The warn fires the first time the running total crosses the threshold; the operator sees a heads-up in the findings inbox. Crossing 100% requires `approval.requested` with `options=[raise-cap-to-$X, halt-build, descope]`.

6. **Goal-ladder advances are bounded by the cost ceiling, not just the iteration cap.** Any autonomous loop — the agent-evaluator's eval pass, a content-engine's draft-and-iterate, an outreach build's adaptive cadence — checks the cap before the next advance, in addition to the iteration cap (`AGENT_MAX_TURNS=40` equivalent). Both must clear for the next step.

7. **Print the cost report as completion evidence.** Before any run flips to `status=done`, the cost report is written to `run_summaries.highlights.cost_report` (see Output contract). The verification skill's contract refuses to mark a run done without this field present.

## Rules

- **The per-run cap is a HARD stop, not a warning.** Stream breaks, status=`failed`, exit. No "finish the turn" grace. A soft cap is the dead-defense failure mode the source documented.
- **The per-build ceiling is the re-approval line.** Crossing it without an explicit operator-written approval is forbidden — `approval.requested` is the only mechanism.
- **All four token classes count.** Input, output, cache-read, cache-write — every one accrues toward spend. The Anthropic envelope returns all four; the meter sums all four. A meter that only counts input + output undercounts; an undercounting meter fires the halt at the wrong dollar amount.
- **Price constants are operator-owned.** The `PRICING` table in the meter is read from `tenants.tier_overrides.pricing_constants` (or a fallback default); the agent does not get to silently update its own pricing. Stale constants are a finding the operator backfills.
- **Reservation, not just commitment.** The reserve/commit pattern is the structural answer to "we crossed the cap mid-call." A meter that only sums after the fact will spend its way past the cap on a single expensive call.
- **The cost report is mandatory.** No `run.completed` without `cost_report` on the highlights field. Verification refuses, the runner enforces it at the `Stop` hook.
- **Crossing $15K does not mean "raise to $15.5K silently."** The re-approval is a real conversation with the operator about the build's scope and remaining work; the cap is not raised by default.
- **The per-run cap defaults conservative.** $5/run is the default; agents that genuinely need more (a long content-engine build, a multi-step ad-ops pull) declare it on the registry row, and the operator audits the declaration. The default protects against a misconfigured agent silently burning budget.

## Output contract

The agent's `run_summaries.highlights` carries:

```json
{
  "cost_report": {
    "model_calls": <int>,
    "input_tokens": <int>,
    "output_tokens": <int>,
    "cache_read_tokens": <int>,
    "cache_write_tokens": <int>,
    "cost_usd": <float>,
    "cap_per_run_usd": <float>,
    "cap_per_build_usd": <float>,
    "cap_per_build_consumed_usd": <float>,
    "cap_per_build_remaining_usd": <float>,
    "resolved_model": "<openrouter-slug>",
    "halts": []
  }
}
```

When a halt fires, the `halts` array carries one entry per halt event:
```json
{ "halt_at_usd": <float>, "halt_reason": "per_run | per_build", "tool_call_id": "<id>" }
```

Relay events:
- `budget.warn` on per-build threshold (80% default; configurable) — fires once per build per threshold
- `budget.cap_hit` on per-run halt OR per-build hard stop — fires every time
- `approval.requested` on per-build cap-cross with options `[raise-cap-to-$X, halt-build, descope]`
- `approval.resolved` once the operator answers
- `run.failed` if the runner halts the run on a cap hit
- `run.escalated` if the run escalates rather than halting (per-build cap-cross with the build still mid-flight)

The `summary_text` field carries: `"Cost: $<run_cost> of $<cap_per_run> (run); $<build_consumed> of $<build_cap> (build); halts=<N>."`

For a per-run halt, the building agent's `run_summaries.summary_text` carries the halt reason and the spend at halt; the runner does not write `run.completed`.

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_path: hermes-runtime/skills/agentic/gate-cost-ceiling/SKILL.md
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the two-tier framing (per-run hard stop + per-build ceiling), the "cost report is completion evidence" framing, the four-token-class rule, the goal-ladder boundedness, and the conservative-default rationale from the source. Mapped onto our existing surfaces — `apps/runner/src/execute.ts` `budgetCapUsd`, `runs.cost_usd`, `run_summaries.highlights.cost_report`, the resolved-model field from the Model Router (`packages/core/src/router/`), and Relay events from the closed 28-event namespace (`budget.warn`, `budget.cap_hit`, `approval.requested`, `approval.resolved`, `run.failed`, `run.escalated`). The reserve/commit pattern is the Tier 2 backlog framing (`OPTIMIZATION-AUDIT.md` 2.B), not the source's `CostMeter.addUsage` call site. Source's substrate-specific machinery (`agent-sdk-base/src/middleware/cost-meter.ts`, `build_lib`'s budget module, `BudgetExceededError` exit code 3, `.claude/CLAUDE.md` forbidden-action language) was left out.
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
