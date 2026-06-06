# Phase 44 — Model feedback loop

`packages/core/src/router/model-feedback.ts`. Pure module that turns production-run signal back into capability_score updates so the picker gets smarter without operator hand-tuning.

API:
- `deriveOutcomeScore(args)` -> 0..10 score from per-run highlights (verification, output_quality, cantfail, finding count)
- `aggregateModelObservations(observations, catalog)` -> `ProposedScoreUpdate[]` (one per (model, capability) bucket above the sample-size floor)

Safety guards:
- BLEND_RATE = 0.1 (10% movement per cycle — prevents single-window swings)
- MIN_SAMPLES = 10 (skip undersized buckets)
- FLOOR_SCORE = 3 (never propose below 3 — flaky windows can't make a known-good model ineligible)
- T-critical models NEVER auto-updated (doctrine, not observed)
- Disabled + deprecated rows skipped
- No-op proposals (delta < 0.05) suppressed for audit-trail clarity

26 assertions across 9 groups. The Inngest function that calls this monthly + writes the proposals back to `models.capability_scores` is the natural next phase; this module is the math layer it consumes.
