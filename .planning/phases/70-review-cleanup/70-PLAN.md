---
phase: 70
plan_id: 70-review-cleanup-fixes
depends_on: []
source_review: .planning/phases/70-review-cleanup/70-FINDINGS-RAW.json
autonomous: true
requirements: [MT-01, MT-02, CORR-03, MT-03, MT-04, MT-06, CORR-09, CORR-15, OPS-01, OPS-02]
files_modified:
  - apps/runner/src/custom-tools.ts
  - packages/core/src/security/vault-rotate.ts
  - packages/core/src/lifecycle-sinks.ts
  - apps/runner/src/lead-pipeline-tools.ts
  - packages/core/src/lead-pipeline.ts
  - apps/api/src/index.ts
  - scripts/seed/acqu-enrichment-scoring.ts
  - docs/connect-and-launch.md
  - scripts/launch-readiness/launch-readiness.ts
---

# Phase 70 — Review + Cleanup + Hardening Fixes

## Objective

Close the Phase 70 review's fix-class cluster: the Phase-9 security tools
(vault-rotate, access-audit, access-log-analyzer) predate the ctx-derived
tenant pattern and accept agent-supplied tenant/mcp identifiers — the same
cross-tenant class Phase 68/69 closed everywhere else. Plus: the critic sink
hardcodes cost 0 (making every proposal critic-eligible instead of
human-routed), the apify matrix gate fails open for unregistered actors,
update_lead trusts agent-supplied `qualified`, and the P4 scoring-failure
path orphans leads in `enriching`.

## must_haves

- No runner tool handler reads tenant identity from agent-supplied input.
- rotateCredential fails closed without a tenant match (core-level predicate).
- Unknown stake (`estimatedCostUsd: null`) routes critic proposals to human.
- Unregistered Apify actors are refused at dispatch (fail closed, no escape hatch).
- `update_lead` cannot write `qualified=true` when `dnc_flag=true` or `email_status='invalid'` — server-side, not prompt-side.
- Scoring-failed leads are re-processable (no permanent `enriching` orphans).
- launch:check covers the runner safety suites; launch docs cover the lead-pipeline seeds.

## truths

- T-001: Tenant identity comes from the bundle (ctx), never from the model.
- T-002: The matrix is the contract at dispatch — fail closed on unknowns.
- T-003: Hard disqualifiers (DNC, invalid email) are server-enforced; prompts are advisory.
- T-004: Unknown stake is human-routed (critic doctrine: doubt → human).

## Tasks

### T1 — MT-01 + MT-02: Phase-9 security tools tenant scoping
<read_first>apps/runner/src/custom-tools.ts:176-205, packages/core/src/security/vault-rotate.ts</read_first>
<action>
vault-rotate: require ctx.tenantId; verify the mcp belongs to the tenant
(SELECT scoped by id+tenantId) before rotating; pass tenantId into
rotateCredential and add eq(oauthCredentials.tenantId) to its where clause.
access-audit + access-log-analyzer: take tenantId from ctx.tenantId, refuse
when absent; ignore input.tenantId entirely.
</action>
<acceptance_criteria>
- grep "input as { tenantId" apps/runner/src/custom-tools.ts → 0 matches
- rotateCredential signature includes tenantId; where clause has 2 predicates
- runner tests green
</acceptance_criteria>

### T2 — CORR-03: critic sink cost routing
<read_first>packages/core/src/lifecycle-sinks.ts:225-240, packages/core/src/critic.ts</read_first>
<action>Change `estimatedCostUsd: 0` → `estimatedCostUsd: null` so
isCriticEligible routes unknown-stake proposals to human (matches the
comment two lines above it).</action>
<acceptance_criteria>grep "estimatedCostUsd: 0" lifecycle-sinks.ts → 0 matches; critic tests green</acceptance_criteria>

### T3 — MT-03: apify gate fail-closed
<read_first>apps/runner/src/lead-pipeline-tools.ts:93-125</read_first>
<action>After the DISCOVERY_ACTORS.find(), refuse when !matrixActor
(envErr naming the actor + "only registered actors are dispatchable").
Run the ICP target check unconditionally after that.</action>
<acceptance_criteria>
- unregistered actor_id → envErr, no fetch
- runner custom-tools tests updated + green
</acceptance_criteria>

### T4 — MT-04 + CORR-15: server-side hard disqualifiers
<read_first>apps/runner/src/lead-pipeline-tools.ts (updateLead), packages/core/src/lead-pipeline.ts (applyQualificationRules)</read_first>
<action>
updateLead: when the patch sets qualified=true, load/merge effective
dnc_flag + email_status (patch value if present, else current row) and
force qualified=false + append a `hard_disqualifier_applied` note in the
response when either trips. applyQualificationRules: add
Number.isFinite(score) guard → disqualify with "score not finite".
</action>
<acceptance_criteria>
- update_lead with {qualified: true, dnc_flag: true} → row written qualified=false
- NaN score → qualified=false in pure tests
- lead-pipeline + runner tests green (new assertions added)
</acceptance_criteria>

### T5 — MT-06: credential endpoint gating (verify-then-fix)
<read_first>apps/api/src/index.ts around /api/connections/:mcpId/credential</read_first>
<action>Verify the claim (unverified finding). If the endpoint accepts
runner-kind keys, add the admin gate used by sibling admin endpoints. If
already gated, record refuted in REVIEW notes.</action>
<acceptance_criteria>endpoint requires admin auth OR finding recorded refuted with file:line evidence</acceptance_criteria>

### T6 — CORR-09: scoring-failure orphan
<read_first>scripts/seed/acqu-enrichment-scoring.ts, apps/runner/src/lead-pipeline-tools.ts (supabaseQuery leads filter)</read_first>
<action>P4 prompt step 2: load status='new' first, then top up with
status='enriching' stragglers (prior scoring failures) up to batch size;
fix the ERROR HANDLING line that claims failed-scoring leads stay 'new'.
No tool change needed (supabase_query already accepts status filter).</action>
<acceptance_criteria>prompt no longer claims 'stays new'; straggler pickup documented in prompt</acceptance_criteria>

### T7 — OPS-01 + OPS-02: launch surface
<read_first>docs/connect-and-launch.md step 2, scripts/launch-readiness/launch-readiness.ts OFFLINE_TESTS</read_first>
<action>Add `pnpm seed:lead-pipeline` + `pnpm seed:icp-acqu` to the seed
sequence in connect-and-launch.md. Add runner safety suites
(runner test, test:cantfail, test:budget, test:execute-flow) to
OFFLINE_TESTS in launch-readiness.</action>
<acceptance_criteria>launch:check runs the runner suites and stays READY ✓; docs list both seeds</acceptance_criteria>

## Verification

pnpm -r typecheck · pnpm --filter @agent-os/core test:lead-pipeline ·
test:critic · pnpm --filter @agent-os/runner test · pnpm launch:check

## Risk

Low-medium. T1 touches the vault path (security-sensitive, but additive
predicates only). T4 changes update_lead semantics — the P4 prompt already
documents the hard rules, so agent-side behavior is unchanged; only a
misbehaving agent is newly constrained.
