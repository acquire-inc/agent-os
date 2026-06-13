# PLATFORM.md — AgentOS Capability Ledger

> OS-RALPH platform ledger. Read every run. Status legend:
> **EXISTS** = code shipped + typecheck green · **HARDENED** = EXISTS + offline tests + docs + gates
> **SPEC'D** = written spec, not built · **PROPOSED** = idea only (see IDEAS.md)
>
> Bootstrapped 2026-06-12 from real codebase state (67 phases + V2 P1-P6 shipped).
> One-line doctrine: agents are DATA; model is CONFIG; every improvement serves
> TENANTS-IN-GENERAL. Acqu-specific logic in platform code is a defect.

## Standing gates (checked EVERY run)

| Gate | How to run | Status 2026-06-12 |
|---|---|---|
| **Internal-launch readiness check** | `pnpm launch:check` | ✅ READY · 24/24 offline checks pass |
| RLS isolation (static) | `pnpm --filter @agent-os/tool-rls-test test` | ✅ 10/10 · 32 attack vectors frozen/append-only |
| RLS isolation (live) | `scripts/verify/isolation-live.ts` (needs DATABASE_URL) | ⏸ operator-gated — **hard gate #2: no external tenant until live PASS** |
| Contract battery (offline) | `cd packages/core && pnpm run test:{architect,relay,router,budget,scorecard-flow,cantfail,cra,injection}` | ✅ 286/286 |
| Dispatch/results contract (offline twin — I-002) | `pnpm --filter @agent-os/core test:dispatch-contract` · docs/dispatch-contract.md | ✅ 59/59 |
| Dispatch/results integration (live) | `pnpm --filter @agent-os/core test` (needs DATABASE_URL) | ⏸ operator-gated |
| Migration state | `ls supabase/migrations/` → 28 files (0001–0028) | ⏸ 0014–0028 push deferred to operator |
| Workspace typecheck | `pnpm -r typecheck` (15 projects) | ✅ |

## Capability map

### Runtime & dispatch
| Capability | Status | Evidence |
|---|---|---|
| Runner on Claude Agent SDK behind gateway (`apps/runner`) | HARDENED | execute-flow integration 16 asserts; budget lifecycle on every exit path |
| Inngest durable scheduler (`packages/inngest`, `/api/inngest` mount) | EXISTS | 3/3 tests; live relay keys operator-gated |
| `tool.browser` (SSRF guard + fetch backend) | HARDENED | 15 tool tests + 58 injection asserts; Stagehand backend SPEC'D |
| Sub-agent fork dispatch + `tool.delegate` (Ph 52, 58) | EXISTS | per-call BudgetTracker reserve/commit |
| Chat dispatch endpoint (3-mode + forecast block, Ph 43/50) | EXISTS | app.test.ts asserts |
| Per-run state singleton + autonomy ratchet (Ph 22, 30) | HARDENED | 19 asserts; `tool.connector.*` inherits |

### Safety & governance (the moat)
| Capability | Status | Evidence |
|---|---|---|
| Autonomy gate (propose/execute_safe/execute_full in SDK hooks) | HARDENED | pure-function module; prompt cannot bypass |
| Can't-fail floor: 14 keys Opus-pinned, override-exempt, fail-closed | HARDENED | 10 cantfail + 4 allowlist-parity asserts; `cantfail.model_violation` |
| CRA prohibition blocklist (hard gate, no tenant override) | HARDENED | 36 asserts; hydrate refusal + runtime SessionStart guard |
| Prompt-injection guard (6 categories) in tool dispatch | HARDENED | 58 asserts; scrub on any external-trust tool |
| Budget reserve/commit/release + DB persister + restart hydrate (Ph 16/17/31) | HARDENED | 57 + 11 + 6 asserts |
| Tenant monthly cost cap + `tenant_month_to_date_usd()` (Ph 53, mig 0025) | EXISTS | chat-dispatch gate; nightly rollup Inngest fn |
| Eval scorecard → autonomy ladder controller (Ph 18/20/21) | HARDENED | 33+25+25 asserts; cant-fail capped execute_safe |
| Real-time anomaly circuit-breaker (V2 P5) | EXISTS | 15/15 pure tests; post-run live sink DB-gated |
| Critic peer-approval: quorum on low-stakes, human keeps doubt (V2 P6, mig 0028) | EXISTS | 37/37 pure tests; live sink DB-gated |
| Agent lease arbitration: one owner per (kind, key); cant-fail preempts; tier-wins (I-003, mig 0029) | EXISTS | 42/42 pure tests; unique-active DB index; relay audit |
| Tenant-isolation tester package (32 vectors) | EXISTS | live run = launch gate; static suite green |

### Intelligence & self-improvement
| Capability | Status | Evidence |
|---|---|---|
| Model Router: tier intent → fuel slug, T-critical pin, tier_overrides | HARDENED | 36 router asserts; `model.routed` audit on every fork |
| Model catalog + pickBestModel value-per-dollar (Ph 38/39, mig 0020) | HARDENED | 32 asserts; 11 canonical models seeded |
| Intelligent task routing: task_profile 3-path resolver (Ph 40/41) | HARDENED | 21 asserts; runner cache + per-skill/per-tool emit |
| Model feedback loop + proposals queue + auto-apply guardrails (Ph 44/45, mig 0022) | EXISTS | 26 asserts; T-critical never updated |
| Cost forecasting (`forecastRunCost`, Ph 46) | EXISTS | 21 asserts; forecast endpoint |
| Per-agent episodic memory + reflection + prior-learnings injection (V2 P1+P2) | EXISTS | 15/15 pure tests; pgvector write path DB-gated |
| Objective state + reflexion retry loop (V2 P3, mig 0026) | EXISTS | 48/48 pure tests; lifecycle sink DB-gated |
| Prompt self-improvement proposal engine (V2 P4, mig 0027) | EXISTS | 39/39 pure tests; cant-fail never auto-applied |

### Multi-tenancy & contracts
| Capability | Status | Evidence |
|---|---|---|
| RLS on every table incl. vector store; tenant_id everywhere | EXISTS | live verification operator-gated (launch gate) |
| Tenant policy knobs: tier_overrides, scorecard_thresholds, monthly budget | EXISTS | merge logic tested; JSONB shape validation shipped (tenant-config.ts 38/38) |
| Relay event registry (closed namespace, 40+ names) | HARDENED | 29 asserts; append-only registry |
| Artifacts table + auto-registration from tool results (Ph 47/48, mig 0023) | EXISTS | 4 integration asserts |
| Agent registry + versioned prompts (`agent_prompts`) + lifecycle states (Ph 8.5) | EXISTS | hire/fire/pause/archive endpoints |
| Architect: plain-English → seeded fleet, CRA-refusing, catalog-aware | HARDENED | 37 asserts; remix mode; model suggestions |

### Control plane (operator UI)
| Capability | Status | Evidence |
|---|---|---|
| Dashboard suite (perf / fleet / cost / model-routing tabs) | EXISTS | demo-store overlay pattern; Supabase swap by design |
| Fleet Activity command center | EXISTS | the Visibility pillar hero |
| Editable agent control surface (autonomy/budget/connectors; model deliberately excluded) | EXISTS | model stays server-governed — safety invariant un-violable from UI |
| Approvals inbox with real idempotent decisions (V2 P9) | EXISTS | first-decision-wins guard + V2 P6 critic-quorum/escalated badges |
| Connector marketplace (46+ catalog) + least-privilege scopes | EXISTS | localStorage demo-store; Nango SPEC'D |
| Onboarding: 9 template agents + Get Started checklist | EXISTS | activation signal wired |

### SPEC'D (not built)
| Item | Spec location |
|---|---|
| A2A async handoff chains (correlation/causation, `tool.invoke-agent`) | PLATFORM-V2-ROADMAP.md P7 |
| Autonomous manager: spawn/pause/retire within budget | V2 P8 |
| Auto-onboarding interview → Architect → tailored fleet (Viktor) | V2 P10 |
| Nango connector OAuth behind connection interface | main doctrine §2.4 — client-launch gate |
| Stagehand backend for tool.browser | Phase 7 follow-up |
| Phase 6 doctrine batch seed (12 fulfillment/revenue agents) | ROADMAP.md (unchecked) |
| Phase 9 security tier live verification + secrets-rotation | ROADMAP.md — external-launch hard gate |
| Phase 10 external Cliently launch batch | ROADMAP.md |

## Operator-gated backlog (needs live DATABASE_URL / keys)
1. `supabase db push` migrations 0014–0028 (each has IF NOT EXISTS guards; rollback = DROP of added objects, additive-only so safe).
2. Live isolation suite (`scripts/verify/isolation-live.ts`) — hard gate #2.
3. Live sinks: circuit-breaker post-run hook, reflexion lifecycle hook, self-improvement scorecard-cadence job, critic vote wiring.
4. Inngest signing keys + live relay; Browserbase/Stagehand keys.

## Ledger counts
- Capabilities: 35 tracked · HARDENED 14 · EXISTS 21 · SPEC'D 8 · PROPOSED → IDEAS.md
- Offline assertion count (standing battery): 286 + per-module suites ≈ 700+ total
