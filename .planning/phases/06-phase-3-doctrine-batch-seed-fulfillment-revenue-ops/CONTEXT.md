# Phase 6: Phase-3 doctrine batch seed (fulfillment + revenue ops) — Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

## Phase Boundary

Seed the 12 fulfillment + revenue-ops agents the doctrine specifies for Phase 3 (v1 §2.3/§2.5/§2.6/§2.7 + v2 D2.1/D2.2/D2.3/D4.1/D4.4). Pure data. No new application code beyond seed scripts. The Architect already exists; this batch is hand-authored because the doctrine is the source of truth and we want lossless capture, not LLM paraphrase.

The roster:
- v1 Phase 3 baseline: `launcher`, `lead-triage`, `booking-concierge`, `funnel-monitor`, `onboarding-runner`, `client-comms`, `client-health`, `churn-risk-detector`
- main §F Phase 3 additions: `ar-aging-monitor`, `revenue-recognizer`, `cash-position-monitor`, `runway-watcher`

## Implementation Decisions

### Per-agent script shape
- **D-01:** Same pattern as Phase-1 and Phase-2: one `scripts/seed/acqu-<key>.ts` per agent, exporting `<keyCamelCase>Spec: AgentSpec` + a tiny `main()` that runs standalone OR is imported by the batch runner.
- **D-02:** Imports follow the established convention: `TENANT_IDS` from `@agent-os/shared`, `runStandalone` from `./lib/runSpec.js`, `type AgentSpec` from `@agent-os/core`.
- **D-03:** Prompts come VERBATIM from the doctrine (extracted by an Explore subagent — see RESEARCH.md). No paraphrasing.

### Autonomy floor (hard rules)
- **D-04:** `launcher` autonomy is **`propose`** — it writes to Meta. Runbook hard gate; never `execute_safe`.
- **D-05:** All client-facing comms agents (`client-comms`, `onboarding-runner`, `booking-concierge`) at `propose`.
- **D-06:** Pure-read monitors (`funnel-monitor`, `client-health`, `churn-risk-detector`, `ar-aging-monitor`, `cash-position-monitor`, `runway-watcher`) at `execute_safe`.
- **D-07:** Ledger writers (`revenue-recognizer`) at `execute_safe` — bounded category writes against a defined chart of accounts.
- **D-08:** `lead-triage` at `execute_safe` — scoring + routing, no external sends; if it ever drafts comms, demote to `propose`.

### Model tier
- **D-09:** Tier per main §1.5; default to the doctrine's stated value. Where the doctrine specifies a Claude tier (T-work/T-critical) the script uses Anthropic slugs; where it specifies T-cheap or T-reason, the script uses the Hermes slug.
- **D-10:** None of the Phase-3 roster is on the can't-fail list — `ad-claim-compliance` is already shipped in Phase 5. No T-critical agents here.

### Bindings
- **D-11:** Skills bind by key. Every agent gets `verification-before-completion` as a baseline skill; doctrine-specified custom skills layered on top.
- **D-12:** MCPs bind by exact name as registered in fixtures.ts: `Close`, `Pipeboard × Meta`, `Slack`, `Google Drive`, `Gmail`, `Fireflies`, `pgvector Knowledge`, `Stripe`, `QuickBooks`, `Twilio` (note: some are `status=disconnected` in fixtures — bindings are forward-compatible; runner skips disconnected MCPs).

### Batch runner
- **D-13:** `scripts/seed/seed-phase-3.ts` follows the exact shape of `seed-phase-2.ts`: import all 12 specs, iterate via `seedAgent(db, spec, { skillSource: SKILL_SOURCE })`, print the eyeball table.
- **D-14:** `pnpm seed:phase-3` at the root + per-agent scripts in `scripts/seed/package.json`.

### Documentation
- **D-15:** `docs/acqu-phase-3-agent-manifest.md` mirrors the shape of `docs/acqu-phase-1-agent-manifest.md` and `docs/acqu-phase-2-agent-manifest.md`. The hard-gate callout this time is: "**`launcher` is the post-compliance-gate writer; verify `ad-claim-compliance` (Phase 5) is enabled before flipping `launcher.enabled` true.**"

### Verification at end
- **D-16:** `pnpm -r typecheck` must be green.
- **D-17:** `pnpm --filter @agent-os/core run test:architect` must still pass 31 assertions (no regression on the architect).
- **D-18:** Commit message convention follows prior phases: `feat: B<N> — Phase-<M> doctrine seed (<summary>)`.

## Out of Scope

- **OOS-01:** Authoring SKILL.md files for new skills referenced by Phase-3 agents (e.g. `lead-routing-qualification` — already in fixtures, but no SKILL.md; `client-onboarding`, `churn-risk-detection`, `client-health-scan` — already in fixtures as authored). New skill SKILL.md authoring deferred to Phase 8.
- **OOS-02:** Wiring webhooks for event-triggered agents (`booking-concierge` on inbound booking, `churn-risk-detector` on health drop). Cron + manual dispatch only this phase.
- **OOS-03:** Anything touching `attribution-reconciler` — that's a finance reconciliation chain dependency but lives in a different domain (D3.1 Data Tracking, not D4). Defer to Phase 8.
- **OOS-04:** Replacing the in-process scheduler with Inngest. That's Phase 7.

## Dependencies

- Phase 2 (the established `seedAgent` pattern + Phase-1 manifest doc shape).
- Phase 5 (`ad-claim-compliance` exists in the registry — without it, `launcher` shouldn't even be seeded with `enabled=true`; we keep `enabled=true` because the agent is gated by `propose` autonomy regardless, but document the hard gate in the manifest).

## Observable success (what the operator should see)

```
$ DATABASE_URL=... pnpm seed:phase-3
▸ Seeding Phase 3: 12 agents for tenant Acqu
... (per-agent ✓ lines)
✓ Phase 3 seeded — eyeball table:

  key                       model                             autonomy     cron            budget
  launcher                  anthropic/claude-sonnet-4.6       propose      —               $1.50
  lead-triage               nousresearch/hermes-4-70b         execute_safe */30 * * * *    $0.10
  booking-concierge         anthropic/claude-haiku-4-5        propose      —               $0.50
  funnel-monitor            nousresearch/hermes-4-70b         execute_safe 0 7 * * *       $0.10
  onboarding-runner         anthropic/claude-sonnet-4.6       propose      —               $1.00
  client-comms              anthropic/claude-sonnet-4.6       propose      —               $1.00
  client-health             nousresearch/hermes-4-70b         execute_safe 0 6 * * 1       $0.40
  churn-risk-detector       nousresearch/hermes-4-70b         execute_safe 0 7 * * 1       $0.50
  ar-aging-monitor          nousresearch/hermes-4-70b         execute_safe 0 6 * * *       $0.20
  revenue-recognizer        nousresearch/hermes-4-70b         execute_safe 30 2 * * *      $0.30
  cash-position-monitor     nousresearch/hermes-4-70b         execute_safe 0 6 * * *       $0.20
  runway-watcher            nousresearch/hermes-4-70b         execute_safe 0 6 * * *       $0.20

HARD GATE: launcher is post-compliance-gated — verify ad-claim-compliance is enabled.
Next: B<N+1> verify — manual dispatch each, confirm tiering, then Phase 7.
```

Specific model/budget values are derived from the doctrine in RESEARCH.md; the row above is the expected shape, not a binding contract — actuals may shift if the doctrine specifies differently.
