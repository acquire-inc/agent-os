# RUNBOOK — Acqu running internally (first live end-to-end)

> **Goal:** prove the fleet actually *runs* against a real Postgres — the one thing that has never
> happened (this dev container has no `DATABASE_URL`). Everything below is verified against the code
> (migrate path, seed entrypoints, env vars, start scripts). **This is internal/single-tenant
> (Acqu = tenant 1).** The fleet-wide RLS audit is deliberately deferred to *before* GenX / a second
> tenant — it is NOT a blocker for internal go-live, but it IS the hard gate before any external one.

## 0. What you provide (the two things I can't do from the sandbox)
1. **A Postgres with pgvector** — a Supabase project is easiest (it ships pgvector + the `auth.uid()`
   the RLS policies use). Grab its connection string.
2. **An `ANTHROPIC_API_KEY`** — Cliently is customer-facing so auth is by API key (per CLAUDE.md),
   and the fleet routes through it (OpenRouter base URL when you wire the gateway; direct works for a
   first run).

## 1. Environment
```bash
export DATABASE_URL="postgres://...supabase..."          # required everywhere
export AOS_VAULT_KEY="$(openssl rand -base64 32)"         # 32 bytes b64 — store it; rotating it orphans secrets
export ANTHROPIC_API_KEY="sk-ant-..."                     # live runs; omit → runner stays in dryRun
```

## 2. Apply migrations (0001 → 0011)
```bash
pnpm db:migrate        # runs supabase/migrations in order, including 0011_run_summaries
```
Expect: `Done. Applied 11 migration(s).`

## 3. Seed the fleet as data (idempotent — safe to re-run)
> **⚠ ORDER MATTERS — `pnpm db:seed` is destructive.** It does `delete from tenants where id in
> (acqu, cliently)`, which **cascades to every tenant-scoped row** (agents, tools, evals, AND your
> bootstrap API keys). Run it **once, first**, before the agent seeders and before bootstrapping
> keys. **Do NOT re-run `db:seed` after go-live** — it wipes the live fleet + keys. The agent
> seeders below (`seed-everything` etc.) are the idempotent ones safe to re-run.
```bash
pnpm --filter @agent-os/db seed                     # base fixtures (tenant Acqu, MCP catalog, demo user) — DESTRUCTIVE, run once first
pnpm tsx scripts/seed/acqu-vitals.ts                # the proven single-agent pattern (smoke test the seed path)
pnpm tsx scripts/seed/seed-everything.ts            # all 93 agents + agent-architect, normalized to Hermes 405B
pnpm tsx scripts/seed/seed-tools.ts                 # derive + bind the tool catalog from prompts (incl. workforce tools)
pnpm tsx scripts/seed/seed-evals.ts                 # eval cases + scorecards (also asserts the can't-fail ceiling)
pnpm tsx scripts/seed/seed-chains.ts                # handoff-chain triggers (declared; routing needs Inngest later)
```
Verification baked into the seeders (they exit non-zero on violation): every agent on
`nousresearch/hermes-4-405b`, backend `claude-agent-sdk`, **every can't-fail agent at
`autonomy=propose`**.

## 4. Start the control plane
```bash
# terminal 1 — API (Hono)
PORT=8787 PUBLIC_URL=http://localhost:8787 pnpm --filter @agent-os/api start
# terminal 2 — scheduler (materializes due cron runs into the runs queue)
pnpm --filter @agent-os/scheduler start
```

## 5. Bootstrap the first keys (no chicken-and-egg)
A fresh DB has zero API keys, and `POST /api/admin/keys` itself needs an admin key — so mint the
first ones directly against the DB (the one privileged op that can't go through the API):
```bash
# mints the bootstrap ADMIN key AND a RUNNER key; prints each raw secret ONCE
DATABASE_URL=... pnpm tsx scripts/seed/bootstrap-admin-key.ts --runner
```
Copy both secrets. Re-running without `--force` won't reprint (hashes are one-way). All further
keys come from `POST /api/admin/keys` (Bearer the admin key).

## 6. Start a runner (use agent KEYS or "all" — no UUID lookup)
```bash
# terminal 3 — runner. RUNNER_AGENT_IDS accepts agent keys, "all", or UUIDs; resolved at startup.
RUNNER_API_KEY="<runner key from step 5>" \
RUNNER_AGENT_IDS="vitals" \           # or "vitals,ad-ops,connector-health-monitor" or "all"
API_URL=http://localhost:8787 \
pnpm --filter @agent-os/runner start
```
- **No `ANTHROPIC_API_KEY`** → runner runs in **dryRun** (simulates the full loop incl. the approval
  gate) — prove the plumbing with zero spend first.
- **With the key** → live runs through the Claude Agent SDK behind the safety hooks.

## 7. What "it works" looks like (the acceptance test)
After a vitals run reaches a terminal state, verify the new memory contract landed:
```sql
select agent_id, status, what_i_did, what_next, cost_usd
from run_summaries order by created_at desc limit 5;     -- 0011 — should have a structured row
select status, cost_usd, tokens_in, tokens_out from runs order by created_at desc limit 5;
select kind, tool_name, rationale from autonomy_events order by ts desc limit 10;   -- gate decisions
```
A second vitals run should now show **"Where you left off"** context in its bundle (the
`recentSummaries` we just wired) — that's continuity working.

## 8. First-week internal loop (low-risk order)
1. Run **vitals + the cheap monitors** live (connector-health, cash-position) — they're read-mostly,
   `propose`/`execute_safe`, cheap. Watch `run_summaries` + cost accumulate.
2. Turn on **agent-architect** on-demand — prompt it ("what's our coverage gap this week?") and watch
   it propose workforce changes into the Approvals inbox (nothing executes without your tap).
3. Promote a proven monitor from `propose` → `execute_safe` once its scorecard earns it (the
   evaluator recommends; can't-fail agents are ceiling-blocked automatically).

## Known gaps you're accepting for internal go-live (tracked, not forgotten)
- **RLS is partial** (~12 of 37 tables have a tenant policy; `runs`, `documents`, the vector store,
  `usage_events` do NOT). Safe while Acqu is the only tenant; **must be closed before GenX / tenant 2.**
- **Chains are declared, not routed** — `seed-chains` wires triggers but there's no Inngest yet, so
  multi-agent handoffs won't fire automatically. Single agents + cron/on-demand work fully.
- **Metering writes usage/credits but no external aggregator** (OpenMeter) is connected yet.
