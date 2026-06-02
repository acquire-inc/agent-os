---
name: expense-categorization
description: Use at the 04:00 sweep and on new-transaction webhooks to categorize expenses against the chart of accounts, match vendors, update the ledger, and alert when a category crosses 80% of its monthly budget.
allowed-tools: [tool.21, tool.22, tool.bill-pay-bridge, tool.expense-feed]
---
# Expense Categorization

Categorize every expense as it lands and keep the ledger clean — the bookkeeper's data-entry pass, done continuously.

## Steps
1. Pull new transactions from `tool.expense-feed`.
2. Categorize each against `kb:finance/chart-of-accounts.md`: Ads, Tools/SaaS, Payroll, Contractors, Infra, Office, Travel, Taxes, Other.
3. Match to a known vendor in `tool.vendor-registry`. If the vendor is new, flag it for `vendor-renewal-watcher` to investigate.
4. Update the ledger.
5. Compute MTD by category and compare to `kb:finance/budgets.md`.
6. If any category exceeds 80% of its monthly budget, post a Slack alert.

## Guardrails
- Categorize conservatively. If a transaction is unclear, file it as "Other" and flag it for human review — never guess into a real category.
- Never re-categorize a previously-tagged transaction without flagging it for review first.
- Every alert names the category, the MTD figure, and the budget it's measured against — no bare numbers.
