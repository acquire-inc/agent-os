# Phase 46 — Pre-run cost forecasting

Pure module `packages/core/src/router/cost-forecast.ts`:
- `forecastRunCost(model, tokens)` -> `{ inputCostUsd, outputCostUsd, totalUsd }`
- `compareForecasts({ catalog, tokens, profile?, budgetCapUsd? })` -> ranked candidates with forecasts + `withinBudget` flag

When `profile` is supplied, candidates are ranked by value (picker score); the recommended pick is the highest-value candidate that fits the budget cap. When no profile, candidates are sorted by cheapest-first.

API endpoint: `POST /api/admin/models/forecast` body `{ tokens, profile?, budgetCapUsd? }`. The chat workspace calls this BEFORE dispatch so the operator sees "this Sonnet pick will cost ~$0.04; the cheap alternative costs $0.003" and can confirm or pivot.

21 assertions across 6 groups.
