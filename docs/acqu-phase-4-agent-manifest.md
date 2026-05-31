# Acqu Phase-4 Agent Manifest

> **Precedence:** when this file conflicts with `main-acqu-agent-doctrine.md` on machinery, **main wins**.

Phase-4 doctrine batch seed — the moat (governance, compliance, pricing, knowledge) and the meta-layer (agent management, evaluation, onboarding).

## Hard tier lock — 7 T-critical agents

These 7 are on CLAUDE.md's can't-fail list. Their seed script LITERAL is `anthropic/claude-opus-4.8`. The seed-phase-4 runner refuses to dispatch if ANY of them resolves to anything else (`HARD FAIL` exit):

| Agent | Source |
|---|---|
| `decision-memo-drafter` | v1 §2.9 |
| `contract-drafter` | v1 §2.4 |
| `contract-lifecycle-manager` | v2 D6.1 |
| `risk-register-keeper` | v2 D6.1 |
| `pricing-architect` | v2 D1.2 |
| `discount-governor` | v2 D1.2 (speed-vs-tier tradeoff documented in script header) |
| `reinvestment-advisor` | v2 D4.4 |

## Phase 4 roster (22 agents)

Run: `pnpm seed:phase-4`

| # | Agent | Tier | Model | Autonomy | Cron | Budget | Source |
|---|---|---|---|---|---|---|---|
| 1 | `compliance-health` | T-work | `claude-sonnet-4.6` | execute_safe | `0 6 * * *` | $0.50 | v1 §2.5 |
| 2 | `intel` | T-work | `claude-sonnet-4.6` | execute_safe | `0 22 * * *` | $1.50 | v1 §2.9 |
| 3 | **`decision-memo-drafter`** | **T-critical** | **`claude-opus-4.8`** | propose | on-demand | $5.00 | v1 §2.9 |
| 4 | `save-play` | T-work | `claude-sonnet-4.6` | propose | event | $1.00 | v1 §2.7 |
| 5 | `expansion-finder` | T-reason | `hermes-4-405b` | execute_safe | `0 8 * * 1` | $1.00 | v1 §2.7 |
| 6 | `discovery-prep` | T-work | `claude-sonnet-4.6` | execute_safe | event | $1.50 | v1 §2.4 |
| 7 | `call-summarizer` | T-work | `claude-sonnet-4.6` | propose | webhook | $1.00 | v1 §2.4 |
| 8 | `objection-coach` | T-work | `claude-sonnet-4.6` | execute_safe | on-demand | $0.20 | v1 §2.4 |
| 9 | **`contract-drafter`** | **T-critical** | **`claude-opus-4.8`** | propose | event | $0.80 | v1 §2.4 |
| 10 | `payment-collector` | T-cheap | `hermes-4-70b` | execute_safe | event | $0.30 | v1 §2.4 |
| 11 | `unit-economics` | T-reason | `hermes-4-405b` | execute_safe | `0 9 * * 6` | $3.00 | v1 §2.14 |
| 12 | `agent-evaluator` | T-work | `claude-sonnet-4.6` | execute_safe | `0 23 * * *` | $2.00 | v1 §2.11 |
| 13 | `agent-onboarder` | T-work | `claude-sonnet-4.6` | propose | event | $5.00 | v1 §2.11 |
| 14 | `platform-change-watcher` | T-work | `claude-sonnet-4.6` | execute_safe | `30 5 * * *` | $1.00 | v2 D3.3 (tier bumped from research's T-cheap) |
| 15 | `regulatory-watcher` | T-work | `claude-sonnet-4.6` | execute_safe | `0 6 * * 4` | $1.50 | v2 D6.1 |
| 16 | **`contract-lifecycle-manager`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | `0 6 * * *` | $0.50 | v2 D6.1 |
| 17 | **`risk-register-keeper`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | `0 8 1 * *` | $2.00 | v2 D6.1 |
| 18 | `knowledge-curator` | T-work | `claude-sonnet-4.6` | propose | `0 8 * * 0` | $2.00 | v2 D6.2 |
| 19 | `skill-librarian` | T-work | `claude-sonnet-4.6` | propose | `0 9 * * 0` | $1.50 | v2 D6.2 |
| 20 | **`pricing-architect`** | **T-critical** | **`claude-opus-4.8`** | propose | quarterly | $8.00 | v2 D1.2 |
| 21 | **`discount-governor`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | on-demand | $0.20 | v2 D1.2 |
| 22 | **`reinvestment-advisor`** | **T-critical** | **`claude-opus-4.8`** | propose | `0 16 * * 5` | $4.00 | v2 D4.4 |
| 23 | `forecast-runner` | T-reason | `hermes-4-405b` | execute_safe | `0 8 1 * *` | $3.00 | v1 §2.14 → re-homed to v2 D4.4 |

(23 entries; 22 unique — `forecast-runner` is a re-home, not a duplicate. Total seeded: 22.)

## Tier overrides vs. doctrine

Per research §F.24 — these depart from the doctrine's "Model" field:
- `expansion-finder`: doctrine sonnet → main §1.5 T-reason → hermes-4-405b
- `unit-economics`: doctrine sonnet → main §1.5 T-reason → hermes-4-405b
- `forecast-runner`: doctrine sonnet → main §1.5 T-reason → hermes-4-405b
- `payment-collector`: doctrine haiku → main §1.5 T-cheap → hermes-4-70b
- `platform-change-watcher`: research suggested T-cheap. **Operator override to T-work** (sonnet-4.6) — high-stakes monitor; missing a Meta API deprecation propagates through every ad-ops agent silently. Worth $1/run delta over hermes-70b.

## How to run

```bash
DATABASE_URL=... pnpm seed:phase-4
```

The runner hard-fails BEFORE touching the DB if any T-critical agent's model literal is wrong. Idempotent.

## B-phase verification entry point

Manually dispatch each agent (dry-run where connectors aren't live). Confirm:
- All 7 T-critical agents resolve to `anthropic/claude-opus-4.8`.
- 7 grep gate: `grep -l '"anthropic/claude-opus-4.8"' scripts/seed/acqu-{decision-memo-drafter,contract-drafter,contract-lifecycle-manager,risk-register-keeper,pricing-architect,discount-governor,reinvestment-advisor}.ts | wc -l` returns 7.
- All 4 T-reason monitors (`expansion-finder`, `unit-economics`, `forecast-runner` + `briefing`/`memory-consolidator` from prior phases) resolve to `nousresearch/hermes-4-405b`.
- `pnpm -r typecheck` green; architect 33/33.
