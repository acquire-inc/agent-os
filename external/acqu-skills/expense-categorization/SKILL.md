---
name: expense-categorization
description: Use daily 04:00 — pull yesterday's expenses from QuickBooks + Stripe + card feeds; categorize by COGS/G&A/marketing/payroll; flag anomalies; never auto-pay without approval.
---
# SKILL: Expense Categorization

The nightly expense-categorization pass that keeps the books clean and surfaces anomalies before they become a month-end surprise. Read-only — never pays, never reclassifies in QuickBooks without approval.

## Purpose

For every expense booked yesterday across QuickBooks + Stripe + business card feeds, apply the canonical chart-of-accounts categorization, flag anomalies (unusual vendors, unusual amounts, missing receipts), and write the day's expense state for the cash-position-monitor + margin-monitor to read.

## Workflow

1. **Pull yesterday's expense events:**
   - QuickBooks connector: all `expense` + `bill` records with `date = yesterday`
   - Stripe connector: all platform fees + processor fees for the day
   - Card feed (via QuickBooks Banking sync — or manual CSV upload to `kb:finance/card-feed/`): all card transactions for the day

2. **Apply the categorization rubric** (rules in `kb:finance/chart-of-accounts.md`):
   - **COGS** — direct delivery cost. Subcontractor invoices, client-specific media spend (pass-through), Browserbase usage for client work.
   - **Marketing** — Acqu's own ad spend, content tooling, sponsorships.
   - **Payroll** — W-2 + 1099 + retainers + benefits.
   - **G&A** — software (Slack, GitHub, etc.), office, legal, accounting, insurance.
   - **R&D** — tooling for Cliently product (separate from Acqu services delivery).
   - **Pass-through** — client-funded expenses we're invoicing back (must match an outbound invoice line; flag any mismatch).
   - **Unknown** — vendor not in `kb:finance/vendor-classifications.md`. Flag for founder review.

3. **For each expense, write the categorization** back to QuickBooks via the QuickBooks connector — **as a PROPOSED tag** (using QB's review queue), NOT a hard write. The bookkeeper or founder approves. Auto-write is forbidden — a misclassification in QB is hard to undo and audit-visible.

4. **Flag anomalies** — emit `finding.recorded` for each:
   - **Unusual vendor** (not seen in the last 90 days) → severity=low; payload includes vendor name + amount + which account it hit.
   - **Unusual amount** (>3× the rolling 90-day median for that vendor) → severity=medium; payload includes the historical pattern.
   - **Missing receipt** (transaction over $50 without attached doc) → severity=low; payload references the QB record ID.
   - **Possible duplicate** (same vendor + same amount + within 5 days) → severity=medium; payload includes both transaction IDs.
   - **Wrong-category candidate** (vendor previously classified as G&A but the transaction memo suggests marketing) → severity=low; payload includes both candidate categories.

5. **Write the daily expense state** to `kb:finance/expenses/{date}.md`:
   - Total spend yesterday, by category
   - Cumulative month-to-date, by category, vs budget
   - Anomaly count by severity
   - Top 5 unusual transactions of the day

6. **Post a 2-line Slack summary** to #finance (read-only — no actions in the summary): "Yesterday: $X across {n} transactions. Anomalies: {count} (see kb:finance/expenses/{date}.md). MTD spend: $Y vs $Z budget — {pct}% of monthly."

## Rules

- **Read-only mode on QuickBooks writes.** Categorization tags go to QB's review queue, never to a hard write. The bookkeeper or founder approves.
- **Pass-through expenses must match a billable line.** If a client-funded expense doesn't have a corresponding outbound invoice line within 7 days, raise a finding (severity=high — this is revenue leakage).
- **Always tag the vendor lookup result.** If you're guessing on a vendor's category, mark the categorization as "tentative — needs founder review." Don't hide uncertainty.
- **Never tag an expense as "pass-through" without seeing the matching invoice.** Auto-classification of pass-through is the most common cleanup task at year-end; do it right at the source.
- **The card feed is dirty data.** Expect mis-merged transactions, descriptions that don't match the vendor, currency conversions baked into the amount. Sanity-check every $1000+ transaction against the QB record before tagging.
- **No financial advice in the Slack summary.** State facts: "MTD spend is at X% of budget." DON'T editorialize ("we should cut Y"). That's margin-monitor's job, or the founder's.

## Output contract

The expense-tracker's `run_summaries`:
- `deliverable_kind`: `expense_run`
- `deliverable_ref`: path to `kb:finance/expenses/{date}.md`
- `highlights`: `{ total_spend_usd: <float>, mtd_spend_usd: <float>, mtd_budget_usd: <float>, mtd_pct_of_budget: <float>, anomaly_count: <int>, unusual_vendor_count: <int>, possible_duplicate_count: <int>, pass_through_unmatched_count: <int> }`
- `summary_text`: one-line — "$X spent yesterday across {n} tx; MTD at {pct}% of budget; {anomaly_count} anomalies flagged."
