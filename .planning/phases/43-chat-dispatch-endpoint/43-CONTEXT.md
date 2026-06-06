# Phase 43 — Chat-dispatch surface

`POST /api/admin/chat/dispatch`. The missing front-end → backend bridge for the chat workspace the operator described ("interface where we can chat and then automatically spin up agents").

Body: `{ intent, profile, agentKey?, dryRun? }`. Returns recommendation (pick + ranked alternatives + filtered) AND, when `agentKey` is provided + `dryRun` is false, inserts a `runs` row with `triggerSource: "chat"`. The runner picks it up via the existing `/api/agents/:id/next` claim path; the run's `summary` carries the chat intent.

Three modes operators can hit:
- no agentKey -> recommendation only
- agentKey + dryRun:true -> recommendation + agent confirmation
- agentKey + dryRun:false -> dispatched run id returned
