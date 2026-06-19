---
phase: 69
reviewed: 2026-06-19T00:00:00Z
branch: claude/exciting-davinci-yvptm
head: 5a6f4cc
scope: full publish surface (V1 + V2 + I-001/2/3 + P3/P4)
depth: deep
files_reviewed: 19
files_reviewed_list:
  - supabase/migrations/0032_lead_pipeline.sql
  - packages/db/src/schema.ts
  - packages/core/src/lead-pipeline.ts
  - packages/core/src/lead-pipeline.test.ts
  - apps/runner/src/lead-pipeline-tools.ts
  - apps/runner/src/custom-tools.ts
  - scripts/seed/acqu-discovery-agent.ts
  - scripts/seed/acqu-enrichment-scoring.ts
  - scripts/setup/setup.ts
  - packages/core/src/lifecycle-sinks.ts
  - packages/core/src/lead-pipeline.ts
  - packages/core/src/architect/cra-blocklist.ts
  - apps/api/src/index.ts
  - apps/control-plane/src/lib/data.ts
  - packages/core/src/lifecycle.ts
  - packages/core/src/lease.ts
  - packages/core/src/relay/events.ts
  - .env.example
  - .planning/phases/68-publish-readiness-review/68-REVIEW.md
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
status: issues_found
---

# Phase 69: Final Launch Review

Phase 68's five criticals all landed clean (verified inline: lifecycle-sinks
`assertTenant` tripwire at L50; CR-02 `x-confirm-cantfail` header at index.ts:1506;
CR-03 tenant-scoped agents update at L1631; CR-04 `runActivity(runId, tenantId)`
at data.ts:464; CR-05 `secretQuestion` muter at setup.ts:28). This sweep focuses
on the P3/P4 lead pipeline that just landed plus any surface the 68-pass left
behind. Three new criticals — all in the lead pipeline.

## Critical Issues

### CR-01: `apifyRunActor` never enforces target_type — the discovery-agent prompt promises a refusal that doesn't exist

**File:** `apps/runner/src/lead-pipeline-tools.ts:78-131` (handler) and
`scripts/seed/acqu-discovery-agent.ts:43` (the prompt promise)
**Issue:** The handler looks up `matrixActor` only to *clamp `max_items`* — it
never compares the matrix actor's `targets[]` to the active ICP's `target_type`.
The discovery agent's system prompt at L43 says "The tool will reject mismatched
runs," but the handler has no access to the ICP and no refusal path. A Hermes
70B agent (the model running this) one bad instruction-follow away from
dispatching `apify:crunchbase-funded` (tech_funded ONLY, per the matrix at
lead-pipeline.ts:108-114) for a `local_smb` ICP — the handler will forward
the request to Apify, the operator pays for an actor run that produces useless
results, and lead_events records `discovered` payloads tagged with the wrong
source_actor key. The doctrine constraint at lead-pipeline.ts:12 ("target_type
wins: a tech_funded-only actor MUST NOT run for local_smb") is enforced ONLY
in the pure `selectDiscoveryActors()` helper that runs at seed time — never at
dispatch.
**Fix:** Thread the ICP context into the handler. Either (a) require the agent
to pass `target_type` in input and refuse on mismatch:
```ts
const { actor_id, input: actorInput, max_items, target_type } = input as {...};
if (!target_type) return envErr("target_type required for matrix-clamp refusal");
const matrixActor = DISCOVERY_ACTORS.find(...);
if (matrixActor && !matrixActor.targets.includes(target_type as TargetType)) {
  return envErr(`actor ${actor_id} not registered for target_type=${target_type} (registered: ${matrixActor.targets.join(",")})`);
}
```
or (b) load the active ICP server-side once per call:
`const [icp] = await db.select({targetType: schema.icps.targetType}).from(schema.icps).where(and(eq(schema.icps.tenantId, ctx.tenantId), eq(schema.icps.active, true))).limit(1);`
then refuse. Option (b) is the safer default because the agent can't lie about
target_type to bypass the gate.

### CR-02: P4 enrichment + scoring has no write-back path — `leads.icp_score` / `leads.qualified` / `leads.enrichment` stay NULL forever

**File:** `apps/runner/src/lead-pipeline-tools.ts:585-597` (registry) and
`scripts/seed/acqu-enrichment-scoring.ts:43-75` (prompt admitting the gap)
**Issue:** The 11 registered handlers cover query (4 tables), insert (status='new'
only), event-log, plus the enrichment HTTP wrappers (serper/jina/firecrawl/
email_verify/phone_validate/dnc_scrub). There is NO `tool.lead.update_lead`
handler and no SQL path that touches `leads.enrichment`, `leads.icp_score`,
`leads.qualified`, `leads.email_status`, `leads.phone_type`, `leads.dnc_flag`,
`leads.enriched_at`, or `leads.scored_at`. The enrichment-scoring prompt itself
admits this at L43 ("a follow-up endpoint will sync it into leads.enrichment
server-side until a dedicated update tool ships") — but no such endpoint exists
in `apps/api/src/index.ts` either. Result: every enrichment run logs `enriched`
+ `scored` events into `lead_events.payload`, but the `leads` row itself never
changes. The index `leads_tenant_qualified_idx WHERE qualified=true` (migration
0032 L96-97) will never have rows. Outreach (when it lands) can't query for
qualified=true. `applyQualificationRules` does the right computation; its
decision is dropped on the floor. The P4 acceptance test in the prompt
("Every lead has icp_score set") is unsatisfiable.
**Fix:** Ship one of the two missing surfaces before P3/P4 launches:
1. **Preferred — `tool.lead.update_lead` handler**: tenant-scoped UPDATE on
   `leads` by id, accepts `{lead_id, enrichment?, icp_score?, qualified?,
   email_status?, phone_type?, dnc_flag?, enriched_at?, scored_at?}`. Stamps
   `enriched_at = now()` when `enrichment` is set; `scored_at = now()` when
   `icp_score` is set. Defense-in-depth tenant ownership check (mirror
   `supabase_log_event` L339-344). Status transition rules: `new` → `enriching`
   on first enrichment write; `enriching` → `qualified` / `disqualified` on
   scoring write. Reject status writes from the agent — derive server-side.
2. **Alternative — server-side digest of `lead_events`**: after the agent logs
   `scored`, an API endpoint (`POST /api/admin/leads/digest-events`) reads
   recent unprocessed events and synthesizes the lead row update. Cleaner audit
   but adds latency.
Until one of these ships, P4 is non-functional in production. Recommend gating
discovery-agent's cron behind a `LEAD_PIPELINE_P4_READY` env flag so P3
(insert+event log only) can run alone if you publish before this lands.

### CR-03: `supabase_insert_lead` does not validate `icp_id` ownership — cross-tenant FK pointer accepted

**File:** `apps/runner/src/lead-pipeline-tools.ts:302`
**Issue:** `icpId: typeof row.icp_id === "string" ? row.icp_id : null` — the
agent-supplied `icp_id` is written to the `leads` row with NO check that the
referenced ICP belongs to the calling tenant. The schema FK constraint at
`leads.icp_id REFERENCES icps(id) ON DELETE SET NULL` only enforces that some
ICP exists, not that it's *this tenant's* ICP. RLS on `leads` only verifies
`leads.tenant_id IN (tenant_members)`, not the icp_id relationship. So a buggy
or compromised agent could insert a lead pointing at tenant B's `icps.id`. The
multi-tenant invariant in CLAUDE.md "every table carries tenant_id" is preserved
on the lead itself, but the *relational* invariant ("every FK points within the
tenant") is not — making cross-tenant joins through `leads.icp_id` possible.
Phase 68 caught 4 similar patterns; this is the fifth shaped the same way.
**Fix:** Before insert, when `icp_id` is provided, validate ownership:
```ts
if (typeof row.icp_id === "string") {
  const [icp] = await db.select({ id: schema.icps.id })
    .from(schema.icps)
    .where(and(eq(schema.icps.id, row.icp_id), eq(schema.icps.tenantId, ctx.tenantId)))
    .limit(1);
  if (!icp) return envErr("icp_id not visible to this tenant — refusing insert");
}
```
The same shape should appear in the `lead_events` insert path if the agent ever
provides an externally-resolved `lead_id` (the existing L339 check covers that
case correctly — use it as the template).

## Warnings

### WR-01: `supabase_insert_lead` suppression check + insert is not transactional — race window

**File:** `apps/runner/src/lead-pipeline-tools.ts:285-318`
**Issue:** `runScopedQuery` reads `suppression_list` (L285-292), then runs an
INSERT with `ON CONFLICT DO NOTHING` on the dedupe key (L298-318) — across two
separate round-trips with no transaction. If an operator adds a DNC entry
between the two queries (e.g. unsubscribe webhook fires concurrently), the lead
inserts despite the just-added suppression. Window is small (low-millisecond),
but the consequence is non-trivial: an unsubscribed contact ends up in the
queue and the agent's prompt path (`tool.enrich.dnc_scrub` at scoring time)
is the only fallback before outreach. Worth fixing now because the fix is a
4-line wrap; harder once DB load is real.
**Fix:** Wrap both calls in `db.transaction(async (tx) => {...})`. While here,
move the suppression match server-side as a single SQL query that joins
suppression_list against the candidate lead fields — eliminates the network
round-trip and the race. Drizzle supports `tx.execute(sql\`SELECT 1 FROM
suppression_list WHERE tenant_id = ${tenantId} AND ((kind='email' AND value=${email}) OR ...)\`)`.

### WR-02: `supabase_query` for leads has no `ORDER BY` — enrichment-scoring prompt assumes oldest-first but DB does not guarantee it

**File:** `apps/runner/src/lead-pipeline-tools.ts:217-223` and
`scripts/seed/acqu-enrichment-scoring.ts:22` (prompt assumption)
**Issue:** The handler's `leads` case is `db.select().from(schema.leads).where(...).limit(cap)` — no `orderBy`. Postgres makes no order guarantee without an explicit clause. The enrichment-scoring prompt at L22 tells the
agent "Order by created_at oldest-first is the SQL default; process accordingly."
That's incorrect — the agent will see whatever order the planner chose, which
varies with index health, vacuum state, and concurrent writes. In practice:
the same `status='new'` leads can be re-served across batches (because they
stay new until P4 write-back lands — see CR-02), causing duplicate enrichment
spend. The migration 0032 index `leads_tenant_new_created_idx` (L98-99) exists
*for* this query — wire it up.
**Fix:** In the `leads` case, append `.orderBy(schema.leads.createdAt)` (ascending
= oldest first), matching both the prompt promise and the existing partial
index. Add an `order` parameter to the tool input so callers that need newest-
first (e.g. operator dashboards) can flip it. Update the prompt to remove the
"SQL default" claim once the orderBy is explicit.

### WR-03: `dnc_scrub` phone match drops normalization that `matchesSuppression` already performs inconsistently

**File:** `apps/runner/src/lead-pipeline-tools.ts:548-561` and `packages/core/src/lead-pipeline.ts:228`
**Issue:** `matchesSuppression` for phone compares `s.value === phone.trim()`
(L228 of lead-pipeline.ts — only `.trim()`, no digit normalization). But the
suppression list comment at migration 0032:128 says "normalized: lowercase
email, e164 phone, etc." — i.e. stored as e164 (`+15551234567`). Leads usually
arrive with formatted phones (`(555) 123-4567`, `+1 555-123-4567`). So a
contact whose true e164 is on the suppression list will fail the match because
`(555) 123-4567`.trim() ≠ `+15551234567`. Discovery time: the agent never
finds the match, lead inserts, then `tool.enrich.phone_validate` normalizes to
digits — but only *after* `dnc_scrub` ran in the same handler at L548 with the
raw value. Effect: e164-suppressed phones leak through to outreach unless the
agent itself happens to normalize before calling.
**Fix:** Normalize on both sides. Add a `normalizePhone()` to lead-pipeline.ts
(strip everything except digits and a leading `+`, prepend `+` if missing,
default-country-code aware): then `matchesSuppression` does `normalizePhone(s.value) === normalizePhone(lead.phone)`. The suppression-list comment
already declares e164 as the canonical storage shape — this just makes the
match honor it.

### WR-04: `numverify` phone-validate uses HTTP not HTTPS

**File:** `apps/runner/src/lead-pipeline-tools.ts:515-518`
**Issue:** `https://apilayer.net/api/validate` — actually this one is HTTPS,
but the comment at L514 says "numverify uses http for the free tier; production
should pin https." The code does pin https, but the comment misleads a future
contributor who might "fix" it back to http per the comment. Real risk if a
hurried operator follows the comment and swaps protocols: the API key
(`NUMVERIFY_API_KEY`) is sent as a query param — over HTTP it would be visible
in any path-logging proxy.
**Fix:** Delete the misleading comment. Replace with `// https pinned — never
downgrade; api key travels as a query param and HTTP would log it to any
intermediary.` While here: move the key into a header if numverify supports
one (it does not in v1 — but document the constraint at the top of the file).

## Info

### IN-01: `setup.ts` reports "31 migrations" — drift after 0032 landed

**File:** `scripts/setup/setup.ts:250`
**Issue:** `console.log("  pnpm db:migrate   # push 31 migrations to Supabase");`
— the new lead-pipeline migration brings the total to 32. Cosmetic; the migrate
command counts the directory contents, so the wizard's message is just stale.
The launch-readiness check at gate `32 migrations monotonic` is the load-bearing
verification — that one is right.
**Fix:** Compute the count dynamically: `const n = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter(f => /^\d+_.*\.sql$/.test(f)).length;` and
interpolate. Stop hardcoding.

### IN-02: `lead-pipeline-tools.ts` `require("@agent-os/db")` in lazy DB getter — ESM/CJS interop landmine

**File:** `apps/runner/src/lead-pipeline-tools.ts:579-581`
**Issue:** `const { createDb } = require("@agent-os/db") as typeof import("@agent-os/db")`
inside an ESM module is a `node:module.createRequire`-less call to `require`,
which only works because the runner bundle uses tsx/esbuild's CJS shim. Under
strict ESM (which the runner intends to migrate to per AGENT-OS-PLAN) this is a
ReferenceError. The neighboring `custom-tools.ts:73-79` uses the same pattern,
so this is consistent — but it's the kind of thing that breaks on the Node 22
ESM cleanup pass.
**Fix:** Import `createDb` at the top of the file like every other module in
`apps/runner/src/`. The "lazy at first call so DATABASE_URL isn't required at
import time" comment doesn't apply because importing a function doesn't read
env — only calling it does. Drop the inline require.

### IN-03: `void sql; void inArray;` at lead-pipeline-tools.ts:601 — dead-import suppression hides a future bug

**File:** `apps/runner/src/lead-pipeline-tools.ts:598-601`
**Issue:** The comment claims the imports are kept "so future extensions ...
can drop in without re-jiggering the imports." That's not how lint passes work:
an unused import is a signal. Keeping it suppressed means when (a) someone adds
a `sql\`raw\`` call without remembering to use the imported tag, or (b) the
import shape changes upstream, the compiler/linter won't catch it. Tiny — not
load-bearing — but every other file in the repo lets the lint warn unused
imports out, and we shouldn't carve out an exception.
**Fix:** Delete the `void sql; void inArray;` lines and the corresponding
imports. When a future PR needs them, that PR adds them. Three lines + two
import-list entries down.

---

## Top recommendation

The cluster: **the lead pipeline ships P3 (discovery) functionally, but P4
(enrichment + scoring) is incomplete**.

- CR-01 means an off-prompt actor *can* run — the matrix gate exists only at
  seed time, never at dispatch.
- CR-02 means even when scoring runs perfectly, the result has nowhere to land
  on the `leads` row — outreach (when it lands) will have no qualified leads to
  pick up.
- CR-03 is the same "uniform pattern, single gap" shape Phase 68 caught four
  times — easy to fix, defense-in-depth.

The remaining warnings (WR-01..WR-04) are real but not launch-blocking IF you
ship P3 alone first. Three-step suggested gate before going internal:

1. Ship CR-01 + CR-03 (single-handler fixes, an afternoon).
2. Either ship CR-02 (the `update_lead` tool — half a day) OR set a
   `LEAD_PIPELINE_P4_READY=0` flag and disable the enrichment-scoring cron in
   `acqu-enrichment-scoring.ts:110`. Discovery alone is useful — it builds the
   queue while P4 lands.
3. Fold WR-01..WR-04 + IN-01..IN-03 into the same PR or the next sprint.

Nothing in V2 (P3/P4 module trio, lifecycle-sinks, lease.ts, manager.ts) or the
setup wizard regressed from Phase 68's clean. Everything Phase 68 flagged
landed as committed (verified inline against current HEAD 5a6f4cc). The standing
22-suite battery covers what it covers; the three gaps above are the ones the
gates don't see.

---

_Reviewed: 2026-06-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
