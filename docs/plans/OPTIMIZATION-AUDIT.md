# Optimization Audit — what's missing for the OS to actually function

Compiled 2026-06-02 from a live codebase survey. The system has the spine
(Relay, Model Router, can't-fail safety, RLS, 4 migrations queued) but
several layers are stubbed, deferred, or missing. This doc catalogs every
gap and sequences the closures.

**Posture**: not going live until the gaps are closed. Operator gates
(supabase db push / seed-phase-9 / verify:isolation-live) DEFERRED until
the agents have what they need to actually function — not just compile.

---

## Tier 1 — MUST close before any live execution

These are referenced by agent prompts via `skills[]` and would register
at version `0.0.0` with no body. The discipline lives only in the agent
prompt today; agents would degrade silently. Three of the four
T-critical-blocking ones are below.

### 1.A — 11 missing SKILL.md bodies

| Skill | Bound agent | Tier | Status |
|---|---|---|---|
| `ftc-claim-review` | ad-claim-compliance | **T-critical** | MISSING |
| `hormozi-offer-construction` | offer-architect | **T-critical** | MISSING (agent enabled=false) |
| `guarantee-design` | offer-architect | **T-critical** | MISSING (agent enabled=false) |
| `cole-gordon-mechanism` | offer-architect | **T-critical** | MISSING (agent enabled=false) |
| `adversarial-offer-critique` | offer-validator | **T-critical** | MISSING (agent enabled=false) |
| `briefing-synthesis` | briefing | T-reason | MISSING |
| `dunning-sequence` | dunning-manager | T-work | MISSING |
| `expense-categorization` | expense-tracker | T-cheap | MISSING |
| `margin-alerts` | margin-monitor | T-cheap | MISSING |
| `launch-discipline` | launcher | T-work | MISSING |
| `naming-convention` | launcher | T-work | MISSING |

**Closure**: write 11 SKILL.md bodies following the established frontmatter
+ Purpose / Workflow / Rules shape (see `clarify-before-acting`,
`verification-before-completion`, `tenant-isolation-testing` as exemplars).
Doctrine source: `acqu-agent-doctrine.md` §2.1-2.5 + `acqu-agent-doctrine-v2.md`
domain sections. Each is a 1-pass translation from doctrine prose to skill
body — no new strategy required.

### 1.B — MCPs (NOT a gap)

Confirmed all 11 MCPs referenced by seeds are in `packages/shared/src/fixtures.ts`
`demoMcps` array: Close, Pipeboard × Meta, Slack, Google Drive, Fireflies,
Gmail, pgvector Knowledge, Stripe, QuickBooks, Google Calendar, Twilio.
`pnpm db:seed` populates them. Status: OK.

---

## Tier 2 — Should close before white-label launch (Step 4)

### 2.A — Knowledge folder gap

Agent `knowledgeScope.folders[]` references ~30 distinct folders
(`ad-playbooks`, `clients`, `compliance`, `finance`, `offers`,
`copywriting`, `verticals`, `kb:campaign-plan/{tenant}/`, etc.) but
`demoFolders` seeds only 3 (Clients, Ad Playbooks, Memory).

Effect: agents query `retrieve()` with namespaces that have zero
content. They'll surface "no relevant context" findings rather than
crash, but every run starts cold.

**Closure path**: either (a) seed empty folder rows for the 27 missing
namespaces so retrieve() at least binds to known scopes, or (b) build a
folder-bootstrap step in the per-tenant onboarding flow that ensures the
agent's declared scope has matching folder rows. (b) is cleaner.

### 2.B — 13 deferred deterministic tools

Documented in commit `8fba106`. Each currently runs as in-prompt logic or
a filesystem stand-in. The DEFERRED markers in the prompts are the
backlog:

| Tool | Replaces in-prompt | Used by |
|---|---|---|
| `tool.rules-engine` | kill/scale/hold rubric | ad-ops |
| `tool.rate-limit-guard` | 1-change-per-ad-per-day | ad-ops |
| `tool.pixel-health` | event-volume baseline | ad-ops, compliance-health |
| `tool.account-health` | 5-signal rubric | compliance-health |
| `tool.ad-library-scraper` | tool.browser fallback | creative-miner |
| `tool.swipe-dedup` | knowledge cosine similarity | creative-miner |
| `tool.winning-ad-finder` | knowledge query | creative-miner |
| `tool.creative-db` | kb file output | creative-miner |
| `tool.attribution-engine` | attribution kb | weekly-report |
| `tool.calendar-bridge` | Slack handoff | lead-triage |
| `tool.proof-vault` | filesystem | case-study-builder |
| `tool.ad-launcher` (with DRY-RUN) | manual diff + approval | launcher |
| `tool.unit-economics-engine` | run_summaries query | pricing-architect |

**Closure path**: each is a deterministic tool with a defined input/output
shape from its in-prompt description. Ship as `packages/tool-*/` workspaces
mirroring `tool-rls-test` + `tool-browser`. Priority order: pricing-architect
(T-critical) → creative-miner (daily fleet driver) → ad-ops → launcher →
the rest.

### 2.C — Production embedder

`hashEmbedder` is dev-only. Production knowledge retrieval needs Voyage,
OpenAI, or Cohere wired into the pgvector retrieval path. Open Q #7 in
AGENT-OS-PLAN parked.

**Closure path**: pick one provider (Voyage AI Voyage-3 is the cleanest
for our shape — 1024-dim embedding, ~$0.18/M tokens). Wire as an
`Embedder` impl in `packages/core/src/knowledge.ts`. Add `Rerank 4 Pro`
on the read path as the relevance lever per `main-acqu-agent-doctrine.md`
§1.4.

### 2.D — `tool.browser` Stagehand backend

Phase 7 deferred the Stagehand integration. `tool.browser` currently
returns plain `fetch` results, which means agents can't read JS-rendered
pages. discovery-prep + creative-miner + lead-triage all need real
browser automation.

**Closure path**: integrate Stagehand on top of Browserbase per the
phase 7 plan. Browserbase API key + Stagehand session per tool dispatch.

### 2.E — agent-evaluator scorecard implementation

The `agent-evaluator` agent exists as a seed (T-work, cron `0 23 * * *`,
$2 budget) but has no scorecard logic. It would run today and produce
empty output. The doctrine specifies it reads `run_summaries` rollups
and writes promotion proposals, but the read/write code doesn't exist.

**Closure path**: build the scorecard module (`packages/core/src/eval/`)
with: weekly run_summaries rollup per agent → score against agent-class
rubric → propose promotion (autonomy ↑) or demotion (autonomy ↓) →
emit to Approvals inbox. T-critical agents emit `propose` regardless of
score (Open Q #1 RESOLVED carries forward).

### 2.F — Reserve/commit budget pattern

Open Q #5 in AGENT-OS-PLAN. Today: `runs.cost_usd` committed post-run.
For the free-tier launch-gate predicate (no $5/mo cap until reserve
exists), this is the blocker.

**Closure path**: PreToolUse reserves estimated cost in
`runs.reserved_usd`. PostToolUse commits actual to `runs.cost_usd`.
SessionEnd reconciles (committed - reserved). Add SQL trigger to flip
status=quarantined if (sum of reserved_usd this tenant this month) >
cap.

### 2.G — CRA blocklist implementation

GENX-PLAN Open Q #8 RESOLVED mechanism — never built. Needs:
- `packages/core/src/architect/cra-blocklist.ts` (frozen constant)
- `assertNotCraProhibited(blueprint)` in `hydrate.ts`
- `architect.refused` Relay event emission
- Runner SessionStart `cantfail.cra_violation` belt-and-suspenders
- 5 negative tests + 1 positive bundle-regression test

**Closure path**: defined in plan; this is execution. Blocker for any
public-tier launch but not for white-label-with-manual-approval.

---

## Tier 3 — Step 4+ work (defer)

- `/relay/ingest` HTTP endpoint + Pixel SDK contract
- `tenants` column additions (type=public, feature_flags, subscription_tier, max_active_agents, max_concurrent_runs, timezone, allowed_origins, brand)
- `tenant_billing_meters` table + reserve/commit metering
- White-label theming `<TenantThemeProvider>` in apps/control-plane
- Free-tier cap enforcement at PreToolUse + SessionStart
- Execution Plane (VPS-sandboxed ephemeral runner containers per tenant)
- Self-Improvement Loop (governance-gated mutation)
- Multi-Dataset Data Moat (derived datasets from Relay)
- wifiwave/agentic-templates audit + quarantined extraction

These ship in priority order but only AFTER Tier 1 + Tier 2 close.

---

## Closure order (this session + next)

**This session** — Tier 1 closure:
- All 11 missing SKILL.md bodies (highest leverage, no live infra needed)
- Flip offer-architect + offer-validator from enabled=false to enabled=true
  ONCE their 4 skill bodies exist (preserve safety: they stay
  CANT_FAIL_KEYS-protected; architect refuses to assemble synthesis;
  Model Router pins T-critical Opus; runtime fail-closed assertion)

**Next session(s)** — Tier 2 closure:
1. agent-evaluator scorecard module (the missing brain — promotes/demotes
   are doctrine-stated but unimplemented)
2. Production embedder + Rerank 4 Pro wiring
3. CRA blocklist implementation (mechanism resolved; code missing)
4. Reserve/commit budget pattern (launch-gate predicate)
5. Tool.browser Stagehand backend
6. The 13 deferred deterministic tools (priority: T-critical agents
   first → daily-cron drivers → on-demand)

---

## Verification gate (when Tier 1 + 2 close)

Before recommending the operator gates run:
- Every agent's `skills[]` references resolve to a SKILL.md body on disk
- agent-evaluator can produce a scorecard from existing run_summaries
- Production embedder + reranker on the read path
- CRA blocklist code-enforced + tested
- Reserve/commit pattern with SQL trigger + invariant test
- Tool.browser actually reads JS-rendered pages
- All deferred-tool DEFERRED markers replaced by tools[] bindings OR
  re-documented as "stays in-prompt until V2"

Then run the operator gates with confidence.
