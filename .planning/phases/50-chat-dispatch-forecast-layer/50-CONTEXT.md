# Phase 50 — Chat dispatch + cost forecast integration

`POST /api/admin/chat/dispatch` accepts optional `tokens: { inputTokens, outputTokens }` and `budgetCapUsd` body fields. When supplied, the response includes a `forecast` field — the full `compareForecasts` result with per-candidate USD costs and `withinBudget` flags. The front-end chat workspace can now render "this Sonnet pick will cost ~$0.04 for your expected token mix; flash is $0.001" before dispatch.
