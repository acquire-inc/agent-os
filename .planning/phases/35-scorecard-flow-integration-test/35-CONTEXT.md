# Phase 35 — scorecard-flow integration test

23 assertions across 6 groups exercising `runScorecardJob` end-to-end through a realistic stubbed sink: promote happy path, force_demote_safety on cantfail, CR-02 outputQualityApplied gating, cant-fail cap at execute_safe, multi-threshold demote rationale, empty window flowing through as insufficient_data with audit-trail completeness. Script: `test:scorecard-flow`.
