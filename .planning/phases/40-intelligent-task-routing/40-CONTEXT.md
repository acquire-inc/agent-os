# Phase 40 — Intelligent task routing

Migration 0021 adds skills.task_profile + tools.task_profile JSONB columns with seeded canonical profiles. New `pickModelIntelligently(args)` high-level API combines Phase 39 picker with Phase 32 tier fork in a 3-path resolution: (1) TaskProfile present + capabilities -> catalog picker, (2) preferred_model_tier present -> tier fork, (3) neither -> agent baseline. T-critical safety floor wins at every layer. Returns model + source + tier + reason + ranked alternatives + filtered metadata for the audit trail. 21 assertions.
