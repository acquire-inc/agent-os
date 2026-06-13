# AgentOS — Launch

**You are here** because the platform was just pushed or you just cloned the
repo. This page is the 60-second orientation for humans and the first file
agents read.

## What this is

Multi-tenant Agent OS — the control plane that runs Acquire Inc (Acqu) on
agents and is productized as Cliently. Agents are DATA (registry rows +
versioned prompts + skill files), not code. Model is CONFIG, not code.
Adding an agent is a configuration operation, not a build.

## Is it ready?

Run the oracle:

```bash
pnpm install
pnpm launch:check
```

If you see `Launch Readiness: READY ✓` with all checks green, the offline
platform is internal-launch-ready. Operator gates (live DB push, isolation
suite) are listed separately in the script output and in the runbook.

The launch-check job also runs in CI on every push (`.github/workflows/ci.yml`),
so any drift surfaces immediately.

## How do I launch it for our internal team?

Read **`docs/internal-launch-runbook.md`** top to bottom. It's the 10-item
checklist: pre-flight → DB up → live isolation → integration → seed → runners
→ smoke test → control plane → cant-fail on-call → DONE.

## How do I keep agents from stepping on each other?

Read **`docs/agent-coordination-guidelines.md`**. Four mechanisms
(lease, critic peer-approval, reflexion retry, scorecard ladder), when to
use which, and the "don't overlap / don't create slop" checklist.

The platform invariants for safety, isolation, budget, model selection, CRA
refusal, injection scrub, etc. are LOAD-BEARING — listed in CLAUDE.md and
implemented as code-enforced gates. You can't opt out.

## Where the docs live

| File | Purpose |
|---|---|
| `CLAUDE.md` | Every-session orientation — the canonical doctrine entry point |
| `docs/main-acqu-agent-doctrine.md` | How agents run — model tiers, tooling, skills, connectors |
| `docs/acqu-os-build-spec.md` | Platform build spec — data model, runner, safety layer |
| `docs/internal-launch-runbook.md` | **Operator's step-by-step from READY to LIVE** |
| `docs/agent-coordination-guidelines.md` | Fleet design + the "don't overlap" mental model |
| `docs/dispatch-contract.md` | Run lifecycle + bundle shape + state machine contracts |
| `docs/lease-arbitration.md` | Lease decision matrix, doctrine rules, target naming |
| `docs/tenant-config-validation.md` | Tier-overrides + scorecard-thresholds validators |
| `.planning/PLATFORM.md` | Capability ledger — 38 capabilities, status per item |
| `.planning/IDEAS.md` | Platform idea queue |
| `.planning/ROADMAP.md` | Phase log (Phase 1 through Phase 67 + V2 P1–P6) |

## Where the code is

| Path | What |
|---|---|
| `packages/core` | Pure platform modules (router, eval, memory, objective, improve, critic, lease, dispatch-contract, tenant-config, architect) |
| `packages/db` | Drizzle schema + migrations + seed |
| `packages/inngest` | Durable scheduler |
| `packages/shared` | Cross-package types |
| `packages/tool-rls-test` | Tenant isolation attack vectors (32 registered) |
| `apps/api` | Hono API (admin + runner) |
| `apps/runner` | Claude Agent SDK runner |
| `apps/scheduler` | Inngest functions |
| `apps/control-plane` | TanStack Router SPA (the operator UI) |
| `scripts/launch-readiness` | The `pnpm launch:check` oracle |
| `scripts/verify` | Live integration verify (operator-runs) |
| `scripts/seed` | Per-phase doctrine seed scripts |
| `supabase/migrations` | 29 numbered SQL migrations |

## Common commands

```bash
pnpm install                   # install workspace deps
pnpm launch:check              # offline launch oracle — should print READY ✓
pnpm -r typecheck              # 15-project workspace typecheck
pnpm --filter control-plane dev  # local UI on http://localhost:5173

# Operator-runs (need DATABASE_URL):
pnpm verify                    # full live verify: migrate + seed + suites + build
pnpm verify:isolation-live     # live isolation gate (HARD gate #2 for external)
pnpm db:migrate                # apply migrations
pnpm seed:acqu-vitals          # seed tenant #1 (Acqu)
pnpm seed:phase-1              # then doctrine batch seeds in order
```

## Stuck?

- **The launch-check fails** → read its output; every red check has a reason
  and a fix path. Migration ordering / relay registry / cant-fail count drift
  are the usual culprits.
- **An agent stepped on another agent** → read `docs/agent-coordination-guidelines.md`
  and add a lease target to the dispatch. The mechanism exists; it's opt-in
  by `(kind, key)`.
- **A `cantfail.*` event fired** → that's a safety invariant violation.
  Read the event, fix the cause, never the invariant.
- **You want to change a doctrine rule** → it's encoded for a reason. See
  CLAUDE.md "non-negotiables." Open a discussion before editing.

## Branches + branch policy

- `main` — production.
- `claude/exciting-davinci-yvptm` — current development branch (V2 + I-001/2/3).

Push directly to the development branch; `main` is merged on internal-launch
sign-off.

---

Welcome. If you can run `pnpm launch:check` and see `READY ✓`, you're ready.
