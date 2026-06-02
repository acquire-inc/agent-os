---
name: clarify-before-acting
description: Load on any agent that can act. When intent is ambiguous or the next action is irreversible/side-effecting, STOP and raise one multiple-choice Approval before proceeding — never guess on something you can't take back.
allowed-tools: [tool.17, tool.21, tool.22]
---
# Clarify Before Acting

The discipline that keeps an autonomous agent from guessing on the irreversible. When the path forks and the wrong branch is costly or unrecoverable, ask — don't assume. This is the partner skill to `verification-before-completion`: that one checks work after the fact; this one stops a bad action before it happens.

## When to load
Trigger this skill when **any** of these is true:
- **Ambiguous intent** — more than one reasonable reading of what was actually wanted.
- **Irreversible / side-effecting action** — it spends money, sends an external message, launches or changes ads, writes or sends a contract, or mutates another system. (These are the registry tools marked `requires_approval` + not `reversible`.)
- **Uncertain guardrail** — you're not sure the action is within budget cap, autonomy tier, or knowledge scope.

Read-only or reversible analysis does **not** need this — clarify only when a wrong guess is expensive.

## Steps
1. **Name the fork.** State, in one line, the specific decision you cannot make confidently and why — ambiguous intent or irreversible action.
2. **Frame 2–4 concrete options.** Each is a specific, executable choice (not "yes/no"). **Always include an explicit "do nothing / hold" option.**
3. **Raise ONE approval, not a conversation.** Emit a single multiple-choice Approval via the Slack Approvals bridge (`tool.17`): the question, the options, your **recommended** option with a one-line rationale, and what each option will cause.
4. **Suspend — do not proceed.** Stop the run at the gate (status `waiting`); the autonomy gate persists the session so it can resume. Never take the irreversible action while waiting on the answer.
5. **Act exactly as chosen.** On resume, execute the selected option verbatim. If "do nothing" was chosen, record why and complete without acting.

## Guardrails
- One well-framed question beats five round-trips — batch the decision into a single multiple-choice ask.
- **Absence of an answer is "do nothing", never "proceed".** Never guess on an irreversible action.
- Don't ask when you don't need to: clarifying a reversible, low-stakes step just adds latency. Reserve this for the genuinely ambiguous or irreversible.
- The recommended option must be honest — recommend what you'd actually choose, name the risk, let the human override.
- In your run summary, distinguish **"proposed / queued for approval"** from **"done"** — a proposal is not an action taken.
