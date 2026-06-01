#!/usr/bin/env bash
# scripts/golive-acqu.sh — one-shot: bring Acqu live on a fresh Supabase, from a fresh machine.
#
# WHY THIS EXISTS: the Claude Code remote sandbox blocks outbound DB ports (egress policy), so
# migrations/seed can't run from there. You run this locally (you have network to Supabase).
#
# WHAT IT DOES (in order, each step gated on the previous succeeding):
#   1. preflight  — checks node>=22, pnpm, DATABASE_URL, AOS_VAULT_KEY
#   2. install    — pnpm install (workspace packages export TS source; no build needed)
#   3. migrate    — applies supabase/migrations 0001→0011  (FRESH DB ONLY — see warning)
#   4. seed base  — pnpm db:seed  (DESTRUCTIVE: resets acqu/cliently tenants — run ONCE, first)
#   5. seed fleet — 93 agents + agent-architect, tools, evals, chains  (idempotent)
#   6. bootstrap  — mints the first admin + runner API keys (printed once)
#   7. verify     — SQL acceptance checks (fleet present, can't-fail at propose, tables exist)
#
# USAGE:
#   export DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"
#   export AOS_VAULT_KEY="$(openssl rand -base64 32)"     # STORE THIS — rotating it orphans secrets
#   bash scripts/golive-acqu.sh
#
# Re-run safety: steps 3 (migrate) and 4 (db:seed) are NOT safe to re-run on a live DB
#   - migrate has no ledger and most migrations aren't IF-NOT-EXISTS → re-run errors on existing objects
#   - db:seed deletes the acqu/cliently tenants (cascades to the whole fleet + keys)
#   To re-run only the idempotent fleet seeders, use:  bash scripts/golive-acqu.sh --fleet-only
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

FLEET_ONLY=0
[ "${1:-}" = "--fleet-only" ] && FLEET_ONLY=1

say() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# ── 1. preflight ────────────────────────────────────────────────────────────
say "Preflight"
command -v node >/dev/null || die "node not found. Install Node 22+ (https://nodejs.org or nvm)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "Node $NODE_MAJOR found; need >=22."
command -v pnpm >/dev/null || die "pnpm not found. Install: npm i -g pnpm@10  (or: corepack enable)"
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL not set. Export your Supabase connection string."
[ -n "${AOS_VAULT_KEY:-}" ] || die "AOS_VAULT_KEY not set. Run: export AOS_VAULT_KEY=\"\$(openssl rand -base64 32)\" (store it!)"
echo "  node $(node -v), pnpm $(pnpm -v), DATABASE_URL set, AOS_VAULT_KEY set ✓"

# ── 2. install ────────────────────────────────────────────────────────────────
say "Installing dependencies (pnpm install)"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

if [ "$FLEET_ONLY" -eq 0 ]; then
  # ── 3. migrate ──────────────────────────────────────────────────────────────
  say "Applying migrations 0001→0011 (FRESH DB ONLY — errors here usually mean the DB is already migrated)"
  pnpm db:migrate

  # ── 4. seed base (DESTRUCTIVE) ────────────────────────────────────────────────
  say "Seeding base fixtures (tenant Acqu, MCP catalog, demo user) — DESTRUCTIVE, run once"
  pnpm --filter @agent-os/db seed
fi

# ── 5. seed the fleet (idempotent) ───────────────────────────────────────────
say "Seeding the agent fleet (93 agents + agent-architect, tools, evals, chains)"
pnpm --filter @agent-os/seed exec tsx acqu-vitals.ts
pnpm --filter @agent-os/seed exec tsx seed-phase-1.ts
pnpm --filter @agent-os/seed exec tsx seed-remaining-phases.ts
pnpm --filter @agent-os/seed exec tsx seed-everything.ts
pnpm --filter @agent-os/seed exec tsx seed-tools.ts
pnpm --filter @agent-os/seed exec tsx seed-evals.ts
pnpm --filter @agent-os/seed exec tsx seed-chains.ts

# ── 6. bootstrap the first API keys ──────────────────────────────────────────
say "Bootstrapping the first admin + runner API keys (printed ONCE — copy them now)"
pnpm --filter @agent-os/seed exec tsx bootstrap-admin-key.ts --runner

# ── 7. verify (acceptance checks) ────────────────────────────────────────────
say "Verifying go-live state"
pnpm --filter @agent-os/seed exec tsx verify-golive.ts

cat <<'NEXT'

════════════════════════════════════════════════════════════════════
  ✓ ACQU IS SEEDED AND LIVE-READY
════════════════════════════════════════════════════════════════════
  Next — start the control plane (3 terminals, same DATABASE_URL + AOS_VAULT_KEY):

    PORT=8787 PUBLIC_URL=http://localhost:8787 pnpm --filter @agent-os/api start
    pnpm --filter @agent-os/scheduler start
    RUNNER_API_KEY="<runner key above>" RUNNER_AGENT_IDS="vitals" \
      API_URL=http://localhost:8787 pnpm --filter @agent-os/runner start

  Omit ANTHROPIC_API_KEY on the runner → dryRun (full loop, zero spend) to prove plumbing.
  Set it → live runs through the Claude Agent SDK behind the safety hooks.
  Then: select * from run_summaries order by created_at desc limit 5;
════════════════════════════════════════════════════════════════════
NEXT
