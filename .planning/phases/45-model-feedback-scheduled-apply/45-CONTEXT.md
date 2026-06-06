# Phase 45 — Scheduled apply for model feedback

Migration 0022 + `model_feedback_proposals` Drizzle table + `applyModelFeedback` Inngest function. Closes the catalog feedback loop end-to-end: monthly cron walks 30 days of run_summaries + relay_events, derives outcome scores via `deriveOutcomeScore`, aggregates via `aggregateModelObservations`, persists proposals to `model_feedback_proposals`, and auto-applies the ones that clear the auto-apply guardrails (sample_size >= 30, |delta| <= 0.5, model enabled + non-deprecated). Everything else stays pending for operator review.

Two new API endpoints:
- `GET /api/admin/models/proposals?status=` — list pending/applied/rejected proposals
- `POST /api/admin/models/proposals/:id/decide` — body `{ decision: "apply" | "reject" }`; applies via transaction (model + proposal row updated atomically)

Wired into `apps/api/src/index.ts` Inngest serve handler alongside `runScheduledAgent` and `scoreAgentsScheduled`.
