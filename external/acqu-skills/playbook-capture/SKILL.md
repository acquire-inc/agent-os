---
name: playbook-capture
description: Use after a notably good (or bad) outcome to capture a reusable playbook into Knowledge.
allowed-tools: [tool.21, tool.22, tool.memory-consolidation-engine, tool.save-play-library]
---
# Playbook Capture
## Steps
1. Identify what happened, why it worked/failed, and the repeatable steps.
2. Write a tight playbook: trigger, steps, guardrails, expected result.
3. Tag it and store in the Knowledge folder so future runs retrieve it.

## Guardrails
- Capture failures as well as wins — a failed run's lesson is as valuable as a win's.
- Store in Knowledge by path and tag for retrieval — never inline a large artifact into context.
- Capture the guardrails that kept it safe, not just the steps.
