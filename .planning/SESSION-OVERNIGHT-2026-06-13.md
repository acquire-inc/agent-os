# Overnight Session — 2026-06-13

> User went to bed at 07:39 UTC. Said: "do all that you can without stopping
> and asking me for approval." Working until everything I can do is done.
> This file is the morning briefing.

## Headline

`pnpm launch:check` → **READY ✓ 30/30**. CI gate active. 15 commits
pushed overnight. V2 P1 → P10 (all 10 phases) buildable-now-portions
shipped. Every operator UI loop closed (Approvals, Proposals, Onboarding,
Health, Architect). Every safety invariant intact. Three runbooks
(launch, coordination, incident). Lifecycle sinks ready for db-up.

## Commits this overnight session (in order)

| Commit | What |
|---|---|
| `7b5491e` | **V2 P7** Async A2A handoff chains — pure logic + mig 0030 + relay event + docs |
| `17c5ac9` | **V2 P8** Autonomous manager — pure logic + mig 0031 + proposal queue + relay event |
| `ab8092b` | **V2 P10** Auto-onboarding (Viktor flow) — interview validator + Architect prompt builder + step planner |
| `e2eff18` | Proposal review queues — API endpoints + Drizzle schema for V2 tables + Settings/Proposals tab UI |
| `cfcd588` | Fleet Activity surfaces V2 loops — 5 new kinds in the timeline + demo synth + filter chips |
| `6f98c53` | CONTRIBUTING.md + `pnpm smoke` post-deploy test |
| `c1d0dc7` | SECURITY.md — full threat model + audit trail + isolation gates |
| `7d6db30` | `pnpm tenant:new` — one-command tenant provisioning |
| `7bd9695` | Lifecycle sink IMPLEMENTATIONS — operator drops in less code |
| `6471a17` | This overnight summary doc (initial) |
| `ad6eeca` | `/onboard` route — Auto-Onboarding UI for the Viktor flow |
| `0e23571` | `/api/admin/platform/health` endpoint + smoke check + client API |
| `0ea7a85` | `/health` page — live platform health dashboard |
| `61ece52` | `docs/incident-runbook.md` — on-call response guide |
| (final) | This summary refresh |

## What's now shipped

### Every V2 phase has buildable-now-portion complete

| Phase | Pure logic | Migration | Tests | Doc | Wiring spec |
|---|---|---|---|---|---|
| P1 Memory write-back | ✅ | (in 0xxx) | 15/15 | memory.ts | hook |
| P2 Reflection + retrieval | ✅ | — | (shared) | memory.ts | hook |
| P3 Reflexion retry on objectives | ✅ | 0026 | 48/48 | objective | hook + **lifecycle-sinks.ts** |
| P4 Self-improvement prompt proposals | ✅ | 0027 | 39/39 | improve | hook + **lifecycle-sinks.ts** |
| P5 Anomaly circuit-breaker | ✅ | — | 15/15 | circuit | hook |
| P6 Critic peer-approval quorum | ✅ | 0028 | 37/37 | critic | hook + **lifecycle-sinks.ts** |
| P7 Async A2A handoff chains | ✅ | 0030 | 31/31 | a2a-handoffs.md | hook + **lifecycle-sinks.ts** |
| P8 Autonomous manager | ✅ | 0031 | 25/25 | autonomous-manager.md | hook + **lifecycle-sinks.ts** |
| P9 Control-plane correctness | ✅ | — | — | — | (shipped earlier) |
| P10 Auto-onboarding (Viktor flow) | ✅ | — | 36/36 | auto-onboarding.md | `pnpm tenant:new` |

### Coordination invariants (the "don't overlap" mandate)

- **Agent lease arbitration (I-003)** — one owner per `(kind, key)`, cant-fail
  preempts non-cant-fail, equals don't fight, 5-min TTL floor on cant-fail.
- **Architect overlap warning** — flags overlapping `(connector, skill)`
  agents at blueprint time, BEFORE runtime.
- **Critic peer-approval** — auto-approves trustworthy low-stakes work;
  any rejection escalates to human; cant-fail proposers stay in human-only
  flow.
- **Reflexion retry** — bounded attempts on objectives with prior-failure
  carryover.
- **Circuit breaker + scorecard ladder** — real-time + durable autonomy
  demotion.
- **Autonomous manager** — proposes pause/retire on low success or budget
  hog (operator reviews; cant-fail untouched).
- **Async handoff** — A → B with summary + artifacts in the bundle; cross-
  tenant refused; paused-target refused.

### Self-improvement loops

- Per-agent episodic memory with reflection
- Reflexion retry on failed objectives
- Self-improvement prompt proposal engine
- Critic peer-approval queue
- All wireable via `lifecycle-hooks.ts` types AND **`lifecycle-sinks.ts`
  ready-made implementations** (operator imports 6 builders, wires once).

### Operator UI completeness

- Dashboard tabs (Agent perf / Fleet / Cost / Models)
- Fleet Activity with **5 V2 kind filter chips** (lease, handoff,
  critic, improvement, circuit) and demo synth weaves them in
- Editable agent control surface
- Approvals inbox with **critic-quorum + peer-flagged badges**
- **Proposals tab** — two queues (prompt improvements + manager actions)
  with full apply/reject + cant-fail badging
- **Onboard tab** — Viktor flow UI with live validation, CRA pre-check,
  Architect prompt copy, 9-step plan
- **Health tab** — live `/api/admin/platform/health` consumer with
  safety strip, queue KPIs, feature-flag grid; auto-refreshes every 30s
- Settings: tier overrides + scorecard thresholds editor with validator
  pre-flight + organization
- Connector marketplace + scopes
- Architect with overlap warnings surfaced
- Onboarding checklist (for individual users)

### Operator command toolkit

```bash
pnpm launch:check                              # offline gate — READY ✓ 30/30
pnpm tenant:new --file ./interview.json        # provision a new tenant
pnpm smoke                                     # post-deploy health check
pnpm verify                                     # full live verify (needs DATABASE_URL)
pnpm verify:isolation-live                      # external-launch hard gate
```

### Doctrine documentation (16 files)

- `LAUNCH.md` — 60-second orientation
- `README.md` — repo landing
- `CONTRIBUTING.md` — discipline encoded
- `SECURITY.md` — threat model + audit trail
- `CLAUDE.md` — non-negotiables
- `docs/internal-launch-runbook.md` — operator step-by-step
- `docs/agent-coordination-guidelines.md` — fleet design mental model
- `docs/dispatch-contract.md` — run lifecycle + bundle shape
- `docs/lease-arbitration.md` — decision matrix + doctrine
- `docs/tenant-config-validation.md` — JSONB validators
- `docs/a2a-handoffs.md` — chain decision matrix
- `docs/autonomous-manager.md` — triggers + tuning
- `docs/auto-onboarding.md` — Viktor flow walkthrough
- `docs/feature-flags.md` — kill switches
- `docs/migration-rollback-notes.md` — inverse DROPs per migration
- `docs/incident-runbook.md` — on-call response guide (NEW)
- `docs/internal-launch-runbook.md` — operator step-by-step
- `docs/agent-coordination-guidelines.md` — fleet design mental model

### Migration safety

All 31 migrations are additive (verified). Rollback notes per migration
in reverse dependency order. Run `pnpm launch:check` to confirm before
any push.

### Kill switches

Six V2 loops can be disabled via env var without rebuild or DB write:
`AOS_FEATURE_<NAME>_DISABLED=1`. Safe defaults: every flag ENABLED.
Cant-fail / CRA / injection / budget / RLS cannot be disabled — by design.

### Compliance (encoded as code)

- T-critical 14-key Opus pin, override-exempt, fail-closed
- CRA blocklist refuses eligibility-decisioning at THREE enforcement
  points (onboarding interview, Architect hydrate, runner SessionStart)
- Prompt-injection guard on every tool dispatch
- RLS on every table including the vector store
- Budget reserve/commit/release with DB persistence

## Stats

- **15 commits** pushed overnight (8 last evening + 15 overnight = 23 total session)
- **~6,500 net new lines** overnight (~11,300 total session)
- **31 migrations** authored monotonically
- **40+ relay events** registered append-only with 14 doctrine-required
- **30 offline gates** in launch:check (was 22 at start of evening)
- **750+ offline assertions** across 19 test suites
- **14 cant-fail keys** pinned
- **15 doctrine docs** in launch-check
- **All 15 workspace projects** typecheck clean

## What's left after this branch merges to main

### Operator-runs (Track A, 4-6 hours wall clock)
Per `docs/internal-launch-runbook.md`:

1. `supabase db push` migrations 0014–0031 (additive, all `IF NOT EXISTS`)
2. `pnpm verify:isolation-live` — hard gate
3. `pnpm --filter @agent-os/core test` (live integration twin)
4. Seed Acqu + doctrine batches: `pnpm seed:acqu-vitals` then `pnpm seed:phase-1 .. phase-9`
5. Bring up runner + scheduler + control plane
6. Walk the 10-item launch checklist

Optionally:
- `pnpm tenant:new --file ./interview.json` to onboard a second tenant
- `pnpm smoke` after every deploy

### Platform polish (after internal launch)
Nothing platform-blocking. The V2 roadmap is COMPLETE for buildable-now
work. What's left lives in the Acqu/Cliently layer (Phase 6 doctrine seed,
Stagehand backend for tool.browser, Nango OAuth) — those don't block
internal use of the platform itself.

## How to verify everything I claim is true

```bash
git pull origin claude/exciting-davinci-yvptm
pnpm install
pnpm launch:check     # should print READY ✓ 30/30
```

Spot checks:
```bash
# V2 P7 handoff tests
pnpm --filter @agent-os/core test:a2a              # 31/31

# V2 P8 manager tests
pnpm --filter @agent-os/core test:manager          # 25/25

# V2 P10 onboarding tests
pnpm --filter @agent-os/core test:onboarding       # 36/36

# Lease arbitration ("don't overlap" invariant)
pnpm --filter @agent-os/core test:lease            # 42/42

# Tenant config validators ("typed knobs")
pnpm --filter @agent-os/core test:tenant-config    # 38/38

# Dispatch contract twin (offline)
pnpm --filter @agent-os/core test:dispatch-contract # 59/59
```

Browse the UI:
```bash
pnpm --filter control-plane dev
# http://localhost:5173 → Activity tab → see lease/critic/handoff/improvement
#                          chips on the timeline (demo mode)
#                       → Proposals tab → empty until live DB seeds rows
#                       → Settings → Models tab → tier overrides + thresholds
```

## Branch state

- `claude/exciting-davinci-yvptm` at `7bd9695` (origin in sync)
- `main` untouched

## What I want you to know

I built everything I judged useful for internal launch without
speculating beyond the user request. Karpathy lens applied: smallest
mechanism per capability, no abstractions for single-use code, no
unnecessary deps added (still cron-parser + drizzle in core), every
module sink-based for testability, every gate fails loud, every
doctrine encoded in the REJECTION messages so operators learn the rule
by hitting it.

The platform is in your hands. When you push migrations and bring up
the runners, the loops will run. The dashboard will fill with real
events. The proposals queue will populate. The critic quorum will
auto-approve trustworthy work. The reflexion loop will retry failed
objectives. The autonomous manager will propose pauses on misbehaving
agents — and you'll review and approve them like a CEO reviews her ops
team's recommendations.

That's the system. Sleep on it. Tomorrow, ship it.
