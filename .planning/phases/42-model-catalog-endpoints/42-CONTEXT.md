# Phase 42 — Operator-facing model catalog endpoints

Two new admin endpoints expose the model catalog to the operator dashboard + chat workspace front-end:
- `GET /api/admin/models?status=&provider=` — list catalog with optional filters
- `POST /api/admin/models/recommend` — body `{ profile: TaskProfile, options? }`; runs `pickBestModel` and returns ranked candidates with rationale + filtered metadata

Both admin-gated. The recommend endpoint accepts any TaskProfile shape the picker understands (capabilities, requires, costSensitivity, qualityFloor, maxCostIndex).
