---
name: dunning-sequence
description: Use on a payment-failure event or the daily sweep to recover failed payments before they churn — classify the failure, run the smart-retry + card-update ladder from policy, and escalate unrecovered accounts without ever shaming the client.
allowed-tools: [tool.18, tool.21, tool.22, tool.ar-ledger, tool.billing-engine, tool.dunning-engine]
---
# Dunning Sequence

Recover a failed payment before it silently becomes a churned client. Recovered revenue is the cheapest revenue in the business — run the ladder with priority and warmth.

## Steps
1. **Classify the failure:** hard decline (card cancelled/closed), soft decline (insufficient funds, temporary), or expired card.
2. **Run the recovery ladder** from `kb:finance/dunning-policy.md`:
   - Soft decline → smart retry (2 days, then 4 days — never retry instantly).
   - Expired/hard → friendly card-update request from `kb:finance/dunning-templates/` with a self-serve update link, via SMS + email.
   - Day 7 unrecovered → personal note from PM (drafted and queued).
   - Day 14 unrecovered → escalate: pause the account (block client-facing agent runs for that tenant) and route to the founder for a save-conversation.
3. **On recovery:** stop the sequence immediately, resume the account, and confirm to the client warmly (no shaming).
4. **Log every step** to Close + the AR ledger. Flag repeat-failure tenants as a churn signal and hand to the churn-risk path (D2.3).

## Guardrails
- Never shame. A failed card is usually an oversight, not a decision to leave.
- Smart retries, not aggressive ones — card networks penalize hammering.
- Client-facing comms stay at `propose` until templates are proven; account-pause escalation always routes to a human.
- A repeat-failure client is a churn-risk client — always tell retention.
