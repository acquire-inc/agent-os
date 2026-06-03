---
phase: 00-aggregate-review-phases-11-25
reviewed: 2026-06-03T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - apps/api/src/index.ts
  - apps/runner/src/budget.test.ts
  - apps/runner/src/budget.ts
  - apps/runner/src/custom-tools.ts
  - apps/runner/src/execute.ts
  - apps/runner/src/hooks.ts
  - apps/runner/src/run-state.test.ts
  - apps/runner/src/run-state.ts
  - packages/core/src/architect/cra-blocklist.test.ts
  - packages/core/src/architect/cra-blocklist.ts
  - packages/core/src/architect/hydrate.immutability.test.ts
  - packages/core/src/architect/hydrate.ts
  - packages/core/src/architect/index.ts
  - packages/core/src/autonomy.ts
  - packages/core/src/budget/tracker.test.ts
  - packages/core/src/budget/tracker.ts
  - packages/core/src/eval/controller.test.ts
  - packages/core/src/eval/controller.ts
  - packages/core/src/eval/job.test.ts
  - packages/core/src/eval/job.ts
  - packages/core/src/eval/scorecard.test.ts
  - packages/core/src/eval/scorecard.ts
  - packages/core/src/index.ts
  - packages/core/src/lifecycle.ts
  - packages/core/src/relay/events.ts
  - packages/core/src/router/allowlist-parity.test.ts
  - packages/core/src/security/injection-guard.test.ts
  - packages/core/src/security/injection-guard.ts
  - packages/db/src/schema.ts
  - packages/inngest/src/functions/scoreAgentsScheduled.ts
  - packages/inngest/src/index.ts
  - supabase/migrations/0014_agent_scorecards.sql
  - external/acqu-skills/prompt-injection-guardrail/SKILL.md
  - external/acqu-skills/output-quality-gate/SKILL.md
  - external/acqu-skills/shadow-mode-discipline/SKILL.md
  - external/acqu-skills/cost-ceiling-discipline/SKILL.md
  - external/acqu-skills/scope-lock-discipline/SKILL.md
  - packages/core/package.json
  - apps/runner/package.json
findings:
  critical: 9
  warning: 14
  info: 6
  total: 29
status: issues_found
recommendation: DO NOT SHIP. Multiple correctness, doctrine-alignment, and tenant-isolation defects must be fixed before production. The most load-bearing failures are CR-01 (T-critical doctrine drift between CLAUDE.md and code), CR-02 (scorecard output-quality always-true predicate that corrupts every demote/promote decision), CR-03 (raw SQL UUID interpolation in scheduled scorecard fetcher), CR-04 (T-critical exempt-from-override bypass in apply-model-override endpoint), and CR-05 (setAutonomy split-query tenant gate). Each is independent and each blocks public launch.
---

# Phase 11-25 Aggregate Code Review

**Reviewed:** 2026-06-03
**Depth:** standard (per-file analysis with cross-file checks where signals warranted)
**Files Reviewed:** 39 (incl. 5 skill SKILL.md + 2 package manifests + 1 SQL migration)
**Status:** issues_found

## Summary

The 15-phase delta wires up a meaningful safety substrate — CRA blocklist, prompt-injection scrub, BudgetTracker reserve/commit, eval scorecard + controller + scheduled job, runner autonomy ratchet, Phase 25 dashboard endpoints. Tests exist for nearly every pure module and the test discipline is good. **However the system is not safe to ship.** I found:

- One doctrine-vs-code split in the T-critical can't-fail set (CR-01).
- A scorecard math bug that makes `outputQualityFailureRate` either degenerately 0 or degenerately equal to `failures / sampleSize` regardless of whether the skill ran (CR-02).
- A raw-SQL UUID-array interpolation in the scheduled scorecard fetcher (CR-03).
- A T-critical override bypass in the bulk model-override endpoint that directly violates the "Tier wins, override loses" non-negotiable (CR-04).
- A tenant-gate split-query race in `setAutonomy` (CR-05).
- A regex pattern in the injection guard that will fire on benign agent-onboarding language (WR-02) — public launch will see operator-noise complaints day one.
- A scrub-result depth-mismatch (WR-04) plus a sink-design gap where the runner singleton's BudgetTracker doesn't emit budget.* unless `capUsd > 0 && costUsd > 0` — a CRA/cantfail terminal run skips the entire reserve/commit/cap_breach emission stream (IN-06).
- The scheduled scorecard sink reports `r.findingCount` to a scoring field documented as "findings with severity >= medium" (WR-01) — silently overcounts findings, biases every agent toward `demote`.

The pattern across these is consistent: belt-and-suspenders implementations were added without re-reading the doctrine carefully. The CR-01 / CR-04 / WR-01 defects are all the same shape — code does X, doctrine asks for Y, no test catches the gap because the test was written from the code, not from the doctrine.

The `claude/exciting-davinci-yvptm` branch should NOT merge to `main` until at least CR-01..CR-09 are addressed.

## Critical Issues

### CR-01: CANT_FAIL_KEYS in code disagrees with CLAUDE.md doctrine

**File:** `packages/core/src/architect/hydrate.ts:22-38` and `packages/core/src/architect/hydrate.immutability.test.ts:29-44`
**Issue:** CLAUDE.md lists 14 can't-fail agents and explicitly includes `cliently.dev`. The code (`CANT_FAIL_KEYS` in hydrate.ts) replaces `cliently.dev` with `secrets-rotation`. The immutability test pins the code's list, not the doctrine's. This is a silent doctrine drift — every other reviewer who reads CLAUDE.md will believe `cliently.dev` is can't-fail; the runtime gate, the scorecard's `isCantFail()`, the controller's promote-cap, and the architect's refusal path all use the code's set. Either:
  - CLAUDE.md is the source of truth → the code is wrong and `cliently.dev` must be added to `CANT_FAIL_KEYS` (and re-verified that `isCantFail("cliently.dev")` returns true at runtime); OR
  - The code is the source of truth → CLAUDE.md must be updated to add `secrets-rotation` and drop `cliently.dev`.

The test at line 87 explicitly asserts `isCantFail("cliently.dev") === false`, which makes the drift load-bearing. This is exactly the "doctrine and code disagree silently" failure mode CLAUDE.md non-negotiable #1 is meant to prevent. Pick one source of truth and reconcile.

**Fix:** Reconcile in a single PR. Recommended (since the change is doctrine-level): add `cliently.dev` back to `CANT_FAIL_KEYS`, remove the negative assertion in the test, and confirm with the operator whether `secrets-rotation` should stay (it's not in CLAUDE.md's list either).

```ts
// hydrate.ts
const CANT_FAIL_KEYS = new Set([
  "ad-claim-compliance",
  "tenant-isolation-tester",
  "security-anomaly-watchdog",
  "access-auditor",
  "contract-drafter",
  "contract-lifecycle-manager",
  "pricing-architect",
  "discount-governor",
  "decision-memo-drafter",
  "offer-architect",
  "offer-validator",
  "reinvestment-advisor",
  "risk-register-keeper",
  "cliently.dev", // per CLAUDE.md
  // "secrets-rotation" — confirm with operator before adding/removing
]);
```

### CR-02: `outputQualityFailureRate` math is broken — predicate is always true

**File:** `packages/core/src/eval/scorecard.ts:147-156`
**Issue:** The block

```ts
if (r.outputQualityFailed || !r.outputQualityFailed) {
  if (r.outputQualityFailed) outputQualityFailures++;
  outputQualityApplications++;
}
```

`r.outputQualityFailed || !r.outputQualityFailed` is **always true** for any boolean. `outputQualityApplications` therefore equals `sampleSize` for every scorecard call. The result: `outputQualityFailureRate = failures / sampleSize`, NOT `failures / applications`. Agents that never had the output-quality-gate skill attached (the vast majority — only 4 agents per the skill description) are still measured by it. The threshold trips and the agent gets demoted on a metric that never applied to it.

The comment acknowledges the ambiguity ("we can't tell from this typed shape if the skill ran") but then proceeds anyway with a tautological guard. The math is wrong; the comment is camouflage.

**Fix:** Add an `outputQualityApplied: boolean` field to `RunSample` and gate the increment correctly. Update `scoreAgentsScheduled.ts:122` to derive `outputQualityApplied` from `highlights.output_quality !== undefined`.

```ts
// scorecard.ts RunSample shape
outputQualityApplied: boolean; // true iff the skill ran on this run
outputQualityFailed: boolean;  // true iff applied AND failed

// scoring loop
if (r.outputQualityApplied) {
  outputQualityApplications++;
  if (r.outputQualityFailed) outputQualityFailures++;
}

// scoreAgentsScheduled.ts:122
outputQualityFailed: outputQuality.passed === false,
outputQualityApplied: h.output_quality !== undefined,
```

Audit every existing scorecard row produced in the live system before this fix; the `demote` and `hold` verdicts based on this metric are corrupt.

### CR-03: Raw SQL UUID interpolation in scheduled scorecard fetcher

**File:** `packages/inngest/src/functions/scoreAgentsScheduled.ts:80`
**Issue:**

```ts
sql`${relayEvents.runId} = ANY(${sql.raw(`ARRAY[${runIds.map((id) => `'${id}'::uuid`).join(",")}]`)})`,
```

`runIds` is sourced from `runSummaries.runId` (DB-trusted) on the same query immediately above, so the immediate exploit surface is limited — but this is exactly the pattern that goes wrong six months later when someone refactors `runIds` to come from a different (untrusted) source. Drizzle has parameterized array helpers (`inArray()` or `sql\`= ANY(${array})\`` with a typed array binding) — using `sql.raw` with manually-quoted UUID literals defeats the entire prepared-statement layer.

Also: if a `runIds` element ever contains an apostrophe (it won't, given UUID format, but defense in depth) the SQL parses incorrectly and fails closed (best case) or executes injected SQL (worst case).

**Fix:** Use Drizzle's parameterized `inArray`:

```ts
import { inArray } from "drizzle-orm";

const cfRows = await db
  .select({ runId: relayEvents.runId, cnt: count().as("cnt") })
  .from(relayEvents)
  .where(
    and(
      eq(relayEvents.tenantId, input.tenantId),
      sql`${relayEvents.eventName} LIKE 'cantfail.%'`,
      inArray(relayEvents.runId, runIds),
    ),
  )
  .groupBy(relayEvents.runId);
```

### CR-04: `apply-model-override` rewrites T-critical agents — violates CLAUDE.md non-negotiable

**File:** `apps/api/src/index.ts:569-584`
**Issue:** The endpoint `POST /api/admin/tenants/me/apply-model-override` does:

```ts
const updated = await db
  .update(schema.agents)
  .set({ model: tenant.defaultModelOverride })
  .where(eq(schema.agents.tenantId, tenantId))
  .returning(...);
```

This bulk-rewrites EVERY agent in the tenant — including T-critical can't-fail agents — to the tenant's default model override. CLAUDE.md says explicitly: "Tier wins, override loses. T-critical agents always run Opus and are EXEMPT from `tenants.default_model_override` (Phase 8.5). The seed function skips the override when `isCantFail(spec.key)` is true." This endpoint is the apply-after-seed bulk rewriter; it MUST honor the same exemption.

The runtime gate `assertCantFailModel` in `execute.ts:69-101` will catch this at the run boundary — every T-critical agent will fail-closed on dispatch with `cantfail.model_violation`. But that means every T-critical agent is now non-functional until someone manually re-runs the seed. Worse, the fail-closed message implies the seed script is buggy, not that the operator triggered the breakage.

**Fix:** Filter T-critical agents out of the UPDATE by key. The architect already exports `isCantFail`; load the list inline or NOT (eq(key, ANY(cant_fail_keys))).

```ts
import { isCantFail } from "@agent-os/core";
// or import the constant directly
const CANT_FAIL_KEYS = [...]; // mirror from hydrate.ts (or export constant)

const allAgents = await db.select({ id, key }).from(schema.agents).where(eq(tenantId));
const overridable = allAgents.filter((a) => !isCantFail(a.key));
const overridableIds = overridable.map((a) => a.id);
const updated = await db
  .update(schema.agents)
  .set({ model: tenant.defaultModelOverride })
  .where(and(eq(schema.agents.tenantId, tenantId), inArray(schema.agents.id, overridableIds)))
  .returning(...);
```

Also emit a `model.routed` event for each rewrite and a separate audit log line listing which T-critical agents were skipped, so the operator sees them.

### CR-05: `setAutonomy` performs split-query tenant gate (races + reads twice)

**File:** `packages/core/src/lifecycle.ts:384-402`
**Issue:**

```ts
const [current] = await tx.select({...}).from(schema.agents).where(eq(schema.agents.id, args.agentId));
if (!current) return null;
const [tenantCheck] = await tx.select({ tenantId: ... }).from(schema.agents).where(eq(schema.agents.id, args.agentId));
if (!tenantCheck || tenantCheck.tenantId !== args.tenantId) return null;
```

This is two separate SELECTs on the same row, then a check, then an UPDATE. Even inside a transaction, this is a SELECT-then-SELECT-then-UPDATE pattern that is sloppy at best — and the `current` row's autonomy is read BEFORE the tenant check is verified, meaning if `args.agentId` belongs to another tenant, you've still spent a query reading its data into the application layer (information leakage, however small).

There is no reason to issue two SELECTs. The tenant gate should be in the same WHERE clause as the autonomy read, AND in the WHERE clause of the UPDATE.

**Fix:**

```ts
const [current] = await tx
  .select({ id: agents.id, key: agents.key, autonomy: agents.autonomy })
  .from(agents)
  .where(and(eq(agents.id, args.agentId), eq(agents.tenantId, args.tenantId)));
if (!current) return null;

if (current.autonomy === args.nextAutonomy) return current;

const [updated] = await tx
  .update(agents)
  .set({ autonomy: args.nextAutonomy })
  .where(and(eq(agents.id, args.agentId), eq(agents.tenantId, args.tenantId)))
  .returning({...});
```

### CR-06: Default `model` in admin agent creation is wrong slug

**File:** `apps/api/src/index.ts:358`
**Issue:** `model: b.model ?? "claude-sonnet-4-6"` — note the hyphen-only `claude-sonnet-4-6`. CLAUDE.md and the runner's T-work tier resolution use `anthropic/claude-sonnet-4.6` (note: namespace prefix + dot). Schema default on `agents.model` is also `"claude-sonnet-4-6"` (schema.ts:88). The runner allowlist for T-critical is `"anthropic/claude-opus-4.8"` — namespaced. An agent created via this endpoint with no explicit `model` will get the unnamespaced default; the OpenRouter gateway will reject it. Silent breakage; only caught when the agent first dispatches.

**Fix:** Update both the schema default and the endpoint default to the canonical namespaced slug:

```ts
// schema.ts
model: text("model").notNull().default("anthropic/claude-sonnet-4.6"),

// apps/api/src/index.ts:358
model: b.model ?? "anthropic/claude-sonnet-4.6",
```

Add a CI test that asserts every default model slug parses against the router's slug regex.

### CR-07: Inngest webhook mounted before auth — depends on signing key env var being set

**File:** `apps/api/src/index.ts:95-99`
**Issue:** The Inngest serve handler is mounted at `/api/inngest` BEFORE the `/api/*` API-key middleware. The auth middleware explicitly skips the path:

```ts
if (c.req.path === "/api/guide" || c.req.path === "/api/admin-guide" || c.req.path === "/api/inngest") return next();
```

This is correct IFF Inngest's `serve()` rejects requests lacking a valid `INNGEST_SIGNING_KEY` signature. There is no `assert(process.env.INNGEST_SIGNING_KEY)` guard at API startup; if the env var is unset in production, the Inngest serve handler accepts arbitrary anonymous POST requests at `/api/inngest`, which can trigger every Inngest function (including `scoreAgentsScheduled` with operator-controlled `{ agentId, tenantId }` payloads that cross tenants).

**Fix:** Hard-fail at startup if `INNGEST_SIGNING_KEY` is unset OR if you intentionally support dev mode, make the dev-mode branch refuse to mount `/api/inngest` and log loudly.

```ts
const INNGEST_SIGNING_KEY = process.env.INNGEST_SIGNING_KEY;
if (!INNGEST_SIGNING_KEY && process.env.NODE_ENV === "production") {
  throw new Error("INNGEST_SIGNING_KEY is required in production");
}
```

Also add an integration test that issues an unsigned POST to `/api/inngest` and asserts 401/403.

### CR-08: `clearRunState` and `tracker.closeRun` are not in a finally — exceptions leak run state

**File:** `apps/runner/src/execute.ts:310-436`
**Issue:** `executeRun` opens the budget tracker at line 313, executes the run inside a try/catch at lines 342-364, then performs the budget synthesize (370-419), `tracker.closeRun` (420), and `clearRunState` (433) OUTSIDE the try/catch. If `tracker.reserveSpend`/`commitSpend`/`emitBudget`/`raiseCapBreachApproval` ever throws (e.g. an unexpected NaN in the cost path, a DB connectivity blip during `raiseCapBreachApproval`), the function exits without closing the tracker run OR clearing the autonomy ratchet — and the singleton tracker/ratchet leaks memory for the lifetime of the process.

`raiseCapBreachApproval` at line 403 is wrapped in try/catch — good — but the surrounding emit-budget chain is not.

**Fix:** Move `tracker.closeRun(...)` and `clearRunState(...)` into a `finally` block. The budget synthesize can stay outside; the close/clear are the cleanup.

```ts
let result: RunResult;
try {
  // ... existing try/catch for the actual run
  // ... existing synthesize block
} finally {
  // Always close, always clear, even on unexpected throws.
  try {
    const summary = tracker.closeRun(bundle.run.id, { final_status: result?.status ?? "failed" });
    if (summary) {
      await emitBudget("budget.summary", { ...summary metadata }).catch(() => {});
    }
  } finally {
    clearRunState(bundle.run.id);
  }
}
return result;
```

### CR-09: Inngest scheduled job has no per-agent error isolation — one bad row halts the sweep

**File:** `packages/inngest/src/functions/scoreAgentsScheduled.ts:235-256`
**Issue:** The for-loop:

```ts
for (const t of targets) {
  const res = await step.run(`score-${t.id}`, async () => {
    return await runScorecardJob(...);
  });
  scored++;
  results.push({...});
}
```

If `runScorecardJob` throws (e.g. CR-03's raw-SQL pattern blows up on a runId with unexpected content, or the cost column has a numeric overflow), the entire scheduled function fails. Inngest will retry the function — and retry the entire sweep — so a single permanently-bad agent row causes every other agent in the tenant to be re-scored on every retry attempt. Eventually Inngest exhausts retries and silently stops scoring everyone.

**Fix:** Wrap each `step.run` in a try/catch; record failures into a `failed[]` array and emit them in the return value. The per-step Inngest retry is then bounded to a single agent.

```ts
for (const t of targets) {
  try {
    const res = await step.run(`score-${t.id}`, async () => runScorecardJob(...));
    scored++;
    results.push({...});
  } catch (e) {
    failed.push({ agentKey: t.key, error: (e as Error).message });
    console.error(`[scoreAgents] failed to score ${t.key}: ${(e as Error).message}`);
  }
}
return { scored, failed_count: failed.length, results, failed };
```

## Warnings

### WR-01: Scheduled sink reports total `findingCount` to a field documented as "findings with severity >= medium"

**File:** `packages/inngest/src/functions/scoreAgentsScheduled.ts:119` vs. `packages/core/src/eval/scorecard.ts:34`
**Issue:** `RunSample.findingsHighMed` is documented as "Number of finding.recorded events for this run with severity >= medium." The sink populates it from `runSummaries.findingCount` (total count, all severities). Agents with chatty low-severity findings get over-counted and demoted. The `maxFindingsRatePerRun = 0.1` threshold is calibrated to medium+; against a total count it's far too tight.

**Fix:** Either query `securityFindings` filtered to severity `IN ('medium','high','critical')` for each runId, or add a separate `findingCount` aggregate at run close that excludes low. Recommended: query the relay_events table for `finding.recorded` events with `payload->>'severity' IN ('medium','high','critical')`.

### WR-02: Injection guard pattern matches benign agent-onboarding text

**File:** `packages/core/src/security/injection-guard.ts:51`
**Issue:** Pattern `/\byou\s+are\s+now\s+a?\s*[a-z\s]{0,40}\b(assistant|agent|model)?\b/gi` makes the `(assistant|agent|model)` group optional with `?`, so it matches `"You are now a customer support specialist"`, `"You are now a member"`, `"You are now able to..."` etc. The `[a-z\s]{0,40}` is greedy and the optional final group means the regex anchors against essentially any English sentence starting with "you are now ...". Every customer-confirmation email scraped by `tool.browser` will trip this and ratchet the run to `propose`.

**Fix:** Tighten the pattern so the role-name group is REQUIRED, not optional:

```ts
{ pattern: /\byou\s+are\s+now\s+a?\s*([a-z\s]{0,40})\s+(assistant|agent|model|admin|developer|system)\b/gi, category: "direct_override" },
```

### WR-03: Injection guard zero-width pattern fires on legitimate non-ASCII content

**File:** `packages/core/src/security/injection-guard.ts:62`
**Issue:** The character class `[​-‏‪-‮⁠-⁤﻿]` includes BOM (`﻿`), RTL/LTR marks, and various joiners. Many legitimate text sources (Arabic/Hebrew content, Windows-exported Excel snippets, emoji sequences with ZWJ) include these characters with no malicious intent. Every match emits a `finding.recorded` (severity high) and ratchets autonomy to `propose`. Operator gets a finding firehose.

**Fix:** Either:
1. Lower the severity to `medium` AND skip the autonomy ratchet for `steganographic` category specifically (the marker stays for audit), OR
2. Narrow the pattern to known abuse patterns (e.g. zero-width characters interleaved with directive verbs).

### WR-04: `scrubToolResult` only scrubs top-level string fields — nested content passes through

**File:** `packages/core/src/security/injection-guard.ts:164-184`
**Issue:** The function explicitly notes "For nested results, only top-level string fields are scrubbed (deeper structures are out of scope)." But `runBrowserTool` returns a `BrowserToolResult` whose actual shape likely contains nested `pages[].body`, `chunks[]`, or similar — none of which will be scrubbed. The runtime guard is a paper tiger for the canonical use case it advertises.

**Fix:** Make `scrubToolResult` recursive over Arrays + Objects. Cap recursion depth (say 6) and short-circuit non-string leaves.

```ts
function deepScrub(node: unknown, all: InjectionMatch[], depth = 0): unknown {
  if (depth > 6) return node;
  if (typeof node === "string") {
    const { scrubbed, detections } = scrubInjections(node);
    all.push(...detections);
    return scrubbed;
  }
  if (Array.isArray(node)) return node.map((n) => deepScrub(n, all, depth + 1));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = deepScrub(v, all, depth + 1);
    return out;
  }
  return node;
}
```

### WR-05: CRA blocklist uses substring `.includes()` — no word boundary protection

**File:** `packages/core/src/architect/cra-blocklist.ts:141-151`
**Issue:** `lower.includes(keyword.toLowerCase())` is plain substring match. Keywords like `"credit eligibility"` will match inside `"noncredit eligibility-bypass"`, `"discredit eligibility-checks-as-a-service"`, or any other concatenated form. The hydrate test (Group 7, `"Credit the customer's deposit..."`) passes only because the keyword list happens to use "credit eligibility" (two words) not "credit" — but the moment a single-word keyword is added (e.g. someone fixes the SNAP keyword bank), the floodgates open.

The doctrine intent is whole-phrase match; the implementation is substring. Either:
1. Use `\b<keyword>\b` regex with case-insensitive flag, OR
2. Document explicitly that the keyword bank may only contain multi-word phrases that themselves contain unambiguous trigger words (current state, fragile).

**Fix:** Promote to regex match:

```ts
const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
if (re.test(text)) return { prohibited: true, category, matchedKeyword: keyword };
```

### WR-06: `BudgetTracker.openRun` silently returns existing state on key collision

**File:** `packages/core/src/budget/tracker.ts:79-94`
**Issue:**

```ts
openRun(runId: string, capUsd: number): RunBudgetState {
  const existing = this.runs.get(runId);
  if (existing) return existing;
  ...
}
```

If a runId collision happens (extremely unlikely with UUIDs, but possible with a test fixture, a misconfigured runner that reuses session ids, or a Phase-22 ratchet that runs on a stale runId), the prior run's reservations and committed totals contaminate the new run silently. The function returns the OLD state with the OLD capUsd, ignoring the new cap argument.

**Fix:** Treat key collision as an error. The caller (`executeRun`) opens a fresh run; there is no legitimate reuse path.

```ts
openRun(runId: string, capUsd: number): RunBudgetState {
  if (this.runs.has(runId)) {
    throw new Error(`BudgetTracker.openRun: run ${runId} already open — would leak prior state`);
  }
  // ...
}
```

### WR-07: Hardcoded promote-bar threshold not in `DEFAULT_THRESHOLDS`

**File:** `packages/core/src/eval/scorecard.ts:243-245`
**Issue:** `verificationClear = verificationRate >= 0.95` and `costClear = avgCostUtilization < thresholds.maxCostUtilization * 0.9`. The `0.95` is a hardcoded magic number; the `* 0.9` is a hardcoded multiplier. Both should live in `ScorecardThresholds` so operators can tune them without code changes. The CLAUDE.md non-negotiable #1 says promotion is earned from metrics — the metrics' bar must be a config knob.

**Fix:** Add `minVerificationRateForPromote` and `promoteCostUtilizationCeiling` (or `costUtilizationPromoteRatio`) to `ScorecardThresholds`; thread through.

### WR-08: Parity test detects drift via regex against runner source — brittle

**File:** `packages/core/src/router/allowlist-parity.test.ts:39-41`
**Issue:** The test reads `apps/runner/src/execute.ts` as a string and matches `T_CRITICAL_MODEL_ALLOWLIST\s*=\s*new\s+Set\(\s*\[([^\]]+)\]`. If the runner code is reformatted to use a multi-line `new Set([\n  "x",\n  "y",\n])`, the `[^\]]+` capture works; but if the constant is renamed, declared with `as const`, or initialized via spread, the regex misses entirely. The test then constructs an EMPTY runner set, compares to the router's non-empty set, and fails — which surfaces the drift. So the failure mode is fail-loud, which is good. However, a more subtle drift (e.g. someone changes the source to `new Set(["anthropic/claude-opus-4.8" as const])` — still parses with the regex but adds a typecast) could pass quietly.

**Fix:** Better — export `T_CRITICAL_MODEL_ALLOWLIST` from the runner module and import it into the test. Move the constant to a shared module both packages can import.

### WR-09: Run-state ratchet has no upper bound on `ratchetReasons.length`

**File:** `apps/runner/src/run-state.ts:40-57`
**Issue:** A pathological run that triggers a ratchet on every PreToolUse (e.g. a tool.browser loop that keeps fetching injection content) will accumulate unbounded `ratchetReasons[]`. The ratchet itself is idempotent (won't move autonomy past `propose`), but the reason list grows without limit. With max-turns at 12, the immediate risk is small, but if max-turns is ever raised or a Phase-22 caller triggers a ratchet from inside a tight loop, the memory grows linearly with detections.

**Fix:** Cap `ratchetReasons` at, say, 20 entries; on overflow, increment a counter instead of pushing.

### WR-10: `lifecycle.ts:404` returns the pre-update row when current autonomy already equals target — caller may misinterpret as "applied"

**File:** `packages/core/src/lifecycle.ts:404-408`
**Issue:** When `current.autonomy === args.nextAutonomy`, `setAutonomy` returns `current` (the pre-update row) as a "no-op success." Callers like `scoreAgentsScheduled.ts:162` read `result?.autonomy` and treat it as the post-mutation autonomy. That's accidentally correct in this case because no mutation happened, but the semantics are muddy: the function's contract is "update + emit"; here it does neither and signals success. A reader sees `result` is non-null and assumes the mutation happened (and the `lifecycle.changed` event was emitted, which it wasn't).

**Fix:** Either (a) document the no-op path and add a `noOp: true` flag to the return, or (b) make the caller in `runScorecardJob.applyAutonomy` only invoke setAutonomy when the controller already returns `changed=true` (which it does at job.ts:116) — so this defensive branch never fires from production callers. Then remove the defensive return and just always emit + always update.

### WR-11: `executeRun` doesn't emit `budget.cap_breached` Relay event when initial cap=0

**File:** `apps/runner/src/execute.ts:370-419`
**Issue:** The synthesize block is gated by `if (capUsd > 0 && result.costUsd > 0)`. A run with `budgetCapUsd === 0` (which means "no cap" by current convention) silently skips both the synthesize AND any cap-breach emission. The skill `cost-ceiling-discipline` says T-critical agents are exempt from this skill, but T-critical agents may still have `budgetCapUsd` set (or unset). The cap-breach signal is silently lost for any agent with `budgetCapUsd === 0` even if `costUsd` blows past whatever the operator's expectation is. This is observational degradation, not a correctness bug — but it makes the audit trail incomplete for the exact agents (T-critical) where audit matters most.

**Fix:** Always emit `budget.summary` regardless of `capUsd`. Reserve the reserve/commit path for `capUsd > 0`. Document that `capUsd === 0` means "unenforced" not "untracked."

### WR-12: `scrubToolResult` finding emit includes `first_span_preview` of redacted content

**File:** `apps/runner/src/custom-tools.ts:135-136`
**Issue:** `first_span_preview: catDetections[0]!.matchedSpan.slice(0, 100)` includes a 100-char window of the original injection content in the finding payload. For most categories this is fine (the actual attack span — useful for triage). For `steganographic` matches, the raw matched span may include sensitive characters or carry hidden text whose decoded form is malicious. The payload is persisted to `security_findings` and surfaces in the operator UI. A determined attacker could craft a payload whose first-100 chars exfiltrate into operator-visible logs.

**Fix:** Either hash the span and store the hash + length + category, OR base64-encode the span so the operator must explicitly decode it before viewing.

```ts
first_span_preview_b64: Buffer.from(catDetections[0]!.matchedSpan.slice(0, 100)).toString("base64"),
```

### WR-13: Migration 0014 stores `verificationRate` as NUMERIC(5,4) — Drizzle insert converts via `.toString()` which loses precision

**File:** `packages/inngest/src/functions/scoreAgentsScheduled.ts:139-145` and `supabase/migrations/0014_agent_scorecards.sql:21`
**Issue:** `verificationRate: sc.verificationRate?.toString() ?? null` — for a rate like `1/3 = 0.3333333333333333`, `toString()` produces `"0.3333333333333333"` (16 sig figs). `NUMERIC(5,4)` can store at most 4 fractional digits, so Postgres rounds to `0.3333`. Not catastrophic, but the persisted rate doesn't match what the controller decided on. If a follow-up query reads the persisted rate back and re-decides, it could oscillate around the threshold.

**Fix:** Either widen the column to NUMERIC(7,6) or pre-round in JS before insert.

### WR-14: Migration 0014 RLS uses `is_tenant_member(tenant_id)` — not defined in this migration

**File:** `supabase/migrations/0014_agent_scorecards.sql:50-53`
**Issue:** The `tenant_isolation` policy invokes `is_tenant_member(tenant_id)` — a function presumably defined in an earlier migration. There's no `IF EXISTS` check on the function, no comment pointing at the migration that defines it. If migration 0014 is applied to a fresh DB without that prior migration, the policy fails to apply (or creates a policy that silently rejects everything because the function is missing). A reviewer can't tell from this migration alone whether the dependency is correctly ordered.

**Fix:** Add a comment naming the migration that defines `is_tenant_member`. Optionally add a `DO $$ BEGIN ... EXCEPTION ... END $$` block that asserts the function exists before creating the policy.

## Info

### IN-01: Mixed swallow-vs-log pattern for best-effort emit

**File:** `apps/api/src/index.ts:163`, `apps/runner/src/execute.ts:99`, `apps/runner/src/execute.ts:362`
**Issue:** Across the codebase, "best-effort" failures are handled inconsistently. Some use `.catch((e) => console.error(...))` (good — log + don't throw). Others use `.catch(() => {})` (silently swallow). The doctrine in the code comments says "never swallow silently" but multiple call sites silently swallow. Audit and align.

### IN-02: `architect/index.ts` re-exports `isCantFail` from hydrate.ts in addition to hydrate.ts's own export

**File:** `packages/core/src/architect/index.ts:23` and `packages/core/src/architect/hydrate.ts:158`
**Issue:** Two export paths reach the same symbol. TypeScript happily resolves both. Consider canonicalizing the export site (the architect index).

### IN-03: Scheduled scorecard uses 30-day window unconditionally

**File:** `packages/inngest/src/functions/scoreAgentsScheduled.ts:229-230`
**Issue:** `windowStart = windowEnd - 30 days` is hardcoded. The SKILL `cost-ceiling-discipline` and others mention per-agent tuning; the scorecard's window should be configurable per-agent (and the agent-onboarder skill mentions a tighter cycle).

### IN-04: `executeRun` reads `relayDb()` lazily in every emit — small redundancy

**File:** `apps/runner/src/execute.ts:317-339`
**Issue:** `emitBudget` calls `relayDb()` per invocation. The function memoizes, so the cost is one Map lookup per call — fine but worth noting if a future BudgetTracker increases emission cadence.

### IN-05: `scoreAgentsScheduled` 6h cron + 30d window means each scorecard re-scores 95%+ of the prior window — high redundant cost

**File:** `packages/inngest/src/functions/scoreAgentsScheduled.ts:188-193`
**Issue:** Each cron tick re-scores the same 30-day window 4× per day. Over a month that's 120 scorecard rows per agent per month, each scoring 100 runs. For a tenant with 50 active agents that's 6000 scorecard rows/month, and `120 * 100 * 50 = 600k` row fetches/month per tenant. Consider widening the cron to daily and using sliding-window incremental scoring.

### IN-06: `tracker.closeRun` fires `budget.summary` even when the run never tracked spend — clutters the event stream

**File:** `apps/runner/src/execute.ts:420-430`
**Issue:** Cantfail and CRA-violation paths produce `costUsd === 0` runs that still call `tracker.openRun` + `tracker.closeRun`. The `budget.summary` event lands with all-zero totals. Acceptable observability, but the downstream analytics view `agent_scorecards_xtenant_agg` and any per-tenant cost dashboard will see zero-budget rows mixed with real-cost rows. Consider tagging the summary with `final_status` (already there) and filtering empties in the dashboard.

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
