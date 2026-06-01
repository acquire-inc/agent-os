---
phase: 09-tenant-isolation-tester-secrets-rotation-external-launch-gat
plan: 05
subsystem: t-critical-agent-seeds + skills + architect-regression-locks
tags: [agent-seed, t-critical, opus-4.8, cant-fail, skills]
requires: [09-01 (CANT_FAIL_KEYS gap fix), 09-04 (tool registry rows + dispatch)]
provides:
  - 4 T-critical agent seed specs (tenant-isolation-tester, secrets-rotation, access-auditor, security-anomaly-watchdog)
  - 4 SKILL.md stubs (tenant-isolation-testing, secrets-rotation, access-audit, anomaly-detection-security)
  - 4 architect.test.ts regression assertions locking CANT_FAIL_KEYS membership
  - 4 new pnpm scripts under @agent-os/seed
affects: [09-06 batch seed runner reads these specs]
tech-stack:
  added: []
  patterns: [acqu-ad-claim-compliance template, runStandalone wrapper, frontmatter SKILL.md]
key-files:
  created:
    - scripts/seed/acqu-tenant-isolation-tester.ts
    - scripts/seed/acqu-secrets-rotation.ts
    - scripts/seed/acqu-access-auditor.ts
    - scripts/seed/acqu-security-anomaly-watchdog.ts
    - external/acqu-skills/tenant-isolation-testing/SKILL.md
    - external/acqu-skills/secrets-rotation/SKILL.md
    - external/acqu-skills/access-audit/SKILL.md
    - external/acqu-skills/anomaly-detection-security/SKILL.md
  modified:
    - packages/core/src/architect/architect.test.ts
    - scripts/seed/package.json
decisions:
  - "Model script literal = anthropic/claude-opus-4.8 on all 4. Tenant default_model_override (Phase 8.5) transparently rewrites at seed time — script intent preserved for revert."
  - "secrets-rotation autonomy = execute_safe at AGENT level; the propose-gating for CLIENT OAuth lives at the TOOL level (tool.vault-rotate requiresApproval=true, 09-04). PreToolUse hook 1c pauses for human approval. Per v2 D5.3 L1254."
  - "security-anomaly-watchdog autonomy = execute_safe for alerts; lockdown actions stay propose. D-07: day-1 alert-only posture; tightening goes through agent-evaluator scorecard."
  - "Cron schedules per doctrine v2 D5.3: 30 4 * * * (isolation), 0 4 * * * (rotation), 0 5 * * 3 (audit), 0 * * * * (anomaly)."
metrics:
  duration: ~35m
  completed: 2026-06-01
requirements: [SC-9-1, SC-9-5]
---

# Phase 9 Plan 05: T-Critical Agent Seeds + Skills + Regression Locks Summary

The 4 doctrine agents now exist as data: registry-ready AgentSpec scripts with opus-4.8 literals, doctrine prompts verbatim, the tool from 09-04 bound, and a SKILL.md the agent will read.

## Agent Matrix

| Agent | Tool binding | Cron | Autonomy | Budget | Escalation |
| ----- | ------------ | ---- | -------- | ------ | ---------- |
| tenant-isolation-tester | tool.rls-test | `30 4 * * *` | execute_safe | $1.50 | tcritical:isolation_failure → founder_p0 |
| secrets-rotation | tool.vault-rotate | `0 4 * * *` | execute_safe | $0.50 | tcritical:rotation_failed → founder_p0 |
| access-auditor | tool.access-audit | `0 5 * * 3` | execute_safe | $1.00 | tcritical:orphan_grant → founder_p1 |
| security-anomaly-watchdog | tool.access-log-analyzer | `0 * * * *` | execute_safe | $0.30 | tcritical:anomaly_high → founder_p0 |

All 4: `model: "anthropic/claude-opus-4.8"` + `thinkingLevel: "high"` + `knowledgeScope: { folders: ["security"], tags: ["security"] }` + `mcpNames: ["Slack"]`. The tenant default_model_override (Phase 8.5) rewrites the live row at seed time when the operator override is set — script literal preserves doctrine intent.

## Skill Stubs (frontmatter + workflow)

Each new file under `external/acqu-skills/<slug>/SKILL.md`:
- tenant-isolation-testing → bound to tenant-isolation-tester
- secrets-rotation → bound to secrets-rotation
- access-audit → bound to access-auditor
- anomaly-detection-security → bound to security-anomaly-watchdog

Skills follow the existing `clarify-before-acting` shape: yaml frontmatter `name` + `description`, H1, then Purpose / Workflow / Rules sections. The doctrine procedure text comes from v2 §D5.3 verbatim.

## Architect Regression Locks

`packages/core/src/architect/architect.test.ts` extended with 4 assertions. Architect count climbs 33 → **37 passed, 0 failed**. If any of these keys disappears from `CANT_FAIL_KEYS` in `hydrate.ts`, the test fails fast at PR time.

## Verification

- `pnpm --filter @agent-os/seed typecheck` — green.
- `pnpm --filter @agent-os/core run test:architect` — 37/37.
- 4 seed files contain `anthropic/claude-opus-4.8` + T-CRITICAL/NEVER-Hermes comment.
- 4 SKILL.md files exist with frontmatter `name:` headers.
- 4 new `acqu-*` scripts wired in `scripts/seed/package.json`.

## What's Next (09-06)

- `seed-phase-9.ts` batch runner with hard-fail guard (throws if any T-critical spec's model literal drifts off opus-4.8).
- `scripts/verify/isolation-live.ts` HARD GATE script (separate process, `RLS_TEST_DATABASE_URL` env).
- `docs/acqu-phase-9-agent-manifest.md` operator handoff.
- 2 BLOCKING operator checkpoints: `supabase db push` (migration 0010 from 09-01) + live HARD GATE verification with non-service-role connection.
