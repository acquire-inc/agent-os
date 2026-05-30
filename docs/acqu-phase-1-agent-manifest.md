# Acqu Phase-1 Agent Manifest

> **Precedence:** when this file conflicts with `main-acqu-agent-doctrine.md` on machinery (model, tier, autonomy default), **main wins**. This file is the per-agent operational distillation referenced by `acqu-os-session-runbook.md` B1.

This manifest is the source of truth for **Phase 1 seeding**. Each row maps directly to a TypeScript spec under `scripts/seed/acqu-<agent>.ts` and runs through the shared `seedAgent(db, spec)` helper. The seed scripts are **DATA**; this doc is the operator-readable shadow of them.

---

## Phase 1 roster (9 agents)

Seeded by `pnpm seed:phase-1` (which calls `scripts/seed/seed-phase-1.ts`).

| # | Agent | Tier | Model (OpenRouter slug) | Autonomy | Cron | Budget/run | Source prompt |
|---|---|---|---|---|---|---|---|
| 1 | `vitals` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `30 6 * * *` | $0.40 | v1 §2.9 |
| 2 | `ad-ops` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | `0 7 * * *` | $1.50 | v1 §2.5 |
| 3 | `briefing` | T-reason | `nousresearch/hermes-4-405b` | `execute_safe` | `0 8 * * *` | $0.50 | v1 §2.9 |
| 4 | `ea` | T-work | `anthropic/claude-haiku-4-5` | `propose` | `0 8,12,16 * * *` | $0.50 | v2 D7.3 (derived — see §3) |
| 5 | `expense-tracker` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `0 4 * * *` | $0.30 | v1 §2.13 |
| 6 | `margin-monitor` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `30 23 * * *` | $0.20 | v1 §2.14 |
| 7 | `dunning-manager` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | `0 9 * * *` | $1.00 | v2 D4.1 |
| 8 | `connector-health-monitor` | T-cheap | `nousresearch/hermes-4-70b` | `execute_safe` | `*/15 * * * *` | $0.05 | v2 D5.2 |
| 9 | `memory-consolidator` | T-reason | `nousresearch/hermes-4-405b` | `propose` | `30 23 * * *` | $1.00 | v2 D6.2 |

**Action agents** (write side-effects) → `propose` until eval-promoted: `ad-ops`, `ea`, `dunning-manager`, `memory-consolidator` (proposes policy changes).

**Read-only / alert agents** → `execute_safe`: `vitals`, `briefing`, `expense-tracker` (categorize + ledger within bounded categories), `margin-monitor`, `connector-health-monitor`.

---

## Per-agent specs

### 1. `vitals`
- **Project**: Founder Ops
- **Knowledge scope**: `folders=["metrics"]`
- **Skills**: `verification-before-completion`, `morning-vitals`
- **MCPs**: Pipeboard × Meta, Close, Slack
- **Spec file**: `scripts/seed/acqu-vitals.ts`

### 2. `ad-ops`
- **Project**: Ad-Ops
- **Knowledge scope**: `folders=["ad-playbooks","clients"]`, `tags=["meta","marketing"]`
- **Skills**: `daily-ad-ops`, `verification-before-completion`, `clarify-before-acting`
- **MCPs**: Pipeboard × Meta, Slack, Close
- **Hard rule from prompt**: never write to Meta without approval; ≤2× budget change/day; ≥3 days run before kill; halt if Pixel Health flags.
- **Spec file**: `scripts/seed/acqu-ad-ops.ts`

### 3. `briefing`
- **Project**: Founder Ops
- **Knowledge scope**: `folders=["memory","run-logs"]`
- **Skills**: `verification-before-completion`, `briefing-synthesis`
- **MCPs**: Slack, pgvector Knowledge
- **Spec file**: `scripts/seed/acqu-briefing.ts`

### 4. `ea`
- **Project**: Founder Ops
- **Knowledge scope**: `folders=["memory"]`
- **Skills**: `clarify-before-acting`, `verification-before-completion`
- **MCPs**: Gmail, Slack, Google Calendar
- **Prompt provenance**: v2 D7.3 description ("Inbox triage, reply drafting, founder's daily report, deadline watch, meeting prep" — line 1688). v2 line 1693 states "These keep their v1 prompts" but v1 line 3160 only references EA without a prompt block. The seed contains a **canonical draft** synthesized from v2's role description and the chain position (vitals → briefing → ea → decision-memo). When the v1 block is recovered, replace the draft in `scripts/seed/acqu-ea.ts` — content-hash versioning will create a new `agent_prompts` row automatically.
- **Spec file**: `scripts/seed/acqu-ea.ts`

### 5. `expense-tracker`
- **Project**: (Finance — to seed)
- **Knowledge scope**: `folders=["finance"]`
- **Skills**: `verification-before-completion`, `expense-categorization`
- **MCPs**: Slack, Stripe (disconnected), QuickBooks (disconnected)
- **Note**: Stripe/QuickBooks are seeded in `demoMcps` as `disconnected`. Binding the agent now is forward-compatible; the runner will skip disconnected MCPs.
- **Spec file**: `scripts/seed/acqu-expense-tracker.ts`

### 6. `margin-monitor`
- **Project**: (Finance — to seed)
- **Knowledge scope**: `folders=["finance","clients"]`
- **Skills**: `verification-before-completion`, `margin-alerts`
- **MCPs**: Slack
- **Spec file**: `scripts/seed/acqu-margin-monitor.ts`

### 7. `dunning-manager`
- **Project**: (Revenue Ops — to seed)
- **Knowledge scope**: `folders=["finance","clients"]`, `tags=["finance","client-success"]`
- **Skills**: `dunning-sequence`, `verification-before-completion`, `clarify-before-acting`
- **MCPs**: Close, Slack, Stripe (disconnected)
- **Hard rule**: never shame; smart retries only; flag repeat-failure clients to churn-risk-detector (D2.3).
- **Spec file**: `scripts/seed/acqu-dunning-manager.ts`

### 8. `connector-health-monitor`
- **Project**: Infra
- **Knowledge scope**: `folders=["infra"]`
- **Skills**: `connector-health`, `verification-before-completion`
- **MCPs**: Slack
- **Note**: This is the canonical T-cheap volume example from main §1.4 (~2,880×/month at ~$1/mo on 70B vs ~$7.50 on 405B). Hard-cap $0.05/run.
- **Spec file**: `scripts/seed/acqu-connector-health-monitor.ts`

### 9. `memory-consolidator`
- **Project**: Founder Ops
- **Knowledge scope**: `folders=["memory","run-logs"]`
- **Skills**: `memory-consolidation`, `verification-before-completion`
- **MCPs**: Google Drive, Slack, pgvector Knowledge
- **Hard rule**: append freely to lesson logs; **propose** (never silently change) policy/SOP/threshold changes.
- **Spec file**: `scripts/seed/acqu-memory-consolidator.ts`

---

## Skill files (`external/acqu-skills/<key>/SKILL.md`)

The seed helper (`ensureSkillFromDir`) reads `SKILL.md` if present and content-hashes for the version. Missing files are tolerated (version `0.0.0`, empty description) — the skill row is still registered by `key`, and the registry sync can backfill once the SKILL.md is authored.

**Authored** (committed): `verification-before-completion`, `morning-vitals`.

**Referenced by Phase-1 but not yet authored**: `daily-ad-ops`, `clarify-before-acting`, `briefing-synthesis`, `expense-categorization`, `margin-alerts`, `dunning-sequence`, `connector-health`, `memory-consolidation`. These will be authored as the matching agent's first eval surfaces real failure modes.

---

## How to run

```bash
# All Phase-1 agents in one pass (idempotent)
DATABASE_URL=... pnpm seed:phase-1

# Or one at a time
DATABASE_URL=... pnpm --filter @agent-os/seed run acqu-ad-ops
DATABASE_URL=... pnpm --filter @agent-os/seed run acqu-dunning-manager
# ...etc
```

Each script is idempotent: re-running brings the DB to the same final state. A change to a system prompt produces a new `agent_prompts` row (content-hash versioned) and demotes the prior `is_current=true`.

---

## Verification (B2 entry point)

After seeding, run B2 from the runbook:

> Manually dispatch each Phase-1 agent (dry-run where connectors aren't live). Give me a table: agent, ran y/n, model used, cost, autonomy, approval raised y/n, errors. Flag any wrong model tier vs the manifest and fix it. Confirm every action-taking agent (`ad-ops`, `dunning-manager`) is at `propose` and gated.

The seed script's print table is the input to B2.
