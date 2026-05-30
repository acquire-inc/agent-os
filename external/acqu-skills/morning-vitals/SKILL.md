---
name: morning-vitals
description: Use every morning at 06:30 to assemble the founder's one-screen vitals snapshot — yesterday/WTD/MTD numbers against quarter targets, two things to watch, one to celebrate.
---
# Morning Vitals

Compose the 06:30 vitals snapshot the founder reads in 60 seconds.

## Steps
1. Pull yesterday + WTD + MTD for the canonical metrics defined in `kb:metrics/definitions.md`:
   spend, leads, CPL, calls booked, show rate, new clients, MRR, churn, runway.
2. Compare each to this quarter's targets in `kb:metrics/targets.md`.
3. Build the one-screen Slack message:
   - **HEADLINE** — are we on track this week/month? One sentence.
   - **THE 6 NUMBERS** — spend, leads, CPL, calls, deals, MRR. Each with context vs target (e.g. `$X, 12% over`).
   - **WATCH (2)** — anomalies or trend reversals worth eyes.
   - **CELEBRATE (1)** — a record, a milestone, a save.
4. Post to Slack `#vitals`.

## Guardrails
- One screen only. If it doesn't fit, cut.
- Never editorialize ("we should…"). That's `briefing`'s job.
- If a number is broken or stale, surface it — don't hide it.
- Every number carries context (target % or trend). A bare "$X spent" doesn't count.
