---
name: scope-lock-discipline
description: Use on every AgentOS agent whose blast radius can grow mid-run — ad-ops (campaign edits), launcher (campaign creation), content-engine (publish pipeline). Lock the scope of the run at start, refuse any tool call that would expand it, and emit a finding on every attempted expansion.
---
# Scope Lock Discipline

The discipline that prevents an agent from "while I'm in there" — the failure mode where an agent starts with one campaign or one piece of content and ends up touching ten because the run drifted. Scope is named at run start, locked, and any expansion attempt is refused at the tool boundary.

## Purpose

High-blast-radius agents (ad-ops can pause live spend; launcher can spin up new campaigns; content-engine can publish to subscribers) need their reach pinned at the moment the operator dispatches them. Without the lock, a small task becomes a large incident: "monitor this one creative for fatigue" becomes "rotate three creatives and pause two adsets" because the agent's reasoning latched onto adjacent work. The lock makes the boundary mechanical, not aspirational.

## Workflow

1. **Declare scope at run start.** The first thing the agent does after reading its task is name the scope explicitly:
   - For ad-ops: the campaign ID list, the adset ID list, the date window, and the action set (allowed verbs).
   - For launcher: the target campaign objective, the budget envelope, and the geo/audience the operator named.
   - For content-engine: the asset list, the publish channel(s), and the publish window.

   Write the scope to `run_summaries.highlights.scope_lock` at run start as a single JSON object. This is the truth — every subsequent tool call is checked against it.

2. **Refuse any tool call outside scope.** Before invoking a side-effecting tool, the agent extracts the tool's target (the campaign_id the call would modify, the URL the call would post to, the asset_id the call would publish). Compare to the locked scope. If the target is not in the locked set, refuse the call and emit `finding.recorded` (category=`anomaly`, severity=`medium`, title=`"scope_lock_violation"`, payload includes the locked scope and the attempted target).

3. **Distinguish refused-but-correct from refused-and-wrong.** A refusal because the operator's task underspecified the scope is a learning signal — emit a separate finding (`category: configuration, severity: low, title: "scope_lock_under_specified"`) so the operator knows the dispatch template needs more anchoring. A refusal because the agent's reasoning drifted is the anomaly path above.

4. **Read-only expansion is permitted.** The lock applies to side-effecting tools. Read tools may scan adjacent resources (a Pipeboard fetch of a sibling campaign for context, a knowledge-base lookup) — that is research, not action. The boundary is structural: write tools check scope, read tools do not.

5. **Operator-authorized scope expansion is a NEW run.** If the operator approves a scope expansion mid-run, the safer pattern is to close the current run (`status=completed_within_scope`) and dispatch a new run with the expanded scope explicitly named. This keeps the audit trail clean and the per-run blast radius small.

6. **Emit a scope-lock summary at run close.** The `run_summaries.highlights.scope_lock` block (updated at close) carries the locked scope, every refused expansion attempt, and the rate (refusals / total tool calls). High refusal rate = the agent's reasoning is drifting; surface to the operator's eval review.

## Rules

- Scope is named at run start. An agent that fails to declare scope before its first side-effecting call is in violation (`finding.recorded` category=`configuration`, severity=`high`).
- Locked scope is immutable for the duration of the run. Edit-the-lock-then-execute is a bypass pattern; the lock is the contract.
- Side-effecting tool calls check scope; read-only tools do not.
- Refusals emit findings. Silent refusals are worse than violations — the operator needs the signal.
- Scope expansion = new run. Mid-run expansion is forbidden even with operator approval; the approval becomes a dispatch to a new run with the new scope.
- The skill assumes the agent's tool-binding layer marks each tool as side-effecting or read-only. Tools with ambiguous marking are treated as side-effecting (fail-closed default).

## Output contract

```json
{
  "scope_lock": {
    "declared_at": "<ISO timestamp>",
    "scope": { ... agent-specific shape ... },
    "side_effecting_calls_total": <int>,
    "side_effecting_calls_in_scope": <int>,
    "refused_expansion_attempts": [
      { "tool": "<tool_id>", "attempted_target": "<id-or-descriptor>", "category": "drift | under_specified" }
    ]
  }
}
```

A clean run has `refused_expansion_attempts: []` and `side_effecting_calls_total === side_effecting_calls_in_scope`. A high refusal rate is a signal the agent's prompt or the operator's dispatch template needs sharpening.
