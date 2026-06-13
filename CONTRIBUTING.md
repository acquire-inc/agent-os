# Contributing to AgentOS

The project has a tight discipline. This page is how to stay inside it.

## The standing gate

```bash
pnpm launch:check
```

Must return `Launch Readiness: READY ✓` before any PR is merged. Runs
in CI on every push. If you broke the oracle, fix it BEFORE you fix
anything else.

## The two doctrines

Read once, internalize, never violate:

1. **`CLAUDE.md`** — non-negotiables: agents are DATA, model is CONFIG,
   multi-tenant from day one, safety via SDK hooks, T-critical Opus pin,
   CRA refusal, etc.
2. **`docs/agent-coordination-guidelines.md`** — the operator's mental
   model for keeping fleets clean. Four mechanisms, when to use which.

## Where to put new code

| If you're adding… | Put it in |
|---|---|
| Pure platform logic | `packages/core/src/<area>.ts` + unit test |
| Drizzle schema change | `supabase/migrations/<N>_<slug>.sql` + Drizzle in `packages/db/src/schema.ts` + `docs/migration-rollback-notes.md` block |
| API endpoint | `apps/api/src/index.ts` (admin) or runner endpoints by mount |
| Operator UI | `apps/control-plane/src/routes/_app/<route>.tsx` |
| New relay event name | `packages/core/src/relay/events.ts` (append-only, lowercase.dotted) |
| Agent doctrine, prompt, skill, MCP, tool | seed scripts in `scripts/seed/` — NOT application code |

## The PR checklist (run before you push)

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @agent-os/core test:dispatch-contract      # the seam
pnpm --filter @agent-os/tool-rls-test test                 # isolation static
pnpm launch:check                                          # the oracle
```

All four green. Then push.

CI also runs the full live-DB verify (`pnpm verify`) — if that fails on
your PR but the offline gates pass, your migration is the suspect.

## Karpathy lens — write code like he would review it

1. **Think before coding.** Surface assumptions; ask if uncertain;
   present alternatives instead of picking silently.
2. **Simplicity first.** Minimum code that solves the problem. No
   speculative features, no abstractions for single-use code, no
   "configurability" that wasn't asked for.
3. **Surgical changes.** Touch only what you must. Don't refactor adjacent
   code. Match existing style.
4. **Goal-driven.** Define success up-front. Verify by running it.

## Adding a new V2-style pure module

The shape that worked for memory.ts, objective.ts, improve.ts, critic.ts,
lease.ts, a2a.ts, manager.ts, onboarding.ts:

1. **Pure decision** function + types (no DB, no clock — pass time in).
2. **Sink-based runner** that injects DB I/O via an interface.
3. **Unit tests** with a spy sink (mirrors the pattern in `lease.test.ts`).
4. **Migration** with rollback notes.
5. **Relay event** if the action is operator-visible.
6. **Agent-readable doc** in `docs/` (this is for AGENTS first — if an
   agent can't extend the module from the doc alone, the doc is
   incomplete).
7. **Wire to lifecycle.ts** via `lifecycle-hooks.ts` types (operator
   plugs in DB-bound sinks on db-up).
8. **Append to launch-check** (test script + doctrine doc).

## Safety floors (cannot be bypassed)

- T-critical agents stay on Opus, fail-closed if drift.
- CRA blocklist refuses eligibility-decisioning categories.
- Prompt-injection guard runs on every external-trust tool dispatch.
- Budget reserve/commit/release wraps every dispatch.
- RLS scopes every read; cross-tenant returns zero rows.
- Cant-fail floor at the seed layer; runtime guard at SessionStart.

When in doubt, read `CLAUDE.md`. Read it again.

## Anything you can't figure out

Read `docs/internal-launch-runbook.md` first — most operator questions
are answered there. Then `LAUNCH.md` for the repo tour. Then ask.

Welcome.
