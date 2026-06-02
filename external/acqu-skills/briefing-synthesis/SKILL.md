---
name: briefing-synthesis
description: Use daily 08:00 — synthesize vitals + ad-ops + inbox + flagged findings into the founder's morning Brief. One screen, three sections, scannable in 90 seconds. Never editorialize what's actually a vitals job.
---
# SKILL: Briefing Synthesis

The 08:00 founder Brief. Compiles the outputs of vitals (06:30), ad-ops (07:00), EA's inbox triage (08:00 pass), and any open findings from the last 24h into one Slack message + a kb doc. The founder reads ONE thing at 08:00; this is it.

## Purpose

The Brief is NOT the vitals (numbers + targets — that's the 06:30 vitals agent). The Brief is the SYNTHESIS: what do the numbers + ad-ops + inbox + findings TOGETHER say about today's most important call, and what should the founder DO?

## Workflow

1. **Pull the upstream artifacts** (the briefing agent's knowledgeScope folders include all of these):
   - vitals `run_summaries` from today (the 06:30 run) — headline, the 6 numbers, watch (2), celebrate (1)
   - ad-ops `run_summaries` from today (the 07:00 run) — proposed batch, most-important call
   - EA inbox triage (the 08:00 pass if it ran before you; else handle inbox separately) — top action items
   - Any `finding.recorded` events from `relay_events` in the last 24h with severity ≥ medium
   - Any `approval.requested` events open >12h (something is waiting)

2. **Synthesize across the inputs** — what's the THROUGH-LINE?
   - Are the numbers telling the same story as ad-ops? (E.g., vitals shows CPL up 30%; ad-ops proposes a kill batch addressing it → through-line: "creative fatigue caught and addressed.")
   - Is there a contradiction? (E.g., vitals shows leads up; ad-ops proposes scaling; but ar-aging shows revenue NOT up → through-line: "lead volume up but close rate down; investigate.")
   - Are findings + approvals piling up in one domain? (E.g., 3 findings + 1 approval all on the compliance side → through-line: "compliance load building; needs a half-day of founder attention.")
   - If no through-line — say so plainly. "Quiet day. Numbers on track, ad-ops batch is routine. Use today to ship the offers work."

3. **Assemble the Brief in the canonical 3-section shape:**

   ```
   📊 *MORNING BRIEF — {date}*
   
   *The Call*  ← one sentence; the through-line
   {one-line synthesis}
   
   *Today's State (one screen)*
   • Vitals: {one-line — link to vitals doc for the full number set}
   • Ad-Ops: {one-line — link to proposal queue}
   • Inbox: {one-line — link to triage}
   • Open findings (last 24h): {count} ({brief category breakdown})
   • Waiting on you: {open approvals list, oldest first}
   
   *Recommended Action*  ← one OR two things
   1. {specific action}
   2. {optional second action — only if both genuinely high-leverage}
   ```

4. **Post to Slack #morning-brief** via the Slack connector at 08:00 sharp. Mention @founder.
5. **Save to `kb:reports/briefs/{date}.md`** as the durable record.

## Rules

- **One screen.** The founder reads this in 90 seconds. If your Brief takes 3 screens of scroll, you've failed. Cut.
- **The Call leads.** Top of the Brief. One sentence. The synthesis. If you don't have a synthesis, write "Quiet day" or "Mixed signals; no clear call yet."
- **Never repeat the numbers verbatim from vitals.** The vitals doc has those — link. The Brief is one level UP from the numbers — what they MEAN together.
- **Never editorialize on what's actually vitals' job.** "Spend is over budget" is vitals' line. "Spend is over budget AND ad-ops can't address it without a creative-pipeline reset by Friday" is briefing's line — that's synthesis.
- **Recommended Actions: max 2.** More than 2 = founder will pick one and ignore the rest. If everything is a priority, nothing is.
- **If a finding is severity=critical, lead with it.** The Call becomes "Critical: {finding title}. {action}." Above the numbers, above ad-ops.
- **Specific, dated, measurable.** Same rule the offers stack runs by. "Ship Q3 pricing review by Thursday" beats "review pricing soon."
- **Never write the Brief without first checking the Relay for new findings since yesterday's Brief.** A regression hiding in the noise becomes a critical finding the next morning.

## Output contract

The briefing agent's `run_summaries`:
- `deliverable_kind`: `brief`
- `deliverable_ref`: path to `kb:reports/briefs/{date}.md` AND the Slack message permalink
- `highlights`: `{ the_call: <string>, recommended_actions: [<string>...], finding_count_last_24h: <int>, open_approvals: <int>, through_line: <string> }`
- `summary_text`: one-line — the same string as "The Call" from the Brief.
