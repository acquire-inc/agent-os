---
name: cost-ceiling-discipline
description: Use on every non-T-critical AgentOS agent. Track LLM + tool spend continuously against the agent's `budgetCapUsd`. Reserve before spend, commit after success, release on failure. Refuse to start a step that would breach the cap. Emit budget.* Relay events so cross-run aggregate cost is auditable.
---
# Cost Ceiling Discipline

The runtime discipline that turns the `budgetCapUsd` field from a passive cap into an active gate. Without it, a runaway loop or a chunky tool call can blow through the cap before the runner notices; with it, every spend goes through a reserve-commit pattern that fails closed on cap breach.

## Purpose

`agents.budgetCapUsd` (clamped at $2.00 by `hydrate.ts`) is the soft cap on a single run. The discipline is how the agent actually respects it. Without the discipline, the field is observational — the runner notes the overrun after the fact. With the discipline, the next spend that would breach the cap is refused before it lands.

## Workflow

1. **Read the cap at run start.** `agents.budgetCapUsd` is loaded into the bundle. The agent sees the literal cap value plus the running spend total. Both fields are available in the agent's read-only context.

2. **Reserve before every spend.** Before an LLM call or a paid tool call, compute the estimated cost (LLM: model price × estimated tokens; tool: tool's published cost) and call `reserveSpend(amount)`. The reserve writes a `budget.reserved` Relay event for this `run_id` with the amount. If `current_spend + reserved + amount > cap`, the reserve fails and the agent enters cap-breach handling (step 5).

3. **Commit on success.** After the spend completes, call `commitSpend(actual)` with the actual cost. The commit writes `budget.committed`, decrements the reserve, and increments the run's true spend total. If actual > reserved, the over-amount is reserved-then-committed in one shot, OR if the over-amount would breach the cap, the over-amount triggers cap-breach handling.

4. **Release on failure.** If the spend fails (tool error, LLM timeout, retry-yielding failure), call `releaseSpend(reserved)`. The release writes `budget.released`, decrements the reserve, and leaves the run's true spend total unchanged. This prevents reserve leakage from blocking subsequent legitimate spends.

5. **Cap-breach handling.** When a reserve fails because it would breach the cap:
   - Emit `budget.cap_breached` (Relay event) with the requested amount, current spend, and the cap.
   - Raise an Approval asking the operator to either raise the cap for this run (one-shot, does not persist), accept the partial output and close `status=truncated`, or abort.
   - Do NOT silently fall back to a cheaper model or a shorter tool call without operator sign-off — that hides the breach.

6. **Emit a final cost-summary event at run close.** `budget.summary` with the total reserved (sum), total committed (sum), total released (sum), and the delta-vs-cap percentage. This event feeds the cross-run cost aggregate that the operator's cost dashboard queries.

## Rules

- T-critical agents are EXEMPT from this skill. Their budget is governed by separate safety rules; this skill does not attach to them.
- Reserve before spend, always. A spend without a prior reserve is a violation (`finding.recorded` category=anomaly severity=low).
- Commit with actuals, not estimates. The commit event carries the true cost from the LLM response or the tool's billing record.
- Release on failure is mandatory. Reserve leakage compounds across retries and creates phantom cap exhaustion.
- Cap-breach is operator-decision territory. Never silently degrade to a cheaper path without approval — the degradation hides the breach signal.
- The skill assumes `reserveSpend`, `commitSpend`, `releaseSpend` are available as deterministic AgentOS tools. If the binding is missing for an agent, that is a finding (`category: configuration, severity: medium`) — the agent runs in pre-skill mode (cap is observational only) until the binding lands.
- The cap is per-run, not per-day. Aggregate cost discipline is the operator's tier-level dashboard, not the per-agent ceiling.

## Output contract

```json
{
  "budget": {
    "cap_usd": "<dec>",
    "reserved_total_usd": "<dec>",
    "committed_total_usd": "<dec>",
    "released_total_usd": "<dec>",
    "actual_spend_usd": "<dec>",
    "cap_utilization_pct": <int>,
    "cap_breaches": <int>,
    "breach_resolution": ["raised | truncated | aborted | none", ...]
  }
}
```

A clean run has `cap_breaches: 0`, `actual_spend_usd <= cap_usd`, and `committed_total_usd === actual_spend_usd`. The cross-run aggregate that feeds the cost dashboard reads this block plus the `budget.*` Relay event stream.
