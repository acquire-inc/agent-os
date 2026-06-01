# SETUP — run Acqu live from a fresh machine

The Claude Code sandbox blocks outbound DB ports, so the seed/migrate must run from a machine with
network access to Supabase (your laptop or a VPS). This is the whole path, fresh machine → live.

## 1. Prerequisites (install once)
```bash
# Node 22+ (nvm is easiest)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm use 22

# pnpm 10 (via corepack, ships with Node)
corepack enable && corepack prepare pnpm@10.33.0 --activate

node -v   # v22.x
pnpm -v   # 10.x
```

## 2. Get the code
```bash
git clone <your-repo-url> agent-os && cd agent-os
git checkout claude/seed-phase-1-agents     # the branch with all the go-live work
```

## 3. Connection string — IPv6 gotcha (read this)
Supabase's **direct** host `db.<ref>.supabase.co` is **IPv6-only**. If your machine has IPv6 it
works; if not (many home/office networks, most CI), use the **Session pooler** string instead — it's
IPv4. Get it from: Supabase dashboard → **Connect** → **Session pooler**. It looks like:
```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```
Either one works for migrations + seeding. Use the pooler if `db:migrate` hangs/times out.

## 4. Environment
```bash
export DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"   # or the pooler string
export AOS_VAULT_KEY="$(openssl rand -base64 32)"   # 32-byte vault key — STORE IT (rotating it orphans stored secrets)
# optional, for LIVE agent runs (omit → dryRun, zero spend):
# export ANTHROPIC_API_KEY="sk-ant-..."
```

## 5. Go live (one command)
```bash
bash scripts/golive-acqu.sh
```
This runs, in order: preflight → `pnpm install` → migrate (0001→0011) → base seed → fleet seed
(93 agents + agent-architect, tools, evals, chains) → **bootstrap the first admin + runner keys
(printed once — copy them)** → acceptance verify. ~3–5 min.

> **The base seed resets the acqu/cliently tenants** (cascading to the fleet + keys), so run the full
> script once on a fresh DB. `migrate` itself is ledgered (`schema_migrations`) and safe to re-run —
> it applies only pending files. To re-run only the idempotent fleet seeders later:
> `bash scripts/golive-acqu.sh --fleet-only`.

## 6. Start the control plane (3 terminals, same DATABASE_URL + AOS_VAULT_KEY exported)
```bash
# API
PORT=8787 PUBLIC_URL=http://localhost:8787 pnpm --filter @agent-os/api start
# Scheduler (materializes due cron runs)
pnpm --filter @agent-os/scheduler start
# Runner — start with just vitals; dryRun unless ANTHROPIC_API_KEY is set
RUNNER_API_KEY="<runner key from step 5>" RUNNER_AGENT_IDS="vitals" \
  API_URL=http://localhost:8787 pnpm --filter @agent-os/runner start
```
`RUNNER_AGENT_IDS` accepts agent **keys** (`"vitals,ad-ops"`), `"all"`, or UUIDs.

## 7. Confirm it ran
```sql
-- in the Supabase SQL editor
select agent_id, status, what_i_did, what_next, cost_usd
from run_summaries order by created_at desc limit 5;     -- a structured row per terminal run
select status, cost_usd, tokens_in, tokens_out from runs order by created_at desc limit 5;
```
A second vitals run should show "Where you left off" context (continuity working).

## If something breaks
Paste me the failing command's output. The likely first-contact issues + fixes:
- **`db:migrate` hangs/times out** → IPv6; switch `DATABASE_URL` to the Session pooler string (§3).
- **`relation already exists` on migrate** → a DB migrated by the *old* (pre-ledger) runner. Adopt
  the ledger once: `pnpm --filter @agent-os/db migrate -- --baseline` (stamps current files as
  applied without running them), then re-run the script. Fresh DBs never hit this.
- **RLS / `auth.uid()` errors** → the policies assume Supabase's `auth` schema; it's present on
  Supabase by default. If you self-host Postgres, tell me and I'll provide a shim.
- **A seeder throws** → paste it; the seeders fail loud by design and the message names the cause.
