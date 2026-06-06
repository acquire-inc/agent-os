# Phase 36 — cap-breach-flow integration test

15 assertions across 5 groups exercising `dispatchCustomTool → CapBreachError` chain: happy path, hard breach with field assertions, partial-commit-then-breach (prior commits preserved), no-tracker fixture mode, zero-cost tool skipping the reserve path. Script: `test:cap-breach-flow`.
