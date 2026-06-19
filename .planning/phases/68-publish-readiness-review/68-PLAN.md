---
phase: 68
plan_id: 68-publish-readiness
depends_on: []
source_review: .planning/phases/68-publish-readiness-review/68-REVIEW.md
autonomous: true
requirements: [CR-01, CR-02, CR-03, CR-04, CR-05, WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, IN-01, IN-03]
files_modified: [packages/core/src/lifecycle-sinks.ts, packages/core/src/a2a.ts, packages/core/src/lease.ts, packages/core/src/manager.ts, packages/core/src/onboarding.ts, apps/api/src/index.ts, apps/control-plane/src/lib/data.ts, apps/control-plane/src/components/run-detail.tsx, apps/control-plane/src/lib/app-context.tsx, apps/control-plane/src/routes/_app/proposals.tsx, scripts/setup/setup.ts, docs/lease-arbitration.md, docker-compose.yml, .env.example]
---

## Objective

Close the bridge-from-pure-to-DB defect cluster: V2 sinks in `lifecycle-sinks.ts` ship with `tenantId: ""` stubs (CR-01); four admin/data endpoints leak or fail to re-assert tenant scope (CR-02/CR-03/CR-04/WR-06). Plus operator-surface fixes next to them (CR-05 secret echo, WR-01..WR-05 doctrine drift) and two cheap polish items (IN-01, IN-03). One PR, surgical scope, no new features. After this lands the V2 sink builders are safe to wire and the 21-suite gate plus the suites in Verification stay green.

## must_haves

- Cant-fail prompt amendments NEVER auto-apply: `requires_human_approval` honored in API + UI before Apply.
- Every Drizzle write and relay emit in `lifecycle-sinks.ts` carries the real `tenantId` — no `""` defaults, runtime length-guarded.
- Every admin write and cross-row select in `apps/api/src/index.ts` carries both `id` AND `tenantId` predicates.
- `data.runActivity` and `data.tenants` scope to caller tenant/user with `sb()`'s defense-in-depth pattern.
- Vault and provider secrets never echo during `pnpm setup`.
- T-critical pin, CRA refusal, tenant RLS, can't-fail human-only invariant all remain enforced.

## truths

- **T-001 RLS defense-in-depth:** every layer re-asserts tenant (`data.ts:75-89`).
- **T-002 Tier wins, override loses:** can't-fail = Opus, no override, no auto-apply (CLAUDE.md §1).
- **T-003 Vault never logged:** secrets only in `.env` 0600 or memory — never stdout/logs/echo.
- **T-004 Relay registry is the contract:** comments, emits, and `relay/events.ts` MUST agree.

## Tasks

### Task 1 — Thread `tenantId` through lifecycle-sinks; drop empty-string defaults (CR-01)

<read_first>packages/core/src/lifecycle-sinks.ts (entire); lease.ts:144-220 (LeaseSink); improve.ts:60-160 (ImprovementSink); critic.ts (CriticReviewSink); packages/db schema (agentLeases, agentImprovementProposals, agents).</read_first>

<action>
Every sink resolves real `tenantId` from the owned row before writing/emitting.
- `buildCriticReviewSink.emitDecision` (L197-212): add `tenantId` to the input shape; runner threads it from the loaded proposal.
- `buildLeaseSink.acquire` (L243-258): resolve via `SELECT tenant_id FROM agents WHERE id = $1` keyed on `input.holder.ownerAgentId`. Throw `unknown owner agent — refusing acquire` if join is empty.
- `buildLeaseSink.emit` (L273-301): same lookup for primary `agent.lease_decided` AND secondary `cantfail.lease_preempt`.
- `buildImprovementSink.writeProposal` (L404-419) + `.emitProposed` (L421-433): resolve via `agents.tenantId` by `agentId`; reuse across write + emit.
- Add top-of-file `assertTenant(t: string)` that throws `tenant_id required — refusing to write empty-string row` when `!t || t.length === 0`. Call on every write/emit so regressions fail loud.
- Replace `// operator: pull from ...` / `// operator: enrich` comments with one-line docstrings naming the resolution path.
- Update sink contract signatures where the runner already has the row so `tenantId` is threaded explicitly.
</action>

<acceptance_criteria>
- `grep -nE 'tenantId:\s*""' packages/core/src/lifecycle-sinks.ts` → 0.
- `grep -n 'operator: pull from holder context\|operator: enrich' packages/core/src/lifecycle-sinks.ts` → 0.
- `grep -nE 'assertTenant\(' packages/core/src/lifecycle-sinks.ts | wc -l` ≥ 5.
- `pnpm -r typecheck`, `test:lease`, `test:improve`, `test:critic`, `test:objective` pass.
</acceptance_criteria>

### Task 2 — Cant-fail gate on improvement-proposal apply + UI confirmation (CR-02)

<read_first>apps/api/src/index.ts:1440-1513; improve.ts:13-25; proposals.tsx:130-167; architect/hydrate.ts (`isCantFail`).</read_first>

<action>
Before `if (body.decision === "apply")` at L1472:
1. Lookup agent scoped to tenant: `db.select({ key: schema.agents.key }).from(schema.agents).where(and(eq(schema.agents.id, proposal.agentId), eq(schema.agents.tenantId, tenantId))).limit(1)`. 409 if missing.
2. If `proposal.requiresHumanApproval || isCantFail(agent.key)` → require header `x-confirm-cantfail: yes`. Missing → 412 `{ error: "cant-fail proposal requires explicit confirmation header x-confirm-cantfail: yes", proposalId, agentKey }`.
3. On successful apply emit relay `cantfail.improvement_applied` (else `improvement.applied`) with `{ proposal_id, agent_id, version, applied_by: "operator" }`.

In proposals.tsx L130-167: when `proposal.requiresHumanApproval`, Apply MUST be gated by a `confirmed` checkbox in the same card (useState). Disable Apply until `confirmed === true`. Send `x-confirm-cantfail: yes` only on confirmed apply.
</action>

<acceptance_criteria>
- `grep -nE 'x-confirm-cantfail' apps/api/src/index.ts` ≥ 2.
- `grep -n 'cantfail.improvement_applied' apps/api/src/index.ts` ≥ 1.
- `grep -nE 'confirmed' apps/control-plane/src/routes/_app/proposals.tsx` shows confirmation state + `disabled` reference.
- `pnpm -r typecheck` passes.
</acceptance_criteria>

### Task 3 — Tenant predicate on manager-proposal apply + manager dedup (CR-03 + WR-05)

<read_first>apps/api/src/index.ts:1532-1571; manager.ts:117-156; lifecycle-sinks.ts:440-473; packages/db schema (managerProposals).</read_first>

<action>
**CR-03 (L1561-1564):** change `where(eq(schema.agents.id, proposal.agentId))` → `where(and(eq(schema.agents.id, proposal.agentId), eq(schema.agents.tenantId, tenantId)))`. Add `.returning({ id: schema.agents.id })`; if empty: `return c.json({ error: "proposal references agent outside tenant — refusing to apply" }, 409);` BEFORE stamping the proposal row.

**WR-05:**
1. Add to `ManagerSink`: `hasOpenProposal(tenantId, agentId, kind: ManagerAction["kind"]): Promise<boolean>;`.
2. Implement in `buildManagerSink`: `SELECT 1 FROM manager_proposals WHERE tenant_id=$1 AND agent_id=$2 AND kind=$3 AND status='pending' LIMIT 1`.
3. In the manager runner (find `runManagerCycle`), before each `writeProposal` skip when `hasOpenProposal` returns true. Emit `manager.action_skipped_dedup` with `{ agent_id, kind, reason: "open_pending_proposal" }`.
</action>

<acceptance_criteria>
- Diff at L1562 shows the `agents.tenantId` predicate added.
- `grep -n 'hasOpenProposal' packages/core/src/manager.ts packages/core/src/lifecycle-sinks.ts | wc -l` ≥ 3.
- `grep -rn 'manager.action_skipped_dedup' packages/core/src` ≥ 1.
- `pnpm -r typecheck` passes.
</acceptance_criteria>

### Task 4 — Tenant scope for `data.runActivity` and `data.tenants` (CR-04 + WR-06)

<read_first>apps/control-plane/src/lib/data.ts:75-89 (`sb` wrapper) + 409-450; run-detail.tsx:18-25; app-context.tsx:24-30.</read_first>

<action>
**CR-04:** `runActivity(runId: string)` → `runActivity(runId: string, tenantId: string)`. Supabase branch: `.eq("tenant_id", tenantId)` AND post-fetch `if (rows.some((r) => (r as { tenant_id?: string }).tenant_id !== tenantId)) throw new Error("runActivity: cross-tenant row in response — refusing to surface");`. Update `run-detail.tsx:20` to pass `tenantId` from app-context.

**WR-06:** `tenants()` → `tenants(userId: string)`. Supabase: `supabase.from("tenants").select("*, tenant_members!inner()").eq("tenant_members.user_id", userId).order("created_at")`. Add a top-of-function comment noting `tenants` is a metadata table; auth-scope (not row-tenant-id) is the right control. Update `app-context.tsx:26` to pass `userId`. Defense-in-depth: drop any row missing a joined `tenant_members` row.

Demo paths unchanged.
</action>

<acceptance_criteria>
- `grep -nE 'runActivity\(runId: string, tenantId: string\)' apps/control-plane/src/lib/data.ts` matches.
- `grep -nE 'eq\("tenant_id", tenantId\)' apps/control-plane/src/lib/data.ts` ≥ 1.
- `grep -n 'runActivity: cross-tenant' apps/control-plane/src/lib/data.ts` = 1.
- `grep -nE 'data\.runActivity\(' apps/control-plane/src` only matches updated callsites.
- `grep -nE 'tenant_members' apps/control-plane/src/lib/data.ts` ≥ 1.
- `pnpm -r typecheck` passes.
</acceptance_criteria>

### Task 5 — Suppress local echo for secret prompts in `pnpm setup` (CR-05)

<read_first>scripts/setup/setup.ts:170-215.</read_first>

<action>
Add `secretQuestion(rl, prompt)` helper above `main`:
1. Write `prompt` once.
2. Capture original `output._writeToOutput`; override with `(s) => process.stdout.write(s === "\n" ? "\n" : "*")`.
3. Await `rl.question("")`.
4. Restore original `_writeToOutput`.
5. Write a trailing `\n`.

Replace `rl.question(...)` at L181, L199, L203, L205 with `secretQuestion(rl, ...)`. Leave y/N at L197 alone. After writing `.env`: `console.log("  → secrets entered with local echo suppressed; raw values exist only in .env (mode 0600).");`.
</action>

<acceptance_criteria>
- `grep -nE 'secretQuestion' scripts/setup/setup.ts | wc -l` ≥ 5 (1 def + 4 calls).
- `grep -nE 'rl\.question\("OPENROUTER_API_KEY' scripts/setup/setup.ts` → 0.
- `grep -nE '_writeToOutput' scripts/setup/setup.ts` ≥ 1.
- `pnpm -r typecheck` passes.
</acceptance_criteria>

### Task 6 — Real reflexion fields in `loadAttempts` (WR-01)

<read_first>lifecycle-sinks.ts:97-109; objective.ts (`decideReflexion`); packages/db schema (runs, run_summaries, autonomy_events).</read_first>

<action>
Replace `loadAttempts` in `buildReflexionSink`:
1. After loading `runs` rows for `objectiveId`, batch-fetch `SELECT run_id, summary FROM run_summaries WHERE run_id IN (...)` → `summaries`.
2. Batch-fetch `SELECT run_id, event_name FROM autonomy_events WHERE run_id IN (...) AND event_name IN ('verification.passed','verification.failed') ORDER BY ts DESC`, reduce to first-seen-per-run → `verdicts`.
3. Build each `AttemptOutcome` with `summary: summaries.get(r.id) ?? ""` and `verificationPassed: verdicts.get(r.id) === "verification.passed" ? true : verdicts.get(r.id) === "verification.failed" ? false : null`.

If `packages/db` lacks either table, keep a guarded fallback returning the same shape with `null`/`""` AND add `// TODO: not production-ready — requires {table_name}` at the top of `buildReflexionSink`. Either way the hardcoded literals at L106-107 must go.
</action>

<acceptance_criteria>
- `grep -nE 'verificationPassed: null,\s*//\s*operator' packages/core/src/lifecycle-sinks.ts` → 0.
- `grep -nE 'run_summaries|runSummaries' packages/core/src/lifecycle-sinks.ts` ≥ 1.
- `grep -nE 'verification\.passed|verification\.failed' packages/core/src/lifecycle-sinks.ts` ≥ 1.
- `test:objective` passes.
</acceptance_criteria>

### Task 7 — Handoff event-name doc/code alignment (WR-02)

<read_first>a2a.ts:144; lifecycle-sinks.ts:370; relay/events.ts.</read_first>

<action>
In `a2a.ts:144` change `agent.handoff_initiated` → `agent.handoff_decided` in the doctrine comment. Extend: payload `action` ∈ `queue | refuse_paused | refuse_cross_tenant | refuse_unknown`. Do NOT rename code — `relay/events.ts` already registers `agent.handoff_decided`.
</action>

<acceptance_criteria>
- `grep -n 'agent.handoff_initiated' packages/core/src/a2a.ts` → 0.
- `grep -n 'agent.handoff_decided' packages/core/src/a2a.ts` ≥ 1.
- `grep -nE 'queue\s*\|\s*refuse_paused' packages/core/src/a2a.ts` ≥ 1.
</acceptance_criteria>

### Task 8 — Wire `validateTierOverrides` into PUT tier-overrides (WR-03)

<read_first>apps/api/src/index.ts:1267-1314; tenant-config.ts:50-110.</read_first>

<action>
Replace the manual checks at L1277-1298 with the validator:
1. `const candidate = { [b.tier]: newSlug }`. If `newSlug === null`, skip the validator (clearing always allowed for non-critical; T-critical still falls through to the pin refusal).
2. `const v = validateTierOverrides(candidate); if (!v.ok) return c.json({ error: "invalid override", reasons: v.reasons }, 400);`
3. Keep the catalog-existence + `tierAffinity !== "T-critical"` check as a SECOND pass — validator only does shape.
4. Import `validateTierOverrides` from `@agent-os/core` at L38.
</action>

<acceptance_criteria>
- `grep -n 'validateTierOverrides' apps/api/src/index.ts` ≥ 1.
- T-critical still rejected.
- `test:tenant-config` and `pnpm -r typecheck` pass.
</acceptance_criteria>

### Task 9 — Tenant-prefix convention for lease target keys (WR-04)

<read_first>lease.ts:34-50; lifecycle-sinks.ts:228-241; docs/lease-arbitration.md.</read_first>

<action>
**Convention:** lease target `key` MUST be tenant-prefixed: `{tenantId}/{resource_id}` (with `kind` staying the resource-class string). Document in `docs/lease-arbitration.md` under a new "Tenant scoping" section (≤ 15 lines); reference from `LeaseTarget` jsdoc.

**Runtime assertion:** add `assertTenantScopedKey(target: LeaseTarget, tenantId: string)` near the top of `lease.ts`. Check `target.key.startsWith(${tenantId}/)`. Call from `buildLeaseSink.loadActive` and `.acquire` BEFORE the query/insert. Throw `lease target key not tenant-prefixed — refusing to load/acquire (tenant=${tenantId}, key=${target.key})` on mismatch. Update existing tests if they construct un-prefixed keys.
</action>

<acceptance_criteria>
- `grep -n 'assertTenantScopedKey' packages/core/src/lease.ts packages/core/src/lifecycle-sinks.ts | wc -l` ≥ 3.
- `grep -nE '## Tenant scoping|tenant-prefixed' docs/lease-arbitration.md` ≥ 1.
- `test:lease` passes.
</acceptance_criteria>

### Task 10 — Polish: CRA word-boundary + prod banners (IN-03 + IN-01)

<read_first>onboarding.ts:53-91; docker-compose.yml:1-40; .env.example:38-45.</read_first>

<action>
**IN-03:** change `combined.includes(k)` → `new RegExp(\`\\\\b${k}\\\\b\`, "i").test(combined)`. Update any fixture that relied on substring matching.

**IN-01:** prepend to `docker-compose.yml`:
```
# LOCAL DEVELOPMENT ONLY. Do not deploy this file.
# Production must use a managed Postgres with a strong password set via a secret manager.
```
Above the localhost `DATABASE_URL` in `.env.example`:
```
# DO NOT use this DATABASE_URL outside localhost. Replace with a managed Postgres URI in production.
```
</action>

<acceptance_criteria>
- `grep -nE 'RegExp.*\\\\b' packages/core/src/onboarding.ts` ≥ 1.
- `grep -n 'LOCAL DEVELOPMENT ONLY' docker-compose.yml` = 1.
- `grep -n 'DO NOT use this DATABASE_URL outside localhost' .env.example` = 1.
- `pnpm --filter @agent-os/core test` passes.
</acceptance_criteria>

## Verification

Run in order; every command MUST exit 0:
```
pnpm -r typecheck
pnpm --filter @agent-os/core test:objective
pnpm --filter @agent-os/core test:improve
pnpm --filter @agent-os/core test:critic
pnpm --filter @agent-os/core test:lease
pnpm --filter @agent-os/core test:relay
pnpm --filter @agent-os/core test:tenant-config
pnpm launch:check
```

If added/changed fixtures (lease keys, CRA strings) break a test, update the fixture in the same task. Never weaken an assertion.

## Risk

**Medium.** CR-01 sink threading changes `emitDecision` input shapes so every runner in objective.ts / critic.ts / a2a.ts / improve.ts / manager.ts may need a one-line update — `pnpm -r typecheck` catches all of them. Bounded: the pure modules and their tests already pass against in-memory fakes; this just makes the production sinks as honest as the fakes. CR-02 / CR-03 / CR-04 / WR-06 are single-line predicate adds with 4+ neighbor sites already using the uniform pattern. CR-05 / IN-01 / IN-03 are leaf changes. WR-04 lease tenant-prefix assert is the only place that fires on an existing-but-unmigrated key — mitigated because `agentLeases` is V2-gated and not yet wired in production. No DB migrations. Net LOC ≈ 550.
