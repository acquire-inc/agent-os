---
phase: 68-publish-readiness-review
reviewed: 2026-06-14T00:00:00Z
depth: deep
branch: claude/exciting-davinci-yvptm
head: 6150d70
files_reviewed: 21
files_reviewed_list:
  - packages/core/src/objective.ts
  - packages/core/src/improve.ts
  - packages/core/src/critic.ts
  - packages/core/src/lease.ts
  - packages/core/src/dispatch-contract.ts
  - packages/core/src/tenant-config.ts
  - packages/core/src/a2a.ts
  - packages/core/src/manager.ts
  - packages/core/src/onboarding.ts
  - packages/core/src/lifecycle-sinks.ts
  - scripts/setup/setup.ts
  - scripts/launch-readiness/launch-readiness.ts
  - scripts/smoke/smoke.ts
  - docker-compose.yml
  - .env.example
  - apps/api/src/index.ts
  - apps/control-plane/src/lib/data.ts
  - apps/control-plane/src/routes/_app/onboard.tsx
  - apps/control-plane/src/routes/_app/health.tsx
  - apps/control-plane/src/routes/_app/proposals.tsx
  - apps/control-plane/src/routes/_app/architect.tsx
findings:
  critical: 5
  warning: 6
  info: 4
  total: 15
status: issues_found
---

# Phase 68: Publish-Readiness Review

Adversarial review of the surfaces 10 teammates will touch day 1. Standing
21-suite battery passes; this hunts the gaps the gates don't catch.

## Critical Issues

### CR-01: `lifecycle-sinks.ts` ships TODO-stub `tenantId: ""` writes — every V2 sink that lands rows poisons tenant scope

**File:** `packages/core/src/lifecycle-sinks.ts:248,275,289,353,408,423,447`
**Issue:** The shipped Drizzle sinks insert rows with `tenantId: ""` and emit relay events with `tenantId: ""` because the comments say "operator: pull from holder context". These are the V2 sinks the operator wires the moment the DB unblocks — `buildLeaseSink.acquire` writes leases with empty `tenantId`, `buildImprovementSink.writeProposal` writes proposals with empty `tenantId`, `buildCriticReviewSink.emitDecision` emits with empty `tenantId`, `buildLeaseSink.emit` does the same. Once these run against the live DB they violate every RLS predicate (`tenant_id = current_setting('app.current_tenant')::uuid` will fail or — worse — match the wrong tenant if any tenant ever has the empty UUID), corrupt the audit trail in `relay_events`, and silently disable defense-in-depth checks in `data.ts:85` (which throws on cross-tenant rows but never sees them because everything is bucketed under "").
**Fix:** Resolve `tenantId` before write. Either thread it through the sink contracts (`LeaseSink.acquire({tenantId, ...})`, `ImprovementSink.writeProposal(tenantId, proposal)`, etc.), or have the sinks look it up: e.g. `loadActive` already returns the row — copy its `tenantId` into emits; `acquire`'s holder.ownerAgentId can JOIN to `agents.tenantId`. Until this is fixed, do NOT enable the V2 sinks in production. Add a `notNull`/`length > 0` runtime guard so a future regression fails loudly instead of writing garbage.

### CR-02: `POST /api/admin/improvement-proposals/:id/decide` apply path ignores `requiresHumanApproval` — cant-fail prompt amendments auto-apply

**File:** `apps/api/src/index.ts:1447-1513`
**Issue:** The header comment at L1444-1446 promises "Cant-fail proposals REQUIRE the requires_human_approval flag to be honored — auto-apply may not skip the requires_human_approval guard." The implementation never reads `proposal.requiresHumanApproval` and never re-checks `isCantFail(agent.key)` on apply. Combined with `proposals.tsx:147` rendering the Apply button enabled even when the "human required" badge shows, an operator (or any future scheduled-apply cron — the file structure clearly anticipates one) flips a cant-fail agent's system prompt with one click and the audit row reads `appliedBy: "operator"` regardless. This is the exact "cant-fail prompt rewrites without human gate" scenario the doctrine forbids (CLAUDE.md §"Cant-fail agents", `improve.ts:14-18`).
**Fix:** Before the `if (body.decision === "apply")` block, look up the agent: `const [agent] = await db.select({ key: schema.agents.key }).from(schema.agents).where(and(eq(schema.agents.id, proposal.agentId), eq(schema.agents.tenantId, tenantId))).limit(1);` then `if (proposal.requiresHumanApproval && !c.req.header("x-confirm-cantfail")) return c.json({ error: "cant-fail proposal requires explicit confirmation header x-confirm-cantfail: yes" }, 412);`. Also emit `cantfail.improvement_applied` relay event on the apply path so the audit trail is searchable. Mirror the same gate in the proposals.tsx UI: disable Apply when `requiresHumanApproval && !confirmed`, require a checkbox.

### CR-03: `POST /api/admin/manager-proposals/:id/decide` apply path updates `agents.enabled` without a `tenantId` predicate

**File:** `apps/api/src/index.ts:1561-1564`
**Issue:** `db.update(schema.agents).set({ enabled: false }).where(eq(schema.agents.id, proposal.agentId))` has no `tenant_id` filter. Today the proposal was loaded scoped to tenant (L1542), so `proposal.agentId` SHOULD be in-tenant — but the proposal table is JSONB-shaped and writeable by the V2 sink that itself ships with `tenantId: ""` (CR-01). A poisoned or cross-tenant proposal row would let an admin from tenant A disable an agent in tenant B with no defense-in-depth check. Same pattern appears nowhere else in this file (e.g. L1645 mcps, L1665 documents) — every other admin update consistently carries both id AND tenantId. This is a single-line gap in a uniform pattern.
**Fix:** `where(and(eq(schema.agents.id, proposal.agentId), eq(schema.agents.tenantId, tenantId)))`. Then if `.returning()` yields no rows, return 409 ("proposal references agent outside tenant — refusing to apply").

### CR-04: `data.runActivity(runId)` reads from Supabase by `run_id` only — no tenant scope, no defense-in-depth check

**File:** `apps/control-plane/src/lib/data.ts:443-450`
**Issue:** Every other `sb()` call in this file goes through the wrapper at L75-89 which asserts `tenant_id === tenantId` post-fetch ("never let a policy regression leak cross-tenant rows"). `runActivity` bypasses that wrapper and uses `supabase.from("run_activity").select("*").eq("run_id", runId)` with no tenant predicate and no post-fetch validation. If a future RLS regression on `run_activity` happens (it's not on the high-traffic tables, easy to forget), or if a runId is guessed/leaked from a relay event, the control plane will silently render another tenant's activity stream. Same omission applies to L412 `tenants()` (no tenant scope at all — but that one is at least a list endpoint, less risky).
**Fix:** Add the same defense-in-depth pattern: pass `tenantId` into `runActivity(runId, tenantId)`, scope the query with `.eq("tenant_id", tenantId)`, and add the post-fetch assertion. Callers all have a tenantId in scope. While here, also scope `tenants()` to the caller's auth context — there's no legitimate UI reason for it to return tenants the user isn't a member of.

### CR-05: `scripts/setup/setup.ts` echoes the OpenRouter API key to the terminal — scrollback / shoulder-surf leak

**File:** `scripts/setup/setup.ts:181`
**Issue:** `await rl.question("OPENROUTER_API_KEY ...")` from `node:readline/promises` echoes every keystroke to stdout. A pasted live key (which is what the wizard prompts for) lands in the terminal scrollback, in tmux/screen logs, and in any session recorder. The same applies to `DATABASE_URL` (L199, contains DB password), `VITE_SUPABASE_ANON_KEY` (L203), and `SUPABASE_SERVICE_ROLE_KEY` (L205 — server-only, never-leave-host). Mode 0600 on the `.env` file (L213) is correct but the leak happens *before* the file is written.
**Fix:** For each secret prompt, suppress local echo before awaiting input. Minimal patch: write a helper that does `process.stdin.on('data', m => process.stdout.write('*'.repeat(0)))` or, simpler, `rl.input.removeAllListeners('keypress'); (rl as any).output.muted = true;` then re-enable. Better: copy the `readline` "stealth question" pattern used by `inquirer` (set the `output._writeToOutput` to suppress). Document that operators should paste the key into `.env` directly as the secure alternative.

## Warnings

### WR-01: `objective.ts` reflexion runner is functionally a no-op — `lifecycle-sinks.loadAttempts` always returns `verificationPassed: null` + `summary: ""`

**File:** `packages/core/src/lifecycle-sinks.ts:97-109`
**Issue:** `decideReflexion` in `objective.ts:109` treats `verificationPassed !== false` as success — so the shipped sink, which hardcodes `verificationPassed: null` for every attempt, makes every "done" run complete the objective and every other run hit the failure path with empty rationale. `composeReflexionContext` then emits `### Attempt N — done (verification: n/a)\n` with no body. So the entire V2 P3 feature is a hollow shell when wired with the shipped sink — the reflexion test passes against fakes, but production-bound rows would carry no learnings forward.
**Fix:** Pull real fields. `summary` should come from `run_summaries.summary` (existing table). `verificationPassed` should come from the latest `autonomy_events` row of kind `verification.passed` / `verification.failed` for that run, or add a `verification_passed` column to `runs` and stop guessing. Mark this stub with a `// TODO: not production-ready` block at the top so the operator can't accidentally wire it.

### WR-02: `a2a.ts` documents the relay event as `agent.handoff_initiated` but emits `agent.handoff_decided`

**File:** `packages/core/src/a2a.ts:144` vs `packages/core/src/lifecycle-sinks.ts:370`
**Issue:** The doctrine comment on the `HandoffSink.emit` contract promises `agent.handoff_initiated`. The implementation emits `agent.handoff_decided`. `launch-readiness.ts:144` and `relay/events.ts:107` are aligned on `_decided`. Result: a future contributor reading the contract emits a name not in the registry → relay invariant guard rejects → the handoff loop silently fails to surface in the dashboard. Doc drift not caught by any standing test.
**Fix:** Update the comment in `a2a.ts:144` to `agent.handoff_decided`. While here, mention that the event payload's `action` field can be `queue | refuse_paused | refuse_cross_tenant | refuse_unknown` so consumers can filter.

### WR-03: `PUT /api/admin/tenants/me/tier-overrides` does not use `validateTierOverrides` — duplicated rules, slug regex bypassed

**File:** `apps/api/src/index.ts:1271-1314`
**Issue:** `tenant-config.ts:59` exposes `validateTierOverrides` which enforces the `MODEL_SLUG_RE` regex (`/^[a-z0-9][a-z0-9._\-]*\/[a-z0-9][a-z0-9._\-]*$/i`) and rejects T-critical centrally. The PUT endpoint re-implements the T-critical refusal but does NOT validate the slug shape — only checks "is it in the catalog". A future seed bug or admin typo with a model that exists in the catalog under a malformed slug (e.g. trailing whitespace, uppercase provider) would be persisted. More importantly, two sources of truth drift: when the validator gains a rule (e.g. block deprecated slugs), the API endpoint won't.
**Fix:** Replace L1282-1298 with `const v = validateTierOverrides({ [b.tier]: b.model }); if (!v.ok) return c.json({ error: "invalid override", reasons: v.reasons }, 400);` and then keep the catalog-existence check as a second pass. The model-existence check stays — the validator only does shape, not catalog membership.

### WR-04: `lease.ts` `decideLease` cant-fail preempt rule does not check tenant scope — cross-tenant preempt is theoretically possible

**File:** `packages/core/src/lease.ts:128-135`
**Issue:** The preempt rule fires whenever the requester is cant-fail and the holder isn't, regardless of tenant. In practice the sink loads only active leases on a `(kind, key)` target and `target_key` is already tenant-scoped at the caller (lead/L-123 belongs to one tenant). But the pure function carries no tenant assertion. A lease target key collision across tenants (e.g. two tenants both use `lead/L-123` as a key — easy with sequential ids) would let tenant A's cant-fail run preempt tenant B's non-cant-fail lease. The lease sink at L228-241 also filters only by `(targetKind, targetKey, releasedAt IS NULL)` with no tenant predicate.
**Fix:** Require target keys to be tenant-prefixed (`lead/{tenantId}/{id}`) and document it in `lease.ts:34`. Or add `tenantId` to `LeaseTarget` and have `decideLease` refuse `request.tenantId !== active.tenantId` regardless of cant-fail status (it's the same defense-in-depth pattern as a2a.ts:87).

### WR-05: `manager.ts` `planManagerCycle` cap counts only proposed actions — paused budget hog can re-propose every cycle

**File:** `packages/core/src/manager.ts:118-144`
**Issue:** `maxActionsPerCycle: 3` caps proposals per call, but `runManagerCycle` is scheduled (per the doctrine, cron). There's no per-(agentId, kind) dedup against the open proposals queue. So an agent that crosses the budget cap stays proposed every cycle — three new `pause` proposals per agent per cycle until the operator handles them. The proposals queue grows unbounded for a single problem agent, drowning the operator inbox.
**Fix:** Before `writeProposal`, check `existsOpenProposal(tenantId, agentId, kind)` and skip. Or — better — make `pause` proposals replace prior pending pauses for the same agent (`ON CONFLICT (agent_id, kind) WHERE status='pending' DO UPDATE`).

### WR-06: `data.tenants()` returns ALL tenants in Supabase mode — no auth scope

**File:** `apps/control-plane/src/lib/data.ts:411-417`
**Issue:** Comment claims "RLS scopes by tenant" but this is a list endpoint over `tenants` — RLS on `tenants` typically scopes by membership join (`tenant_members.user_id = auth.uid()`), not row identity. If the RLS policy permits viewing any tenant the user is a member of, fine; if it permits any authenticated user to list any tenant (common misconfiguration on a metadata table), the control plane's tenant switcher will leak the tenant list. There's no post-fetch defense-in-depth check here unlike `sb()`. The risk surfaces the moment the live RLS policy on `tenants` isn't exactly right.
**Fix:** Either confirm and document the RLS policy on `tenants` (and add a comment with the policy text), or scope the call: `supabase.from("tenants").select("*, tenant_members!inner()").eq("tenant_members.user_id", currentUserId)`. Add a `tenant_id`-NOT-applicable note above the function so future reviewers don't apply the wrong filter.

## Info

### IN-01: `docker-compose.yml` ships `POSTGRES_PASSWORD: postgres` with no "do not use in production" banner

**File:** `docker-compose.yml:31-33`
**Issue:** Fine for `pnpm dev`, but the file has no header banner warning operators against `docker compose up -d` on a public host. `.env.example:42` also defaults `DATABASE_URL` to the same `postgres:postgres@localhost` — easy to forget when promoting an env file.
**Fix:** Add a top comment: `# LOCAL DEVELOPMENT ONLY. Do not deploy this file. Production must use a managed Postgres with a strong password set via secret manager.` Also add a `# DO NOT use this DATABASE_URL outside localhost` comment above `.env.example:42`.

### IN-02: `improve.ts:64` lesson fingerprint is case-and-whitespace-collapsed only — typo'd lessons don't dedupe

**File:** `packages/core/src/improve.ts:64-66`
**Issue:** `lessonFingerprint` does `.toLowerCase().replace(/\s+/g, " ")`. Two near-identical lessons ("Always check the lease before dispatch." vs "Always check leases before dispatching.") count as separate occurrences. `MIN_RECURRENCE: 3` is a real bar, so a tenant whose memory layer emits slightly varied phrasings never triggers a proposal. Not a correctness bug — degraded recall. Worth a fingerprint that strips punctuation and stop-words at minimum.
**Fix:** `lesson.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ")`. Even better, compute a simple bag-of-words hash. Not blocking launch.

### IN-03: `onboarding.ts` CRA keyword check is substring-based — false positives on `tenant_screening` legitimately appearing in copy

**File:** `packages/core/src/onboarding.ts:53-91`
**Issue:** `CRA_TRIGGER_KEYWORDS = ["credit", "underwriting", ...]` matched via `combined.includes(k)`. "credit" is a substring of "accredited," "credit card processing," "credit-positive review." A SaaS onboarding for "credit card processing software" trips CRA refusal and demands the operator click through the "needs_review" flow. Friction, not correctness. Operator-clickable so not critical, but inflates the false-positive rate of a hard gate.
**Fix:** Match on word boundaries: `new RegExp(\`\\\\b${k}\\\\b\`, "i").test(combined)`. The hard "no eligibility decisioning" doctrine is still enforced by the Architect's blocklist downstream — this is just the pre-check.

### IN-04: `scripts/smoke.ts` `--verbose` flag uses Unicode ellipsis in plain stdout, breaks on Windows / non-UTF-8 terminals

**File:** `scripts/smoke/smoke.ts:130,113`
**Issue:** `console.log(`    payload sample: ${JSON.stringify(body).slice(0, 120)}…`)` and the unicode `▸` at L113. On a Windows console without `chcp 65001` (and in some CI log collectors), these render as garbage. Not load-bearing.
**Fix:** Use ASCII (`...`, `>`) or detect `process.stdout.isTTY` and `process.env.LANG?.includes("UTF-8")` before using the unicode chars.

---

## Top recommendation

The cluster: **V2 sinks are not production-wired**. CR-01 (every sink stubs `tenantId: ""`), CR-02 (improvement-decide ignores `requiresHumanApproval`), CR-03 (manager-decide writes without tenantId), and WR-01 (reflexion sink returns hollow data) are all the same pattern — the V2 P3/P4/P6/P7/P8/P10 modules have clean pure-function cores with green unit tests, but the *bridge* from pure decision to DB row was written as TODO-stubs that ship in `lifecycle-sinks.ts` and `apps/api/src/index.ts` decide endpoints. The 21-suite gate passes because the tests use fakes; the production behavior is broken or unsafe.

**Suggested fix sequence** before publishing to 10 teammates:
1. Add a feature flag `AOS_V2_SINKS_ENABLED` defaulting to `0`. Have `lifecycle.ts` refuse to wire `lifecycle-sinks.ts` builders when the flag is off. This gives you back the standing gate without shipping the broken bridge.
2. Fix CR-02, CR-03 (single-line API changes) so the operator-facing UI is honest about what apply does.
3. Fix CR-04, CR-05 (defense-in-depth gaps that the next review will catch anyway — easier to fix now).
4. Land CR-01 as a follow-up sprint: thread `tenantId` through every sink, drop the empty-string stubs, add `length > 0` assertions. Until that lands, V2 stays gated.

Everything else (WR-02..WR-06, IN-01..IN-04) is real but bounded. Ship after the critical cluster lands.

---

_Reviewed: 2026-06-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
