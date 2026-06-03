---
name: shadow-mode-discipline
description: Use on every AgentOS agent running at autonomy=propose. Shadow mode means the agent computes the full plan, simulates the tool calls, and writes the proposal — but does NOT execute any side-effecting action. The operator approves before any execution. This is the entry rung of the autonomy ladder and the only safe state for a new or recently-demoted agent.
---
# Shadow Mode Discipline

The discipline that makes `autonomy: propose` actually safe — instead of "the agent ran but pretended not to," shadow mode means the agent went all the way to the brink of action and stopped at the line, then handed the operator a real proposal they can accept or reject in one click.

## Purpose

`autonomy: propose` is the floor of the AgentOS autonomy ladder (`propose` → `execute_safe` → `execute_full`). New agents start here. Agents that fail evals get demoted here. Without discipline, "propose" degenerates into "the agent did the easy half and stopped before the hard part" — the operator gets a vague suggestion instead of a precise, reviewable plan. Shadow mode is the protocol that makes the propose rung load-bearing.

## Workflow

1. **Plan to the brink.** Compute the full reasoning chain end-to-end — what to do, what arguments, what order. Do not skip detail because "the operator will fill it in." The proposal must be precise enough that approve = execute, no follow-up clarification needed.

2. **Simulate every side-effecting tool call.** For each tool the plan would invoke, build the exact arguments (the literal payload, the literal endpoint, the literal recipient list). Do not actually call the tool. Record the simulated call in the proposal: tool name, full argument JSON, expected effect, estimated cost.

3. **Dry-run the read-only tools.** Tools that only fetch data (no write, no send, no payment, no auth state change) MAY actually run in shadow mode — their output feeds the proposal. The distinction is structural: side-effecting tools simulate; read-only tools execute. Document which is which in the agent's tool registry binding.

4. **Write the proposal as one structured artifact.** Single Markdown doc with: what + why (one paragraph), the simulated side-effecting calls (table: tool / args / effect / cost), the read-only evidence (citations to `tool.result` events), the rollback plan if executed and wrong, and the explicit ask (approve / reject / revise).

5. **Raise an Approval — do not just write a file.** Use `raiseApproval(...)`. The proposal artifact is the body; the approval ticket is the operator's surface. Approval options: `approve` (executes the simulated calls), `approve-with-edits` (operator inlines arg changes), `reject` (closes the run with `status=rejected`), `escalate` (kicks to a human reviewer for high-stakes runs).

6. **On approve, execute exactly the simulated calls.** No drift. If the agent decides at execute time that "actually let me adjust this argument," that is a violation — re-propose with the new args. The approval is contract-bound to the simulated payload.

7. **On reject, capture the reason.** Operator rejection without a stated reason is logged as `autonomy.denied` with `reason: unspecified`. Operator rejection with a reason populates the agent's learning corpus (`knowledge://learning/<agent_key>/rejections.md`).

## Rules

- Shadow does not mean lazy. The agent does the full work; only the side-effecting half pauses.
- A proposal that says "do something reasonable with the meta campaigns" is not a proposal. It is a confession. Re-do the work.
- Side-effecting calls are simulated, never executed without approval. Read-only calls run normally to feed the proposal.
- Approve = execute the literal simulated payload. Any drift between simulated args and executed args is a finding (`category: anomaly, severity: medium`).
- Rejection without reason is not a learning signal but it is still logged. The audit trail must be complete.
- Promotion to `execute_safe` is earned from N consecutive approvals at a configured rate (per-agent threshold in `agents.promotion_policy`). Shadow mode is not punishment — it is the proving ground.
- Demotion back to shadow is automatic on eval failure or `cantfail.*` Relay event involvement. The agent does not get to argue.

## Output contract

```json
{
  "shadow_mode": {
    "simulated_calls": [
      { "tool": "<tool_id>", "args": { ... }, "expected_effect": "<one sentence>", "est_cost_usd": "<dec>" }
    ],
    "read_only_calls": [
      { "tool": "<tool_id>", "tool_result_event_id": "<uuid>" }
    ],
    "approval_id": "<uuid>",
    "approval_status": "pending | approved | approved_with_edits | rejected | escalated"
  }
}
```

`approval_status` updates on the operator's action; the run does not close until the approval resolves.
