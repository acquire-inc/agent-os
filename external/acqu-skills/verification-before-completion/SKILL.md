---
name: verification-before-completion
description: Load on every agent before declaring a task done. The "did I actually check my work" discipline — re-read the output against the request, verify each claim against its source, and confirm guardrails held before finishing.
allowed-tools: [tool.21, tool.22]
---
# Verification Before Completion

The atomic discipline every Acqu agent loads. Before you report a task complete, prove it actually is.

## Steps
1. **Restate the goal.** In one line, what was this run supposed to produce? If you can't, you don't yet know whether you're done.
2. **Check the output against the goal.** Read what you produced as if you were the founder receiving it. Does it answer the actual request, not a nearby one?
3. **Verify every claim against its source.** Each number, status, or assertion traces to a tool result or a knowledge file. No claim from memory. If you can't cite it, mark it unverified rather than stating it.
4. **Confirm the guardrails held.** Re-check the constraints your task carries (budget cap, autonomy gate, change limits, knowledge scope). If any action needed an approval tap, confirm it was queued — never silently executed.
5. **Surface what's broken or stale.** A missing or stale input is a finding, not something to hide. Say "X was unavailable" explicitly.

## Guardrails
- Unverified is a valid state — report it. A confident wrong answer is worse than a flagged gap.
- Never claim an action was taken that was only proposed. Distinguish "queued for approval" from "done."
- If verification fails, do not complete — fix or escalate.
- Verification is cheap relative to a wrong output reaching the founder or a client. Always run it.
