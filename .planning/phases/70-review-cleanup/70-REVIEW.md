---
status: closed
phase: 70
scope: full publish surface — 4-dimension workflow review + cleanup + fixes
depth: deep (multi-agent workflow, adversarial verification)
raw_findings: 54
confirmed: 31
refuted_or_duplicate: 23
closed_this_phase: 31
---

# Phase 70 — Review + Cleanup + Hardening (GSD loop)

Four parallel review dimensions (security-tenant, correctness-contracts,
cleanup-dead-code, ops-launch) with per-finding adversarial verification.
54 raw findings → 31 confirmed after dedupe + refutation (session limits cut
the automated verify pass short; the remaining critical-labeled claims were
verified inline against the code). Raw data: `70-FINDINGS-RAW.json`.

## Criticals (3 — all fixed)

| ID | Finding | Fix |
|---|---|---|
| MT-01 | `tool.vault-rotate` accepted agent-supplied `mcpId` with no tenant check — cross-tenant OAuth credential rotation possible | Handler requires ctx.tenantId + mcp ownership SELECT; `rotateCredential` gains a required `tenantId` param with a second where-predicate (fails closed core-side) |
| MT-02 | `tool.access-audit` + `tool.access-log-analyzer` took `tenantId` from agent input | Both derive tenant from ctx; input.tenantId ignored |
| CORR-03 | Critic sink hardcoded `estimatedCostUsd: 0` → every proposal critic-eligible | `null` — unknown stake routes to the human inbox per doctrine |

## Warnings (5 fixed, 1 verified-then-fixed)

| ID | Finding | Fix |
|---|---|---|
| MT-03 | Apify matrix gate failed OPEN for unregistered actor ids | Fail closed: unregistered → refusal naming the registered keys |
| MT-04 | `update_lead` trusted agent-supplied `qualified=true` with DNC/invalid email | Server-side hard-disqualifier: effective dnc_flag/email_status computed (patch ∪ row), qualified forced false, `hard_disqualifier_applied` surfaced |
| MT-06 | `POST /api/connections/:mcpId/credential` not admin-gated (runner keys could write creds) | `requireAdmin` added (verified live before fixing) |
| CORR-09 | Scoring-failure orphaned leads in `enriching` forever (P4 prompt claimed they stay `new`) | P4 prompt: straggler pickup (step 2b loads `enriching` leftovers); error-handling text corrected |
| CORR-15 | NaN score bypassed threshold (`NaN < t` is false) | `Number.isFinite` guard in `applyQualificationRules` + 3 new tests |
| OPS-02/OPS-01 | launch:check missed runner safety suites; lead-pipeline seeds undocumented | 4 runner suites added to battery (29 → 33 gates); seeds added to connect-and-launch.md |

## Cleanup (22 applied)

- **Dead exports removed** (callers: zero, verified): `buildCapBreachApprovalOptions`,
  `nextTick`, `isValidCron`, `resetCatalogCacheForTests`, `getOutputDirs`.
- **Unused imports removed**: `listBlueprints` (architect/index local), `and`
  (knowledge), `securityFindings`/`approvals` destructure (relay/summary),
  `ResolveModelResult` (intelligent-pick), `Verdict`/`scheduled`/`TierResolutionError`
  (3 test files).
- **CJS `require()` in ESM fixed** (Phase-69-deferred INFO-02): lead-pipeline-tools
  now statically imports `createDb`; the lazy part is the connection, not the module.
- **Redundant dynamic import removed** (`pickModelIntelligently` in tool.delegate).
- **Stale comments fixed**: "11 new keys", browser-smoke "lands in Phase 8".
- **Stale planning state refreshed**: STATE.md (was frozen at Phase 7),
  ROADMAP.md (phases 61–70 appended), CLAUDE.md current-phase line,
  launch-readiness migration-range printouts de-numbered,
  connect-and-launch migration count de-numbered, `.env.example` DATABASE_URL
  default aligned to docker-compose (`agentos`).

## Refuted / not actioned

MT-05, MT-07/CORR-13, MT-08, MT-09, CORR-04..08, CORR-10..12, CORR-14,
CORR-16..17 — either refuted by the verify pass, duplicates of confirmed
findings, or hollow-sink observations already documented as operator-gated
in LAUNCH-CAPSTONE (P6/P8 sink observation loaders). CORR-07 (re-score of
closed leads) noted for the outreach phase's plan — becomes relevant only
when `in_outreach+` states are used.

## Verification (all green at close)

- `pnpm launch:check` → READY ✓ **33/33** (4 new runner gates)
- `pnpm -r typecheck` → 0 errors (17 packages)
- lead-pipeline 72/72 (+3 NaN guards) · critic 37/37 · runner 22/22 · security 7/7
