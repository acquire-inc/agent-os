# Acqu Agent OS — Session Runbook

> Keep this open while you work the Claude Code sessions. It has: the one-time setup, the exact CLAUDE.md block to paste, and every prompt for Session A (load knowledge + prove one agent) and Session B (batch-seed). Use the companion `acqu-phase-1-agent-manifest.md` for the per-agent values the seed prompts reference.

---

## Decision: ONE Supabase

Put the agents in the **same** Supabase project as the Agent OS. Agents are rows in the OS database (registry + prompts + skills + bindings) and they read/write the same tenant-scoped knowledge/runs/approvals tables. Isolation is `tenant_id` + RLS *inside* one DB, not separate DBs. A second project would mean cross-project queries and two RLS boundaries to keep in sync — the fragmentation the multi-tenant design exists to kill. There is no separate "connect the agent to the OS" step: an agent is connected the moment its registry row exists, because the runner reads agents from the registry.

---

## Pre-flight (do once, before Session A)

**1. Put these 4 docs in the repo `/docs/` folder** (drag them into the Claude Code project, or paste contents when asked — the session can't pull them from chat):
- `main-acqu-agent-doctrine.md` — canonical: model tiers, tooling, skills, connectors
- `acqu-agent-doctrine-v2.md` — 8 domains, 26 functions, handoff chains
- `acqu-agent-doctrine.md` — detailed agent system prompts (original 14 functions)
- `acqu-os-build-spec.md` — platform build spec
- (and this runbook + the manifest, for your own reference)

**2. Secrets rotated** (they were pasted in chat earlier): Supabase DB password + service-role key. Do this first.

**3. Env present** (from your laptop / Railway, not the cloud session): `DATABASE_URL`, `AOS_VAULT_KEY`, `ANTHROPIC_API_KEY`, and for the model layer `OPENROUTER_API_KEY` + `ANTHROPIC_BASE_URL=https://openrouter.ai/api`. Migrations applied via `supabase db push` from your laptop.

**4. Safety hooks status — this gates which agents are safe to seed.** If the 1a/1b/1c hooks (PostToolUse audit → Stop/budget → PreToolUse approval) are NOT yet landed: you can still seed everything, but keep every action-taking agent at `propose` + dry-run until the hooks are live. Read-only agents (vitals) are safe regardless. Confirm hook status in Session A before Session B's action agents (ad-ops, dunning-manager).

---

## CLAUDE.md addition block (paste target for prompt A1)

Add this to the repo root `CLAUDE.md`:

```markdown
## Canonical docs (read the slice you need; don't load whole docs)
- /docs/main-acqu-agent-doctrine.md — HOW agents run: model tiers, tooling, skills, connectors. Canonical for machinery.
- /docs/acqu-agent-doctrine-v2.md — WHAT exists: 8 domains, 26 functions, 10 new functions, handoff chains.
- /docs/acqu-agent-doctrine.md — detailed agent system prompts for the original 14 functions.
- /docs/acqu-os-build-spec.md — platform build spec: data model, runner, safety hooks, sessions.

## Model tiering (model is CONFIG, never hardcoded; start T-cheap, promote only on eval failure)
- T-cheap (default):  nousresearch/hermes-4-70b   — monitors, watchers, triage, classification, single-step tools
- T-reason:           nousresearch/hermes-4-405b  — heavier non-critical analysis
- T-work:             anthropic/claude-sonnet-4.6 (or haiku for light) — multi-step orchestration, client-facing
- T-critical:         anthropic/claude-opus-4.8 / sonnet-4.6 — NEVER Hermes — high-stakes + safety

## Can't-fail agents — ALWAYS Claude (T-critical), never Hermes
ad-claim-compliance, tenant-isolation-tester, security-anomaly-watchdog, access-auditor,
contract-drafter, contract-lifecycle-manager, pricing-architect, discount-governor,
decision-memo-drafter, offer-architect, offer-validator, reinvestment-advisor,
risk-register-keeper, cliently.dev (code-writing).

## Core rules
- Agents are DATA (registry row + prompt + skills + bindings), not code modules.
- Connector OAuth: vault internally; Nango behind the connection interface at client launch.
- New agents start at autonomy `propose`; promotion is earned from approval-rate metrics.
- Confirm model slugs + Anthropic pricing against live docs before relying on them.

## Current phase
> Update each session. Now: seeding Acqu tenant agents from the manifest.
```

---

## SESSION A — load knowledge + prove ONE agent runs end-to-end

Paste in order; wait for each.

**A1**
> Add the four docs in `/docs/` (already placed) to the repo and commit. Then update root `CLAUDE.md` with the "Canonical docs", "Model tiering", "Can't-fail agents", and "Core rules" blocks I'm providing [paste the block above]. Show me the CLAUDE.md diff before committing.

**A2**
> Read `main-acqu-agent-doctrine.md` §1.5 (model matrix), §3.2 (skills), §4 (MCP bindings). Then show me the exact shape of ONE agent as data in the current schema — every row across the agents registry and its join tables (prompt, triggers, tool bindings, mcp bindings, skills, knowledge scope) needed to fully define an agent. Don't write data yet — show the template, map each doctrine field to its actual column name, and flag any field the doctrine assumes that the schema is missing.

**A3**
> Seed `vitals` for tenant Acqu as DATA ONLY using `acqu-phase-1-agent-manifest.md` (the `vitals` row) and its system prompt from `acqu-agent-doctrine.md` §2.9. Model = T-cheap (`nousresearch/hermes-4-70b`), autonomy `execute_safe`, cron 06:30. Write it as an idempotent seed script `scripts/seed/acqu-vitals.ts` and run it against the DB. Confirm the rows exist. No agent-specific app code.

**A4**
> Manually dispatch one `vitals` run now. Show me: the run record, the run_summary it wrote, cost, model used, and the Slack post (or a dry-run if connectors aren't live). Confirm the runner resolved the agent entirely from the registry with zero agent-specific code. If green, this is our seed pattern for every agent.

**Stop. Do not start Session B until A4 is green.**

---

## SESSION B — batch-seed by phase (new session, cleared context)

**B1 — Phase 1**
> Using the seed pattern from `scripts/seed/acqu-vitals.ts` and the values in `acqu-phase-1-agent-manifest.md`, seed these Acqu agents as data: `ad-ops`, `briefing`, `ea`, `expense-tracker`, `margin-monitor`, `dunning-manager`, `connector-health-monitor`, `memory-consolidator`. Pull each system prompt from the doctrine section named in the manifest. One script per agent under `scripts/seed/`, plus `seed-phase-1.ts` running all idempotently. Apply each agent's model tier, autonomy, trigger, skills, MCP bindings, and knowledge scope exactly from the manifest. Run it, then list every seeded agent with model + autonomy + trigger so I can eyeball the tiering. Stop before Phase 2.

**B2 — verify Phase 1**
> Manually dispatch each Phase-1 agent (dry-run where connectors aren't live). Give me a table: agent, ran y/n, model used, cost, autonomy, approval raised y/n, errors. Flag any wrong model tier vs the manifest and fix it. Confirm every action-taking agent (`ad-ops`, `dunning-manager`) is at `propose` and gated. Don't proceed until all green.

**B3+ — later phases, same shape**
> Seed Phase 2 (creative + the compliance gate): `creative-miner`, `creative-studio`, `creative-critic`, `content-engine`, `weekly-report`, `ad-claim-compliance` (T-critical, Claude), `win-detector`, `case-study-builder`. Rosters + tiers from `main-acqu-agent-doctrine.md` §1.5 and v2 Part F. `seed-phase-2.ts`, verify as in B2, stop.

Then Phase 3 (fulfillment + revenue ops), Phase 4 (moat + meta-layer), Phase 5 (client-facing). Each its own paste, each verified before the next.

---

## Hard gates while seeding

1. **No client-facing ad-launch chain** until `ad-claim-compliance` exists and sits in front of `launcher`.
2. **No external client tenant** until `tenant-isolation-tester` passes.
3. **Can't-fail agents seed with Claude tiers, never Hermes** — B2/B3's verification table is where you catch a mis-tier.
4. **Action agents stay `propose` + dry-run** until safety hooks 1a/1b/1c are live.
