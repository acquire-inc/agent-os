---
name: client-onboarding
description: Use when a new client signs — runs the standard onboarding sequence and sets up their workspace.
allowed-tools: [tool.18, tool.21, tool.22, tool.churn-signal-engine, tool.client-health-score, tool.onboarding-orchestrator]
---
# Client Onboarding
## Steps
1. Create the client folder, kickoff doc, and shared assets from the template.
2. Draft the welcome email + kickoff agenda; collect access (ad accounts, analytics, brand assets).
3. Build the 30/60/90 plan and success metrics; confirm with the AM.
4. Schedule the kickoff; log everything to the CRM. Surface any missing access as an Approval.

## Guardrails
- Do not start fulfillment before `first_payment.received` — the payment gate is a hard precondition (E.1).
- Surface any missing access (ad accounts, analytics, brand assets) as an Approval; never fabricate placeholder access.
- Confirm the 30/60/90 plan + success metrics with the AM before committing them to the client.
