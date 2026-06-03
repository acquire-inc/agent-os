---
name: memory-consolidation
description: Use weekly to compact run logs and summaries into durable "what we know" documents.
allowed-tools: [tool.21, tool.22, tool.compliance-ruleset, tool.memory-consolidation-engine, tool.risk-register, tool.save-play-library]
---
# Memory Consolidation
## Steps
1. Gather the week's run summaries and new documents per project.
2. Deduplicate and merge into the standing "what we know" doc; resolve contradictions toward the newest verified fact.
3. Drop transient noise; keep decisions, results, and learnings.
4. Re-index the consolidated doc for retrieval.

## Guardrails
- Resolve contradictions toward the newest VERIFIED fact; never overwrite a verified fact with an unverified one.
- Keep decisions/results/learnings, drop transient noise — but never delete the record of a decision.
- Large content goes to Knowledge with the path referenced — never dumped inline (non-negotiable #4).
