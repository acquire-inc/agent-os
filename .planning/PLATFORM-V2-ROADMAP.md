# AgentOS V2 — Self-Improving Autonomous Fleet (Roadmap)

> Produced from a 9-agent ultracode code review (memory, scheduling, looping,
> self-improvement, A2A, lifecycle, skills, safety + control-plane correctness),
> synthesized through a Karpathy lens. 2026-06-11.

## North star

AgentOS becomes a self-improving multi-tenant fleet where **agents are data** and
the fleet gets measurably better the more it runs, without a human hand-tuning it.
The compounding loop, concretely: each run writes a **per-agent episodic memory**
(outcome + distilled lessons); `buildBundle()` retrieves *"what THIS agent learned
before"* into the next run; a **reflexion/retry** chain carries failure context
toward a declared **objective**; the existing **eval scorecard** ratchets autonomy
up on earned metrics and down on drift; a **critic/peer-approval** layer lets
trusted agents vote on low-stakes proposals (humans still gate can't-fail + CRA);
and a **manager** agent hires/pauses/retires teammates within budget. End state is
the **Viktor-style UI-less product**: a company answers an onboarding interview,
the Architect auto-provisions a tailored fleet (hard floors intact), and that fleet
self-tunes against the client's real outcomes.

**Load-bearing invariants (never traded):** can't-fail (14 keys) always Opus +
human-in-the-loop; CRA eligibility-decisioning always refused; multi-tenant RLS on
every read incl. the vector store; safety enforced in SDK hooks no prompt bypasses.

## What already exists (stronger than expected)

- **Self-improvement loop** — `eval/scorecard.ts → controller.ts → job.ts`
  auto-promotes/demotes on the autonomy ladder from approval + verification rates
  (can't-fail capped at execute_safe; `force_demote_safety` floor). Needs the
  scheduled Inngest wiring.
- **Model self-tuning** — `model_feedback_proposals` (0022) + `aggregateModelObservations`.
- **Scheduling** — `scheduler.evaluateDueJobs` materializes due jobs → runs.
- **Agent creation** — `architect.proposeBlueprint → seedFromBlueprint` (LLM assembly).
- **Sub-agent fork** — `runner/sub-agent.ts` forks a sub-task onto a picked model.
- **Static knowledge RAG** — `knowledge.ts indexDocument/retrieve`.

## Gap matrix (dimension → state → top gap)

| Dimension | State | Top gap |
|---|---|---|
| Agent memory | partial | tenant-global, write-only-at-completion; no per-agent episodic memory, no reflection/distillation |
| Scheduling / looping | partial | no objective-driven looping or reflexion retry; runs start fresh |
| Self-improvement | partial | only the **router** improves; agent prompts/skills are manual-only |
| A2A orchestration | partial | handoff designed but unwired (no correlation/causation, no `tool.invoke-agent`) |
| Lifecycle | partial | no real-time circuit-breaker; no autonomous spawn/pause/retire |
| Skills | partial | whole doctrine skill domains missing; no skill observability/versioning/health |
| Peer-approval | partial | approval is human-only; no critic-agent path, no quorum, no critic feedback |

## Phased roadmap

Ordered by value + dependency. **buildable-now** = no live Supabase DB needed
(this environment); operator-gated phases author migrations + typecheck, defer
`supabase db push`.

| # | Phase | Buildable now | Depends |
|---|---|---|---|
| **1** | **Per-agent episodic memory** (write-back + agent-scoped namespaces) | ✅ | — |
| **2** | **Reflection/distillation + prior-learnings retrieval** in buildBundle | ✅ | 1 |
| **3** | **Objective state + reflexion retry loop** (run-to-run carryover) — pure logic + migration + tests shipped | ✅* | 2 |
| **4** | **Agent self-improvement: prompt proposal engine** — pure logic + migration + tests shipped | ✅* | 3 |
| **5** | **Real-time anomaly circuit-breaker** + continuous approval-rate monitor | ✅ | 4* |
| 6 | Critic-agent peer-approval (human-gated for can't-fail + CRA) | DB-gated | 5 |
| 7 | Async A2A handoff chains (correlation/causation wiring) | DB-gated | 6 |
| 8 | Autonomous manager: spawn/pause/retire endpoint + scheduled job | DB-gated | 7 |
| **9** | **Control-plane correctness pass** (invalidations, idempotency, Supabase-readiness) | ✅ | — |
| 10 | Auto-onboarding: interview → Architect → self-tuning tailored platform (Viktor) | DB-gated | 8,9 |

\*P5's pure circuit-breaker function is buildable now; its scheduled wiring is DB-gated.

## Execution order (this environment)

Build the buildable-now compounding core first: **P1 → P2** (the memory loop, the
#1 capability and the foundation everything else compounds on), then **P5** (safety
circuit-breaker, pure function) and **P9** (control-plane correctness). The
DB-gated phases (3,4,6,7,8,10) get migrations + pure logic + typecheck now and
`supabase db push` + live wiring when an operator unblocks the database.

## Control-plane correctness findings (P9 backlog, from the review)

1. `agent-store.ts` fallback id uses `Math.random()` — use the counter pattern like connector-store.
2. `decideApproval()` lacks an idempotency check — guard against double-submit / two-tab races.
3. Seeding/deploy invalidates `["agents"]` but not `["agentSpendThisMonth"]` / `["runs"]` — MTD/cost panels go stale.
4. `costByModel` should `if (!model) continue` to guard null model.
5. `data.ts` Supabase path should assert returned rows match `tenantId` (defense-in-depth on RLS).
6. Command palette should refetch agents/mcps on open (it gates queries on `open`).
