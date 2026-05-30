# Acqu Phase-3 Agent Manifest

> **Precedence:** when this file conflicts with `main-acqu-agent-doctrine.md` on machinery, **main wins**. Operator-facing distillation referenced by `acqu-os-session-runbook.md` Phase 3.

This manifest is the source of truth for **Phase 3 seeding** — the fulfillment + revenue-ops backbone (the doctrine creative→launch chain's tail, the funnel watch, the client-success loop, and the finance reconciliation chain E.7).

---

## Hard gate the operator must honor

> **`launcher` is post-compliance-gated.** Before flipping `launcher.enabled=true`, verify `ad-claim-compliance` (Phase 5) is `enabled=true` and reachable. The runtime doesn't enforce this gate — autonomy=`propose` keeps every launch behind an approval, but the operator's discipline matters: don't approve a launch that the compliance gate hasn't reviewed.

---

## Phase 3 roster (12 agents)

Seeded by `pnpm seed:phase-3`.

| # | Agent | Tier | Model (OpenRouter slug) | Autonomy | Cron | Budget/run | Source |
|---|---|---|---|---|---|---|---|
| 1 | **`launcher`** | T-work | `anthropic/claude-sonnet-4.6` | **`propose`** | event-only | $0.50 | v1 §2.5 |
| 2 | `lead-triage` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | webhook | $0.50 | v1 §2.3 |
| 3 | `booking-concierge` | T-work-lite | `anthropic/claude-haiku-4-5` | `execute_safe` | `0 * * * *` | $0.20 | v1 §2.3 |
| 4 | `funnel-monitor` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `0 * * * *` | $0.20 | v1 §2.3 |
| 5 | `onboarding-runner` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | event-only | $2.00 | v1 §2.6 |
| 6 | `client-comms` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | event-only | $0.50 | v1 §2.6 |
| 7 | `client-health` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | `30 6 * * *` | $0.50 | v1 §2.6 |
| 8 | `churn-risk-detector` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | `45 6 * * *` | $0.50 | v1 §2.7 |
| 9 | `ar-aging-monitor` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `0 6 * * *` | $0.20 | v2 D4.1 |
| 10 | `revenue-recognizer` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `30 2 * * *` | $0.30 | v2 D4.1 |
| 11 | `cash-position-monitor` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `0 6 * * *` | $0.20 | v2 D4.4 |
| 12 | `runway-watcher` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | `0 7 * * 1` | $1.00 | v2 D4.4 |

**Action / outbound agents** at `propose`: `launcher`, `onboarding-runner`, `client-comms`.

**Read-only / monitors** at `execute_safe`: everything else (8 agents).

**No T-critical agents in Phase 3** — verified. `ad-claim-compliance` is the only can't-fail Phase-3-adjacent agent and shipped in Phase 5.

---

## Finance reconciliation chain (E.7) — now substantially complete

```
02:30 revenue-recognizer (D4.1)   ← Phase 3 (this batch)
04:00 expense-tracker (D4.2)      ← Phase 1
─────────────────────────────────
06:00 cash-position-monitor (D4.4) ← Phase 3 (this batch)
06:00 ar-aging-monitor (D4.1)      ← Phase 3 (this batch)
23:30 margin-monitor (D4.3)        ← Phase 1
Mon 07:00 runway-watcher (D4.4)    ← Phase 3 (this batch)
```

Still missing for full E.7: `attribution-reconciler` (D3.1 — Data Tracking, queued for Phase 8) and `billing-runner` (D4.1 — queued for Phase 8).

---

## Per-agent specs

### 1. `launcher` — HARD GATE
- **Knowledge scope**: `folders=["ad-playbooks","campaign-plan"]`, `tags=["meta","marketing"]`
- **Skills**: `launch-discipline`, `naming-convention`, `verification-before-completion`
- **MCPs**: Pipeboard × Meta, Slack
- **Discipline**: every launch is PAUSED status; budget locked at $10; no exceptions.

### 2. `lead-triage`
- **Knowledge scope**: `folders=["icp","clients"]`, `tags=["sales"]`
- **Skills**: `lead-routing-qualification`, `verification-before-completion`
- **MCPs**: Close, Slack, Twilio

### 3. `booking-concierge`
- **Knowledge scope**: `folders=["funnel","clients"]`, `tags=["sales"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Close, Slack, Twilio, Gmail
- **Note**: hourly cron handles the no-show recovery sequence (T+1h post-scheduled-time check).

### 4. `funnel-monitor`
- **Knowledge scope**: `folders=["funnel"]`, `tags=["sales","ops"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Slack

### 5. `onboarding-runner`
- **Knowledge scope**: `folders=["onboarding","clients"]`, `tags=["client-success"]`
- **Skills**: `client-onboarding`, `verification-before-completion`
- **MCPs**: Close, Slack, Google Drive, Gmail

### 6. `client-comms`
- **Knowledge scope**: `folders=["clients","comms"]`, `tags=["client-success"]`
- **Skills**: `verification-before-completion`, `clarify-before-acting`
- **MCPs**: Close, Google Drive, Slack, Gmail

### 7. `client-health`
- **Knowledge scope**: `folders=["clients","health"]`, `tags=["client-success","research"]`
- **Skills**: `client-health-scan`, `verification-before-completion`
- **MCPs**: Close, Slack

### 8. `churn-risk-detector`
- **Knowledge scope**: `folders=["clients","churn"]`, `tags=["client-success","retention"]`
- **Skills**: `churn-risk-detection`, `verification-before-completion`
- **MCPs**: Close, Slack

### 9. `ar-aging-monitor`
- **Knowledge scope**: `folders=["finance","clients"]`, `tags=["finance"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Close, Slack

### 10. `revenue-recognizer`
- **Knowledge scope**: `folders=["finance"]`, `tags=["finance"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Close

### 11. `cash-position-monitor`
- **Knowledge scope**: `folders=["finance"]`, `tags=["finance"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Slack

### 12. `runway-watcher`
- **Knowledge scope**: `folders=["finance"]`, `tags=["finance"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Slack, Google Drive

---

## How to run

```bash
DATABASE_URL=... pnpm seed:phase-3

# Or individually
DATABASE_URL=... pnpm --filter @agent-os/seed run acqu-launcher
```

Idempotent: re-running brings the DB to the same final state.

---

## Verification entry point

Manual dispatch each agent (dry-run where connectors aren't live). Confirm:
- `launcher` is at `propose` and waits on approval before any tool.2 call.
- `client-health` (06:30) and `churn-risk-detector` (06:45) run in sequence — health → churn signal.
- Finance reconciliation chain E.7: `revenue-recognizer` (02:30) completes before `cash-position-monitor` / `ar-aging-monitor` (06:00) read.
- All 9 non-launcher action agents at the documented model + autonomy.
