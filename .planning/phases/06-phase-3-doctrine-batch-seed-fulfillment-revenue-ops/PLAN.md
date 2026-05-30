# Phase 6: Phase-3 doctrine batch seed (fulfillment + revenue ops) — Plan

**For agentic workers:** Use `/gsd:execute-phase 6` (or executing-plans discipline) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the 12 fulfillment + revenue-ops doctrine agents as DATA via the same `seedAgent(db, spec)` pattern used in Phase 2 and Phase 5. No new application code.

**Architecture:** Per-agent `scripts/seed/acqu-<key>.ts` (data) + `scripts/seed/seed-phase-3.ts` (batch runner) + `docs/acqu-phase-3-agent-manifest.md` (operator manifest). Every prompt is verbatim from RESEARCH.md.

**Tech Stack:** TypeScript (strict), `@agent-os/core` (`seedAgent`), `@agent-os/shared` (`TENANT_IDS`). Zero new deps.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/seed/acqu-launcher.ts` | Create | The PAUSED-only ad launcher — autonomy=propose (HARD GATE) |
| `scripts/seed/acqu-lead-triage.ts` | Create | Form → score → route |
| `scripts/seed/acqu-booking-concierge.ts` | Create | Pre-call sequence + no-show recovery |
| `scripts/seed/acqu-funnel-monitor.ts` | Create | Hourly funnel anomaly detector |
| `scripts/seed/acqu-onboarding-runner.ts` | Create | 14-day client onboarding |
| `scripts/seed/acqu-client-comms.ts` | Create | Inbound triage + proactive comms |
| `scripts/seed/acqu-client-health.ts` | Create | Daily health score |
| `scripts/seed/acqu-churn-risk-detector.ts` | Create | Daily churn-signal scan |
| `scripts/seed/acqu-ar-aging-monitor.ts` | Create | Daily receivables aging |
| `scripts/seed/acqu-revenue-recognizer.ts` | Create | Nightly revenue ledger |
| `scripts/seed/acqu-cash-position-monitor.ts` | Create | Daily 14-day low-point alert |
| `scripts/seed/acqu-runway-watcher.ts` | Create | Weekly runway model |
| `scripts/seed/seed-phase-3.ts` | Create | Batch runner |
| `scripts/seed/package.json` | Modify | Per-agent + `phase-3` scripts |
| `package.json` | Modify | Root `seed:phase-3` script |
| `docs/acqu-phase-3-agent-manifest.md` | Create | Operator manifest |
| `.planning/phases/06-.../VERIFICATION.md` | Create | Status: passed (after green check) |

---

## Task 1: Per-agent seed scripts (12 files)

Each script: header comment with doctrine source + tier + autonomy rationale → verbatim prompt from RESEARCH.md → exported `AgentSpec` constant → `runStandalone` guard.

- [ ] **Step 1**: Write `scripts/seed/acqu-launcher.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `propose`, no cron, MCPs `["Pipeboard × Meta", "Slack"]`, skills `["launch-discipline", "naming-convention", "verification-before-completion"]`, budget `$0.50`.
- [ ] **Step 2**: Write `scripts/seed/acqu-lead-triage.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `execute_safe`, no cron, MCPs `["Close", "Slack", "Twilio"]`, skills `["lead-routing-qualification", "verification-before-completion"]`, budget `$0.50`.
- [ ] **Step 3**: Write `scripts/seed/acqu-booking-concierge.ts` — model `anthropic/claude-haiku-4-5`, autonomy `execute_safe`, cron `"0 * * * *"`, MCPs `["Close", "Slack", "Twilio", "Gmail"]`, skills `["verification-before-completion"]`, budget `$0.20`.
- [ ] **Step 4**: Write `scripts/seed/acqu-funnel-monitor.ts` — model `nousresearch/hermes-4-70b`, autonomy `execute_safe`, cron `"0 * * * *"`, MCPs `["Slack"]`, skills `["verification-before-completion"]`, budget `$0.20`.
- [ ] **Step 5**: Write `scripts/seed/acqu-onboarding-runner.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `propose`, no cron, MCPs `["Close", "Slack", "Google Drive", "Gmail"]`, skills `["client-onboarding", "verification-before-completion"]`, budget `$2.00` (clamped from $3.00 by architect ceiling — keep consistent).
- [ ] **Step 6**: Write `scripts/seed/acqu-client-comms.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `propose`, no cron, MCPs `["Close", "Google Drive", "Slack", "Gmail"]`, skills `["verification-before-completion", "clarify-before-acting"]`, budget `$0.50`.
- [ ] **Step 7**: Write `scripts/seed/acqu-client-health.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `execute_safe`, cron `"30 6 * * *"`, MCPs `["Close", "Slack"]`, skills `["client-health-scan", "verification-before-completion"]`, budget `$0.50`.
- [ ] **Step 8**: Write `scripts/seed/acqu-churn-risk-detector.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `execute_safe`, cron `"45 6 * * *"`, MCPs `["Close", "Slack"]`, skills `["churn-risk-detection", "verification-before-completion"]`, budget `$0.50`.
- [ ] **Step 9**: Write `scripts/seed/acqu-ar-aging-monitor.ts` — model `nousresearch/hermes-4-70b`, autonomy `execute_safe`, cron `"0 6 * * *"`, MCPs `["Close", "Slack"]`, skills `["verification-before-completion"]`, budget `$0.20`.
- [ ] **Step 10**: Write `scripts/seed/acqu-revenue-recognizer.ts` — model `nousresearch/hermes-4-70b`, autonomy `execute_safe`, cron `"30 2 * * *"`, MCPs `["Close"]`, skills `["verification-before-completion"]`, budget `$0.30`.
- [ ] **Step 11**: Write `scripts/seed/acqu-cash-position-monitor.ts` — model `nousresearch/hermes-4-70b`, autonomy `execute_safe`, cron `"0 6 * * *"`, MCPs `["Slack"]`, skills `["verification-before-completion"]`, budget `$0.20`.
- [ ] **Step 12**: Write `scripts/seed/acqu-runway-watcher.ts` — model `anthropic/claude-sonnet-4.6`, autonomy `execute_safe`, cron `"0 7 * * 1"`, MCPs `["Slack", "Google Drive"]`, skills `["verification-before-completion"]`, budget `$1.00`.

## Task 2: Batch runner

- [ ] **Step 1**: Write `scripts/seed/seed-phase-3.ts` — imports all 12 specs, iterates via `seedAgent(db, spec, { skillSource: SKILL_SOURCE })`, prints eyeball table + hard-gate reminder ("launcher post-compliance-gated; verify ad-claim-compliance is enabled before flipping launcher.enabled true").

## Task 3: pnpm wiring

- [ ] **Step 1**: Add 12 per-agent scripts + `phase-3` to `scripts/seed/package.json`.
- [ ] **Step 2**: Add `seed:phase-3` to root `package.json`.

## Task 4: Manifest

- [ ] **Step 1**: Write `docs/acqu-phase-3-agent-manifest.md` mirroring Phase-1/2 manifest shape.

## Task 5: Verify + commit + push

- [ ] **Step 1**: `pnpm -r typecheck` — expected all 10 packages Done with no errors.
- [ ] **Step 2**: `pnpm --filter @agent-os/core run test:architect` — expected `Results: 31 passed, 0 failed`.
- [ ] **Step 3**: Write `VERIFICATION.md` with `status: passed`.
- [ ] **Step 4**: `git add` + commit + push:

  ```bash
  git add scripts/seed/acqu-*.ts scripts/seed/seed-phase-3.ts \
          scripts/seed/package.json package.json \
          docs/acqu-phase-3-agent-manifest.md \
          .planning/ .claude/
  git commit -m "feat: B-phase-3 — Phase-3 doctrine seed (fulfillment + revenue ops) + GSD install"
  git push -u origin claude/exciting-davinci-yvptm
  ```

## Done when

- 12 new per-agent seed scripts + 1 batch runner committed.
- `pnpm seed:phase-3` wired at root.
- `pnpm -r typecheck` green; architect tests 31/31.
- VERIFICATION.md `status: passed`.
