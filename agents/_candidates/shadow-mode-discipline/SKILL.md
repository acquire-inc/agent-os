---
name: shadow-mode-discipline
description: Use on every send-class action — email, SMS, DM, reply, outreach, notify, post-message, any outbound to a real recipient. Shadow defaults ON. A six-layer denial gate with fail-CLOSED state reads; every approval-rail decision becomes a labeled eval row that feeds the trust-ramp out of shadow. Surfaces our existing approvals workflow as canonical doctrine.
---
# SKILL: Shadow Mode Discipline

The doctrine layer for the approvals workflow at `apps/runner/src/approvals/`. The runner already enforces an autonomy-tier gate plus an approvals inbox; this skill names the six layers that gate evaluates, the fail-closed posture on state-store reads, and the dataset accumulation that turns operator decisions into labeled eval rows. Pairs with the planned shadow-dataset logger (Tier 2 backlog, §A1 of the self-improvement spec): every approve / edit / reject decision becomes a row the agent-evaluator scorecard reads to track first-pass approval rate.

The skill is documentation of an existing mechanism, not a new runtime hook. Attaches (after operator approval) to any send-emitting agent class. Not attached in this phase per the Phase 11 quarantine.

## Purpose

A client-facing outbound message never leaves the control plane without a human deciding it should. The structural answer is shadow mode on by default, every send routed through the approvals inbox, and a six-stage denial gate that fails closed on any state-read error. The failure class this prevents is the bulk-send incident — one run, one inbox, dozens of messages on the wire before anyone noticed, because the implicit caps were policy rather than mechanical. The per-run cap, the per-recipient rolling cap, and the explicit approval row are the structural answer to exactly that failure class; the fail-closed reads are the structural answer to "Supabase blipped, the gate thought everything was fine."

Default posture is draft-and-route until a per-category lift is recorded in writing by the operator. Earning the lift requires the labeled eval rows to climb past the operator's chosen threshold (first-pass approval rate, no high-severity findings in the recent window); the runtime never infers "good enough to lift" on its own.

## Workflow

A send-class call passes only when six conditions all hold, in this order. Any one failing aborts the call with a recorded denial — silent retry is forbidden.

1. **Stage 1 — Shadow flag for this (tenant, agent class, send category) is OFF.** The flag lives on the tenant row's `tier_overrides` jsonb (or the dedicated `tenants.shadow_modes` table once it lands). Defaults: shadow ON for the first 30 days after a new tenant is provisioned, shadow ON for any newly-deployed agent class, shadow ON for any new send category (email, SMS, DM, etc.) the agent has not previously been approved for. Lifting the flag is an operator-recorded action that lands as an audit row; the runtime never flips it on its own. If the tenant row is unreachable, the stage is treated as shadow-ON (fail-closed read).

2. **Stage 2 — Per-run send count is below the cap.** The cap defaults to one outbound per run, lives on the agent registry row as `send_cap_per_run`, and is read alongside the agent's other budget fields. Counted against the per-run ledger entries the runner already keeps for `tool.dispatched` events of send class. Exceeding the cap denies the second send; raising the cap requires an `approval.requested` with the rationale, the operator decides, the new cap becomes the registry value going forward.

3. **Stage 3 — Per-recipient rolling 24h count is below the cap.** The cap defaults to one per recipient per 24h, counted from the `agent_sent_log` ledger entries (stage 6) joined on `recipient`. The 24h window is rolling, not calendar-day. A repeated send to the same recipient inside the window is denied regardless of which run dispatched it. This is the structural answer to bulk-recipient incidents; the per-run cap stops the inside-the-run failure mode, the per-recipient cap stops the across-runs failure mode.

4. **Stage 4 — A matching approval row with status `approved` exists.** The agent calls `raiseApproval` earlier in the run; the approvals workflow at `apps/runner/src/approvals/` writes a `pending` row, the operator approves through the inbox UI, the runner promotes the row to `approved`, and the send gate reads it at this stage. No row, no send. A `pending` row at this stage holds the send (does not deny it) until the operator decides; a `rejected` row denies it.

5. **Stage 5 — An idempotency key is attached to the send tool invocation.** The key derives from `run_id` plus `recipient` plus `content_hash`. The send tool (or n8n webhook, or whichever destination handler) dedupes retries against the key; without it, a retry caused by a downstream timeout becomes a duplicate send. The runner refuses to dispatch the call if the key is missing.

6. **Stage 6 — The ledger write to `agent_sent_log` lands.** The ledger row carries `run_id, agent_key, tenant_id, recipient, idempotency_key, sent_at, payload_hash`. Stages 2 and 3 read this ledger; if the write fails (database unreachable, constraint violation), the send is denied (fail-closed write). After the destination confirms delivery, the ledger row's `delivery_status` is updated (delivered, bounced, spam-marked, complaint) and feeds the per-category trust ramp.

Every gate denial logs a labeled row: `{ts, agent_key, run_id, recipient, draft_content, denied_at_stage, operator_decision, operator_edit}`. The shadow-dataset feeds the first-pass approval rate KPI; sustained climb is the precondition for the operator to lift shadow on a category.

## Rules

- **Shadow is the default; lifting is an action.** Default-on for new tenants, new agent classes, new send categories. The operator lifts in writing, per category, when the dataset shows the agent has earned it. No runtime inference, no auto-lift.
- **State-store reads fail closed at every stage.** Tenant row unreachable → shadow ON. Registry row unreadable → cap is one. Ledger query times out → deny the recipient stage. The safe direction on any infrastructure flake is "do not send."
- **The send-class matcher stays deliberately broad.** Any tool whose name or path matches `send|reply|outreach|outbound|email|sms|dm|message|notify|post_message|whatsapp|telegram_send|mail` is gated, including tools we have not specifically registered as send-class. Tightening the matcher to be precise is the silent-ungated-send failure mode.
- **Cap-raise requires explicit approval; in-prompt overrides do not count.** An agent that writes "I am raising my cap for this run" in its reasoning does not raise its cap; only an `approval.resolved` row with the cap-raise as the resolution does.
- **Per-recipient enforcement counts the ledger, not the cache.** A cold-start agent that has not loaded the recent ledger entries denies the call on a recipient it cannot prove is below cap. In-memory state is an optimization, never the source of truth.
- **Idempotency key is mechanical, not discretionary.** No dispatch without the key. A send tool that does not support idempotency keys is a registration error; the runner refuses to bind it as a send-class tool.
- **Stage ordering is fixed.** Cheapest reads first (shadow flag, then in-run count), then ledger query, then approval row, then key check, then ledger write. Reordering is a different gate.
- **Drafts are the deliverable until the lift lands.** While shadow is on, the agent's output is the draft routed through the approvals inbox; the operator's approve / edit / reject is the send decision. The agent is not "blocked" by shadow — drafting is the work.

## Output contract

The agent's `run_summaries.highlights` carries:

```json
{
  "send_gate": {
    "attempts": <int>,
    "approved": <int>,
    "denied_at_stage": {"1": <int>, "2": <int>, "3": <int>, "4": <int>, "5": <int>, "6": <int>},
    "ledger_rows_written": <int>,
    "shadow_active": true | false,
    "category": "email | sms | dm | reply | post | other"
  }
}
```

The shadow-dataset row (recorded by the §A1 logger when it lands; for now lives in the `approvals` table):

```json
{
  "ts": "<iso>",
  "agent_key": "<key>",
  "run_id": "<uuid>",
  "tenant_id": "<uuid>",
  "task": "<one-line>",
  "input_context_hash": "<hash>",
  "draft_content": "<full text>",
  "judge_verdict": "<output_quality_gate verdict or null>",
  "operator_decision": "approved | edited | rejected",
  "operator_edit": "<the operator's text if edited>"
}
```

Relay events emitted by the gate:
- `tool.dispatched` is intercepted by the runner BEFORE the actual send tool dispatches; if any stage denies, the runner never invokes the underlying tool
- `approval.requested` when stages 1-3 + 5 + 6 pass but stage 4 has no row
- `approval.resolved` once the operator decides
- `autonomy.denied` on every denied call with `rationale = "send_gate: stage_<N>"`
- `tool.result` lands only on a fully-passed send after the destination confirms delivery

The `summary_text` field: `"Send gate: <attempts> calls, <approved> approved, <denied total> denied (at stages <list>); shadow=<on|off>."`

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_path: hermes-runtime/skills/agentic/gate-never-send-without-approval/SKILL.md
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the six-stage gate structure, the fail-closed state-read posture, the broad send-class matcher, the shadow-defaults-on rule, the trust-ramp framing, and the per-recipient-rolling-window cap from the source. Re-authored every sentence in our voice; the stage labels are ours (the source uses "layers"); the shadow-dataset row schema is from our §A1 framing in the self-improvement Tier 2 backlog, not the source's `~/.hermes/evals/dataset.jsonl` format. Mapped the gate onto our existing surfaces — `apps/runner/src/approvals/`, `agents.send_cap_per_run` registry field, `agent_sent_log` ledger, and Relay events from the closed 28-event namespace (`tool.dispatched`, `approval.requested`, `approval.resolved`, `autonomy.denied`, `tool.result`). Source's substrate-specific machinery (the `request_approval` Telegram tool, the `canUseTool` SDK hook, the `n8n-webhook.ts` ledger writer, the `0002_send_safety.sql` migration name) was mapped to our equivalents.
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
