# Handoff: from Agent OS session → Agent-building session

> **From:** the Agent OS platform session (this repo, branch `claude/exciting-davinci-yvptm`).
> **To:** the session where the actual agents + VPS infra are built.
> **Date:** 2026-05-30.

## What's done on the platform (this repo)

The OS substrate is shipped through Phase 8.5. Branch `claude/exciting-davinci-yvptm`.

**Doctrine + safety hooks** (Phase 1)
- /docs/main-acqu-agent-doctrine.md (v3), /docs/acqu-agent-doctrine.md (v1), /docs/acqu-agent-doctrine-v2.md (v2).
- Safety hooks 1a/1b/1c: PostToolUse audit, Stop/budget cap, PreToolUse approval gate.
- Migrations 0001–0005 (init + pg_cron + autonomy_events + agent_prompts + agent_triggers).

**Agents-as-data substrate** (Phases 2, 5, 6, 8)
- `seedAgent(db, spec, { skillSource })` — idempotent helper. Upserts by `(tenantId, key)`. Versioned prompts via content-hash.
- 50+ Acqu agents seeded across Phase 1 (8) + Phase 2 (8) + Phase 3 (12) + Phase 4 (22) doctrine batches. All in `scripts/seed/acqu-*.ts`.
- Manifests at `docs/acqu-phase-{1,2,3,4}-agent-manifest.md`.

**Architect feature** (Phases 3, 4)
- POST /api/admin/architect/propose — plain-English → blueprint.
- POST /api/admin/architect/seed — commits blueprint to agent rows.
- `mode: "team" | "single" | "remix"`.
- /architect UI in apps/control-plane.
- 33/33 unit tests passing.

**Tools registry + Inngest scheduler + tool.browser** (Phase 7)
- Migration 0007: `tools` + `agent_tools` tables (mirror skills/MCPs).
- `@agent-os/inngest` package — durable scheduler.
- Migration 0008: pg_cron now POSTs `agent/scheduled.run` events to Inngest.
- `@agent-os/tool-browser` — SSRF guard + `runBrowserTool(input)` (Node fetch backend; Stagehand backend is your call to wire when an agent binds it).
- Runner `deriveAllowedTools` + custom-tool dispatch.

**Autonomous-team primitives** (Phase 8.5 — THIS HANDOFF)
- Migration 0009: `agents.lifecycle_state` (`draft|active|paused|archived`) + `tenants.default_model_override`.
- API: `POST /api/admin/agents/:id/{activate,pause,archive,draft}` — lifecycle transitions.
- API: `PUT /api/admin/tenants/me/model-override { model }` — sets tenant-wide override.
- API: `POST /api/admin/tenants/me/apply-model-override` — bulk-rewrites all agent rows for the tenant to the override (idempotent).
- `seedAgent` reads `tenants.default_model_override` at insert/update time and rewrites `spec.model` accordingly (with a console warning when overriding a can't-fail default).
- Runner `/next` refuses work for any agent whose `lifecycle_state !== 'active'` OR `enabled=false`.

## What you (the other session) need to build

### 1. Apply the platform to your VPS

- `git pull` the branch.
- `supabase db push` (applies migrations 0007 + 0008 + 0009).
- Run the seed scripts you want active on your VPS: `pnpm seed:phase-1`, `pnpm seed:phase-2`, `pnpm seed:phase-3`, `pnpm seed:phase-4`, `pnpm seed:tool-browser`.
- Deploy `apps/runner` to the VPS (the runner is the worker that claims runs and executes them via the Claude Agent SDK over OpenRouter).
- Deploy `apps/api` to the VPS or to Railway — runner needs to reach it.
- Deploy `apps/scheduler` if you're not using Inngest; otherwise wire pg_cron → Inngest webhook URL.

### 2. Hermes-4-405B everywhere policy

Per operator directive:

```bash
# Set the override on the Acqu tenant
curl -X PUT https://<api>/api/admin/tenants/me/model-override \
  -H "Authorization: Bearer <admin-key>" \
  -H "content-type: application/json" \
  -d '{"model": "nousresearch/hermes-4-405b"}'

# Apply it to every existing agent row
curl -X POST https://<api>/api/admin/tenants/me/apply-model-override \
  -H "Authorization: Bearer <admin-key>"
# Response includes per-agent { key, model } so you can audit the rewrite.
```

**Important — surfaced honestly:** the 7 can't-fail agents from CLAUDE.md
(contract-drafter, contract-lifecycle-manager, decision-memo-drafter,
discount-governor, pricing-architect, reinvestment-advisor, risk-register-keeper)
will be rewritten from `anthropic/claude-opus-4.8` to `nousresearch/hermes-4-405b`.
The doctrine assumed Opus for these because their failure modes are existential
(false contract terms, hallucinated legal reasoning, mis-priced deals, capital
misallocation). Hermes 4 405B is strong reasoning but not yet battle-tested for
these high-stakes domains. **The operator made this call with eyes open** — the
override is reversible (clear it + re-apply to roll back). The script literals
in `scripts/seed/acqu-{...}.ts` retain the doctrine default so the audit trail
is preserved.

### 3. The Agent Manager (the deep-thinker)

Spec is in `/docs/agent-manager-spec.md`. The manager is the meta-agent that
watches the team, decides hire/fire/pause/archive, and runs continuously.

Build it by:

1. Author SKILL.md for `team-composition` and `agent-eval-reading` (the two
   new skills it depends on). Put them in `external/acqu-skills/`.
2. Write `scripts/seed/acqu-agent-manager.ts` from the spec in
   `/docs/agent-manager-spec.md`.
3. Add it to `seed-phase-4.ts` (or create a tight `seed-meta.ts` that seeds
   just the manager).
4. Run the seed. Manager lands at `autonomy: propose`, `enabled: false`.
5. Operator activates it after first dry-run. Cron fires daily at 10:00.

### 4. Multi-agent spawning / dynamic team

The operator described the team as something that "spins up multiple agents
based on one prompt" and "hires when needed, fires when needed." The pieces are
already in the platform:

- **Plain-English → team:** Architect's `mode: "team"` already does this.
  Operator pastes one prompt; Architect emits N agent blueprints.
- **Hire decision:** Manager agent surfaces "we need an X" → operator
  approves → `/seed` writes the row.
- **Spin up:** as soon as the row is `enabled=true, lifecycle_state=active`,
  the runner sees work on the next tick.
- **Fire / archive:** Manager surfaces → operator approves → lifecycle endpoint
  flips the row.

So the user's vision is platform-supported. What's left is YOUR session
shipping the agents (including the Manager) and putting them on the VPS.

### 5. The "agents run like a company" loop

The doctrine + the Manager give you the loop:
- Manager wakes daily at 10:00.
- It reads run summaries + costs + the team roster.
- It surfaces 0–3 proposals to the operator (Slack tap).
- Operator approves → Manager calls the right endpoint.
- New / archived / paused agents land in the registry.
- Runner picks up the change on its next claim cycle (no restart needed —
  the lifecycle check is per-request).

### 6. VPS specifics

The platform was designed for Railway per the doctrine, but VPS works fine:

```bash
# On your VPS
git clone <repo>; cd agent-os
pnpm install
# Build:
pnpm build  # (currently builds control-plane; runner runs via tsx)
# Apply migrations against your Supabase:
supabase db push
# Run the API (port 8787):
DATABASE_URL=... ANTHROPIC_BASE_URL=https://openrouter.ai/api \
  ANTHROPIC_API_KEY=$OPENROUTER_KEY ANTHROPIC_AUTH_TOKEN=$OPENROUTER_KEY \
  AOS_VAULT_KEY=... \
  pm2 start "pnpm --filter @agent-os/api start"
# Run the runner (separate process or container):
DATABASE_URL=... ANTHROPIC_BASE_URL=https://openrouter.ai/api \
  ANTHROPIC_API_KEY=$OPENROUTER_KEY ANTHROPIC_AUTH_TOKEN=$OPENROUTER_KEY \
  AOS_API_URL=http://localhost:8787 AOS_API_KEY=<runner-key> \
  pm2 start "pnpm --filter @agent-os/runner start"
# Inngest (optional but recommended):
inngest-cli dev  # local relay
# Or hosted: set INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY on the api process.
```

### 7. What the platform does NOT do that you might assume it does

- **Live Browserbase + Stagehand wiring.** Phase 7 ships the SSRF boundary + a Node-fetch fallback. When you bind `tool.browser` to a real agent, swap the fetcher in `packages/tool-browser/src/index.ts` to the Stagehand backend (use `@browserbasehq/sdk` directly; Stagehand 3.4's `V3` class surface is moving).
- **Architect cost capping per tenant.** Each blueprint propose has its own budget (default $0.20), but tenant-wide cumulative caps for architect spend aren't enforced. Add this if you give the Manager autonomy to hire on its own.
- **The Manager itself.** The spec is in `/docs/agent-manager-spec.md`. It's not seeded — your job.
- **SKILL.md files for many referenced skills.** `verification-before-completion` and `morning-vitals` exist; everything else (`ftc-claim-review`, `team-composition`, etc.) is referenced by key but not yet authored. The seedAgent helper tolerates missing files (registers by key, version `0.0.0`); author them when each agent's first eval surfaces real patterns.

### 8. Honest list of open questions

1. **Hermes vs. Opus for can't-fail.** Logged above. The override is the user's call; reversible.
2. **Manager promotion path.** When does the Manager move from `propose` to `execute_safe`? Proposed gate: 30 days of operator-approved decisions, zero false hires. Operationalize this with the agent-evaluator (Phase 4 / 8).
3. **Cross-tenant patterns.** When external Cliently tenants exist (Phase 10), each gets its own Manager. Do the Managers share learnings? Cross-tenant data leak is the risk; tenant-agnostic prompt + tenant-scoped RLS-protected reads is the safest path.
4. **Inngest cost.** Hosted Inngest has its own per-step pricing; if cron volumes get big, profile early.

## Quick reference — the 4 commits that anchor the autonomous-team primitives

- Migration 0009 + Drizzle mirrors: `packages/db/src/schema.ts`, `supabase/migrations/0009_lifecycle_and_model_override.sql`.
- seedAgent tenant-override application: `packages/core/src/seed/seedAgent.ts`.
- API endpoints: `apps/api/src/index.ts` (search for "Agent lifecycle (Migration 0009)").
- Runner `/next` lifecycle check: `apps/api/src/index.ts` line 119-ish.

## What to push back on if the operator asks for it

- **"Make the Manager fully autonomous from day 1."** Don't. Manager at `execute_safe` from day 1 means the first hallucinated "we need a chief-of-staff" agent gets seeded without review. Cost + risk both unbounded. Stay at `propose` until track record exists.
- **"Skip the doctrine, just let the Architect generate everything."** Architect is excellent for novel hires; it is NOT a replacement for the doctrine's hand-authored T-critical agents. The 22 Phase-4 agents + the 7 T-critical locks are deliberate. The override can change models; it shouldn't be the path to skipping the seed scripts entirely.
- **"Spin up 100 agents in parallel."** The platform supports it (one row per agent, scheduler-orchestrated runs), but cost is linear in active agent count × cron frequency × per-run cost. Add a tenant-wide active-agent cap before opening the floodgates.

Good luck. Branch is at `claude/exciting-davinci-yvptm`. State is committed.
