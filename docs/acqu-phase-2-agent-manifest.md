# Acqu Phase-2 Agent Manifest

> **Precedence:** when this file conflicts with `main-acqu-agent-doctrine.md` on machinery, **main wins**. This is the per-agent operational distillation referenced by `acqu-os-session-runbook.md` B3.

This manifest is the source of truth for **Phase 2 seeding** — the creative engine and the **ad-claim-compliance hard gate** that blocks every client-facing ad launch.

---

## Hard gate unblocked by Phase 2

Per main §6 / runbook hard-gates:
> **No client ad launches before `ad-claim-compliance` (D6.1) exists.** (Ban/FTC protection.)

Seeding Phase 2 puts `ad-claim-compliance` in the registry as data. The agent runs at **autonomy = `propose`** (binding verdict, but the launcher waits on operator approval until the agent's eval rate justifies promotion).

---

## Phase 2 roster (8 agents)

Seeded by `pnpm seed:phase-2`.

| # | Agent | Tier | Model (OpenRouter slug) | Autonomy | Cron | Budget/run | Source |
|---|---|---|---|---|---|---|---|
| 1 | `creative-miner` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | `30 6 * * *` | $2.50 | v1 §2.5 / v2 D1.3 |
| 2 | `creative-studio` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | event-only | $2.00 | v1 §2.2 / v2 D1.3 |
| 3 | `creative-critic` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | spawned-by-studio | $1.00 | v1 §2.2 / v2 D1.3 |
| 4 | `content-engine` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | `0 10 * * *` | $2.00 | v1 §2.2 / v2 D1.3 |
| 5 | `weekly-report` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | `0 7 * * 6` | $2.00 | v1 §2.5 / v2 D2.1 |
| 6 | **`ad-claim-compliance`** | **T-critical** | **`anthropic/claude-opus-4.8`** | `propose` | pre-launch gate | $3.00 | v2 §D6.1 |
| 7 | `win-detector` | T-work | `anthropic/claude-sonnet-4.6` | `execute_safe` | `30 7 * * *` | $0.40 | v2 §D2.4 |
| 8 | `case-study-builder` | T-work | `anthropic/claude-sonnet-4.6` | `propose` | event-only | $2.00 | v2 §D2.4 |

**Action agents** (write side-effects, external comms) → `propose`: `creative-studio`, `content-engine`, `weekly-report`, `ad-claim-compliance`, `case-study-builder`.

**Read-only / research agents** → `execute_safe`: `creative-miner`, `creative-critic`, `win-detector`.

**T-critical lock**: `ad-claim-compliance` model is **never** Hermes. CLAUDE.md can't-fail list + seed script enforce `anthropic/claude-opus-4.8`. The Architect refuses to assemble this agent — it's hand-authored only.

---

## Per-agent specs

### 1. `creative-miner`
- **Knowledge scope**: `folders=["ad-playbooks","swipes","verticals"]`, `tags=["meta","creative"]`
- **Skills**: `competitor-ad-teardown`, `verification-before-completion`
- **MCPs**: Google Drive, Slack, Pipeboard × Meta
- **Spec file**: `scripts/seed/acqu-creative-miner.ts`

### 2. `creative-studio`
- **Knowledge scope**: `folders=["copywriting","ad-playbooks","swipes"]`, `tags=["creative","marketing"]`
- **Skills**: `creative-generation`, `verification-before-completion`
- **MCPs**: Google Drive, Slack
- **Trigger**: on-demand (spawned by `creative-miner` brief greenlight or founder ask)
- **Spec file**: `scripts/seed/acqu-creative-studio.ts`

### 3. `creative-critic`
- **Knowledge scope**: `folders=["copywriting"]`, `tags=["creative"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Slack
- **Trigger**: spawned by `creative-studio` (adversarial critique step)
- **Spec file**: `scripts/seed/acqu-creative-critic.ts`

### 4. `content-engine`
- **Knowledge scope**: `folders=["content","copywriting"]`, `tags=["content","marketing"]`
- **Skills**: `content-engine`, `verification-before-completion`
- **MCPs**: Google Drive, Slack
- **Spec file**: `scripts/seed/acqu-content-engine.ts`

### 5. `weekly-report`
- **Knowledge scope**: `folders=["reports","clients"]`, `tags=["client-success","reporting"]`
- **Skills**: `weekly-client-reporting`, `verification-before-completion`
- **MCPs**: Pipeboard × Meta, Close, Google Drive, Slack
- **Spec file**: `scripts/seed/acqu-weekly-report.ts`

### 6. `ad-claim-compliance` — T-CRITICAL hard gate
- **Knowledge scope**: `folders=["proof","compliance"]`, `tags=["compliance","legal"]`
- **Skills**: `ftc-claim-review`, `clarify-before-acting`, `verification-before-completion`
- **MCPs**: Slack
- **Escalation policy**: `tcritical:any_uncertainty -> human_review`
- **Hard rule**: model is **`anthropic/claude-opus-4.8`** — enforced by the seed script's literal, by CLAUDE.md, and refused by the Architect. Any PR changing this line should be rejected.
- **Spec file**: `scripts/seed/acqu-ad-claim-compliance.ts`

### 7. `win-detector`
- **Knowledge scope**: `folders=["clients","proof"]`, `tags=["client-success","proof"]`
- **Skills**: `verification-before-completion`
- **MCPs**: Close, Pipeboard × Meta, Slack
- **Spec file**: `scripts/seed/acqu-win-detector.ts`

### 8. `case-study-builder`
- **Knowledge scope**: `folders=["proof","clients"]`, `tags=["proof","marketing"]`
- **Skills**: `verification-before-completion`, `clarify-before-acting`
- **MCPs**: Close, Google Drive, Slack
- **Spec file**: `scripts/seed/acqu-case-study-builder.ts`

---

## Skill files

Same convention as Phase-1: the seed helper reads `external/acqu-skills/<key>/SKILL.md` and content-hashes for the version. Missing files are tolerated (version `0.0.0`).

**Already authored** (Phase-1 carryover): `verification-before-completion`, `morning-vitals`, `clarify-before-acting`, `competitor-ad-teardown`, `creative-generation`, `content-engine`, `weekly-client-reporting`.

**Referenced by Phase-2 but not yet authored**: `ftc-claim-review` (the can't-fail skill — author next; binds to `ad-claim-compliance`).

---

## How to run

```bash
DATABASE_URL=... pnpm seed:phase-2

# Or individually
DATABASE_URL=... pnpm --filter @agent-os/seed run acqu-ad-claim-compliance
```

Idempotent: re-running brings the DB to the same final state. A change to a system prompt produces a new versioned `agent_prompts` row and demotes the prior.

---

## B3 verification entry point

After seeding, dispatch each agent and confirm:
- All 7 non-critical agents resolve to `anthropic/claude-sonnet-4.6`.
- `ad-claim-compliance` resolves to `anthropic/claude-opus-4.8`. **If it ever resolves to anything else, halt the entire pipeline.**
- `creative-miner` + `weekly-report` + `content-engine` + `win-detector` show their crons in the agent_triggers projection.
- Spawned-only agents (`creative-studio`, `creative-critic`, `case-study-builder`) have no cron trigger but appear in the registry with their bindings.
