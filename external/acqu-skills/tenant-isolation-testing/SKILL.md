---
name: tenant-isolation-testing
description: Use daily at 04:30 and on every RLS/schema/auth change — run the cross-tenant attack suite end-to-end and treat any failure as a P0 release block.
---
# SKILL: Tenant Isolation Testing

## Purpose
Continuously prove tenant A can never reach tenant B's data through any path — SQL, API, agent prompts, vector DB, knowledge store, or tool dispatch. One isolation failure is a catastrophic, trust-ending breach for a multi-tenant control plane that holds clients' OAuth credentials.

## Workflow
1. Pull a fresh `tenantPairs` fixture (userA/tenantA + userB/tenantB) from the seed data.
2. Invoke `tool.rls-test` with the pair. The tool walks the append-only `ATTACK_VECTORS` registry — one entry per tenant_id-keyed table — and runs each vector's positive-control + attack sequence.
3. Parse the `IsolationResult.passed` boolean and the file at `resultsPath`.
4. For any vector with `passed: false`:
   - Call `recordFinding({ category: "isolation", severity: "critical", title: "<table>: cross-tenant read leaked", payload: { vectorId, actual } })`.
   - Block the most recent merge to main from deploying; alert founder + D5.1 in `#security` immediately.
   - Open an incident via D5.2.
5. Test prompt-injection paths: seed tenant A with hostile content that attempts to coerce an agent into reading tenant B's rows. Verify the runner's `deriveAllowedTools` allowlist + `is_tenant_member()` block this even when the prompt asks nicely.
6. Append a new vector for every fixed isolation bug — the suite GROWS, never shrinks (`assertVectorsAppendOnly()` enforces this).
7. Output: `kb:security/isolation-{date}.md`.

## Rules
- 100% pass is the only acceptable result. A single failure halts releases.
- Positive control failure ≠ pass. If a positive control returns 0 rows, the test is broken (no fixture data, RLS bypass, or service-role connection) — surface it as a broken-test finding, not a clean run.
- Never remove a vector from `ATTACK_VECTORS`. Migrations adding tenant_id-keyed tables MUST add a new `AV-NNN` entry.
- The HARD GATE for external Cliently launch (main §6 #2) reads this skill's output. Treat every run as the launch gate.
