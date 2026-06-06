# Phase 47 — Artifacts surface

Migration 0023 + `artifacts` table + 3 endpoints. Closes the "output type of interface where all the artifacts the agents produce appear there" the operator described.

Schema: `(id, tenant_id, run_id, agent_id, kind, name, uri?, inline_payload?, metadata)`. `kind` is the renderer hint (file/doc/spreadsheet/image/link/json/markdown/code). Either `uri` or `inline_payload` must be set. RLS via `is_tenant_member()`.

Endpoints:
- `GET /api/admin/runs/:runId/artifacts` — per-run artifact list (newest first)
- `POST /api/admin/runs/:runId/artifacts` — register an artifact (the runner calls this at run close)
- `GET /api/admin/artifacts/recent?kind=&limit=` — tenant-wide feed for the "what did agents produce today" view
