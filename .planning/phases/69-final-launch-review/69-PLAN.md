---
phase: 69
plan_id: 69-final-launch-fixes
depends_on: []
source_review: .planning/phases/69-final-launch-review/69-REVIEW.md
autonomous: true
requirements:
  - CR-01
  - CR-02
  - CR-03
  - WR-01
  - WR-02
  - WR-03
  - WR-04
  - INFO-01
  - INFO-03
files_modified:
  - apps/runner/src/lead-pipeline-tools.ts
  - packages/core/src/lead-pipeline.ts
  - packages/core/src/lead-pipeline.test.ts
  - scripts/seed/acqu-discovery-agent.ts
  - scripts/seed/acqu-enrichment-scoring.ts
  - scripts/setup/setup.ts
---

# Phase 69: Final Launch Fixes

## Objective

Close the P3/P4 lead-pipeline cluster from `69-REVIEW.md` before internal
launch: missing tool-side `target_type` matrix guard (CR-01), missing P4
write-back path so `leads.icp_score`/`qualified`/`enrichment` can land
(CR-02), missing `icp_id` cross-tenant ownership check (CR-03), plus the
four warnings (suppression-vs-insert race, missing `ORDER BY`, inconsistent
phone normalization in suppression match, misleading HTTPS comment) and two
of the three info items (dynamic migration count, dead `void sql; void
inArray;`). Smallest mechanism per finding — no new features.

## must_haves

- T-critical pin holds; no model selection changes.
- CRA blocklist unchanged.
- Multi-tenant invariant strengthened: every `leads` write validates every
  FK pointer (`icp_id`) against `tenants.id` ownership.
- Vault key never logged; no API key relocations.
- Can't-fail paths remain human-only — no autonomy promotion.
- Matrix is the contract at *dispatch*, not just at seed time.
- Write-back-or-don't-pretend: P4 either writes to `leads` row or refuses.

## truths

- Multi-tenant assertion is per-row AND per-FK: every pointer this tenant
  writes must resolve inside the same tenant. CR-03 is the fifth instance
  of this pattern; Phase 68 caught four.
- The DISCOVERY_ACTORS matrix is the contract — but only if it runs at
  dispatch. Seed-time enforcement is necessary, not sufficient (CR-01).
- A `scored` event in `lead_events` with no corresponding mutation on the
  `leads` row is a lie to the rest of the system (CR-02). Outreach reads
  the row, not the event log.
- Suppression must use the canonical storage shape on both sides of the
  match (WR-03). Migration 0032 declared e164 as canonical.

## Tasks

### T1 — CR-01: tool-side `target_type` matrix guard in `apifyRunActor`

<read_first>
- apps/runner/src/lead-pipeline-tools.ts:78–131 (handler)
- packages/core/src/lead-pipeline.ts:80–120 (DISCOVERY_ACTORS + TargetType)
- scripts/seed/acqu-discovery-agent.ts:43 (prompt promise)
</read_first>

<action>
Adopt review option (b) — server-side ICP load (agent cannot lie about
target_type). At the top of `apifyRunActor` after `actor_id` extraction,
fetch the active ICP for `ctx.tenantId`:
`const [icp] = await getDb().select({ targetType: schema.icps.targetType }).from(schema.icps).where(and(eq(schema.icps.tenantId, ctx.tenantId), eq(schema.icps.active, true))).limit(1);`
If no active ICP, `return envErr("no active ICP for tenant — refusing actor dispatch");`.
Look up `matrixActor = DISCOVERY_ACTORS.find(a => a.id === actor_id)`. If
found and `!matrixActor.targets.includes(icp.targetType as TargetType)`,
`return envErr(\`actor ${actor_id} not registered for target_type=${icp.targetType} (registered: ${matrixActor.targets.join(",")})\`);`.
Keep existing `max_items` clamp. Update the discovery-agent system prompt
at `scripts/seed/acqu-discovery-agent.ts:43` so the refusal claim is backed
by code (one-line truth-up — no behavior change).
</action>

<acceptance_criteria>
- `grep -n "not registered for target_type" apps/runner/src/lead-pipeline-tools.ts` returns one line in the `apifyRunActor` body.
- `grep -n "active ICP for tenant" apps/runner/src/lead-pipeline-tools.ts` returns the refusal path.
- New test in `packages/core/src/lead-pipeline.test.ts` *or* a runner-side fixture asserts: dispatching `apify:crunchbase-funded` for a `local_smb` ICP returns `{ ok: false, error: /not registered/ }` without an HTTP call. (Mock Apify fetch; assert it wasn't called.)
</acceptance_criteria>

### T2 — CR-02: ship `tool.lead.update_lead` write-back handler

<read_first>
- apps/runner/src/lead-pipeline-tools.ts:330–356 (supabaseLogEvent — tenant assert template)
- apps/runner/src/lead-pipeline-tools.ts:584–597 (registry)
- packages/db/src/schema.ts (leads columns: enrichment, icpScore, qualified, emailStatus, phoneType, dncFlag, status, enrichedAt, scoredAt)
- scripts/seed/acqu-enrichment-scoring.ts:43–75 (prompt admitting the gap)
</read_first>

<action>
Add `updateLead: CustomToolHandler` mirroring `supabaseLogEvent`'s shape.
Input whitelist (REJECT any other key): `{ lead_id, enrichment?, icp_score?, qualified?, email_status?, phone_type?, dnc_flag? }`. Tenant
ownership check: `SELECT id FROM leads WHERE id = $lead_id AND tenant_id = $tenantId LIMIT 1` — `envErr("lead_id not visible to this tenant")` if absent
(verbatim string from L344). Server-derived stamps: set `enriched_at = new Date()` when `enrichment` is present; set `scored_at = new Date()` when
`icp_score` is present. Server-derived status transitions ONLY — reject
agent-supplied status: `new → enriching` when `enrichment` first lands;
`enriching → qualified` when `icp_score` lands AND `qualified === true`;
`enriching → disqualified` when `icp_score` lands AND `qualified === false`.
Validate `icp_score` is `number` in `[0,100]`. Single `UPDATE` via Drizzle
`.update(schema.leads).set({...}).where(and(eq(id), eq(tenantId)))`.
Register key `tool.lead.update_lead` in `LEAD_PIPELINE_TOOLS`. Update
`scripts/seed/acqu-enrichment-scoring.ts`: remove the "a follow-up endpoint
will sync it" admission at L43; add the `tool.lead.update_lead` call to the
scoring step at L75 (call it after emitting the scored event, with the
validated `ScoringResult` mapped into the tool input).
</action>

<acceptance_criteria>
- `grep -n "tool.lead.update_lead" apps/runner/src/lead-pipeline-tools.ts` shows the registry entry.
- `grep -n "lead_id not visible to this tenant" apps/runner/src/lead-pipeline-tools.ts | wc -l` returns `2` (one in `supabaseLogEvent`, one in `updateLead`).
- `grep -nE "enriched_at|scored_at" apps/runner/src/lead-pipeline-tools.ts` shows server-side stamps in the new handler.
- `grep -n "follow-up endpoint will sync" scripts/seed/acqu-enrichment-scoring.ts` returns nothing.
- New test asserts: agent-supplied `status: "qualified"` is dropped; status is derived from `qualified` + `icp_score` presence.
- Whitelist test: extra key in input (e.g. `tenant_id`) is rejected with `envErr`.
</acceptance_criteria>

### T3 — CR-03: `icp_id` cross-tenant ownership check in `supabaseInsertLead`

<read_first>
- apps/runner/src/lead-pipeline-tools.ts:300–323
</read_first>

<action>
Immediately before the `db.insert(schema.leads).values({...})` block, when
`row.icp_id` is a string, validate ownership via
`SELECT id FROM icps WHERE id = $icp_id AND tenant_id = $tenantId LIMIT 1`.
If not found: `return envErr("icp_id not visible to this tenant — refusing insert");`.
Mirror the error-string shape of L344 for the registry-grep parity.
</action>

<acceptance_criteria>
- `grep -nE "icp_id not visible to this tenant" apps/runner/src/lead-pipeline-tools.ts` returns one line.
- Insert path retains `onConflictDoNothing` and the existing returning.
- Test: provide an `icp_id` belonging to a different tenant; expect `{ ok: false, error: /icp_id not visible/ }` and zero `leads` rows inserted.
</acceptance_criteria>

### T4 — WR-01 + WR-02: transactional suppression+insert and oldest-first ORDER BY

<read_first>
- apps/runner/src/lead-pipeline-tools.ts:217–223 (leads query)
- apps/runner/src/lead-pipeline-tools.ts:282–323 (suppression read + insert)
</read_first>

<action>
WR-01: wrap the suppression `select` and the `leads` `insert` in
`db.transaction(async (tx) => { ... })`. Substitute `tx` for `db` on both
calls inside the closure. No SQL rewrite — just an atomicity wrapper.
WR-02: in the `leads` case of `supabaseQuery`, append
`.orderBy(schema.leads.createdAt)` (ascending = oldest-first, matching the
`leads_tenant_new_created_idx` partial index from migration 0032). Update
the enrichment-scoring prompt at `scripts/seed/acqu-enrichment-scoring.ts:22` to drop the "SQL default" claim — replace with "oldest-first ordering is enforced server-side by the tool."
</action>

<acceptance_criteria>
- `grep -n "db.transaction" apps/runner/src/lead-pipeline-tools.ts` returns the new wrapper around suppression+insert.
- `grep -n "orderBy(schema.leads.createdAt)" apps/runner/src/lead-pipeline-tools.ts` returns one line.
- `grep -n "SQL default" scripts/seed/acqu-enrichment-scoring.ts` returns nothing.
</acceptance_criteria>

### T5 — WR-03: e164 phone normalization shared between match and scrub

<read_first>
- packages/core/src/lead-pipeline.ts:206–231 (matchesSuppression)
- apps/runner/src/lead-pipeline-tools.ts:548–561 (dncScrub match echo)
</read_first>

<action>
In `packages/core/src/lead-pipeline.ts`, add and export
`normalizePhone(value: string | null | undefined): string | null` — strips
everything except digits and a leading `+`; prepends `+` if missing AND
length looks intl (>=10 digits); returns `null` if empty after strip.
Rewrite `matchesSuppression` phone branch: compute
`const phone = normalizePhone(lead.phone);` then
`if (s.kind === "phone" && phone && normalizePhone(s.value) === phone) return true;`.
In `apps/runner/src/lead-pipeline-tools.ts` `dncScrub`, mirror: replace
`r.value === phone.trim()` with `normalizePhone(r.value) === normalizePhone(phone)`.
Import `normalizePhone` from `@agent-os/core`. Add unit tests in
`lead-pipeline.test.ts` covering `(555) 123-4567` vs `+15551234567` match.
</action>

<acceptance_criteria>
- `grep -n "export function normalizePhone" packages/core/src/lead-pipeline.ts` returns one line.
- `grep -n "normalizePhone" apps/runner/src/lead-pipeline-tools.ts` returns at least one line inside `dncScrub`.
- `grep -nE "phone.trim\\(\\)" apps/runner/src/lead-pipeline-tools.ts` returns nothing inside `dncScrub`.
- New test asserts `(555) 123-4567` matches a stored `+15551234567` suppression entry.
</acceptance_criteria>

### T6 — WR-04 + INFO-01 + INFO-03: small-mechanism cleanups

<read_first>
- apps/runner/src/lead-pipeline-tools.ts:514 (misleading comment)
- apps/runner/src/lead-pipeline-tools.ts:598–601 (dead suppression)
- scripts/setup/setup.ts:250 (stale "31 migrations")
</read_first>

<action>
WR-04: replace the `// numverify uses http for the free tier; production should pin https.` comment at L514 with
`// https pinned — never downgrade; api key travels as a query param and HTTP would log it to any intermediary.`.
INFO-03: delete the `void sql; void inArray;` lines and remove `sql` and
`inArray` from the `drizzle-orm` import at L29 (keep `and`, `eq`). If T1/T4
introduced new usages, keep that import and drop only the `void` suppression.
INFO-01: in `scripts/setup/setup.ts:250`, compute migration count
dynamically: `const migrationCount = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter(f => /^\\d+_.*\\.sql$/.test(f)).length;` and
interpolate into the log line. Add `readdirSync` to the existing `node:fs` import.
</action>

<acceptance_criteria>
- `grep -n "https pinned" apps/runner/src/lead-pipeline-tools.ts` returns one line; `grep -n "uses http for the free tier" apps/runner/src/lead-pipeline-tools.ts` returns nothing.
- `grep -nE "^void " apps/runner/src/lead-pipeline-tools.ts | grep -v '^#' | grep -c .` returns `0`.
- `grep -nE "push (31|32) migrations" scripts/setup/setup.ts` returns nothing; `grep -n "migrationCount" scripts/setup/setup.ts` returns at least one line.
</acceptance_criteria>

## Verification

```bash
pnpm -r typecheck
pnpm --filter @agent-os/core test:lead-pipeline
pnpm --filter @agent-os/core test:lease
pnpm --filter @agent-os/core test:relay
pnpm launch:check
```

`launch:check` MUST still be 29/29 (or 30/30 if a new gate was added).
Any drop is a fail.

## Risk

**Low-to-medium.** All changes are localized to the P3/P4 surface from the
same review window — no cross-cutting refactors. The new CR-02 tool is
whitelisted, tenant-scoped, and mirrors `supabaseLogEvent`. The matrix
guard (CR-01) and ownership check (CR-03) fail closed — worst case is a
false-negative refusal (caught by tests), not a silent data leak.
Transaction wrap (WR-01) is the only runtime-behavior shift; existing
`ON CONFLICT DO NOTHING` semantics are preserved inside the wrapper.
INFO-02 deferred (>10 LOC ESM/CJS refactor — schedule separately).
