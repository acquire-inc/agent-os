---
name: connector-health
description: Use every 15 minutes — ping each tenant MCP, classify response as connected/degraded/needs_reauth/expired/down, write status + emit Relay events for transitions. Never auto-reauth.
---
# SKILL: Connector Health

The 15-minute heartbeat that keeps the fleet honest about which integrations actually work. Every agent that calls an MCP assumes the MCP is healthy; this skill is what makes that assumption safe.

## Purpose

For each MCP row in `mcps` for the current tenant, run a lightweight liveness probe, classify the result, and write the resulting health state back to the row. Emit `connector.health.degraded` / `connector.health.recovered` Relay events on transitions so downstream agents can react.

## Workflow

1. **Iterate every MCP** in `mcps` where `tenant_id = current_tenant` AND `enabled = true` AND `status != 'disconnected'` (disconnected MCPs are operator-paused; skip them).

2. **For each MCP, run a liveness probe specific to its transport:**
   - **`transport=http`** (Pipeboard × Meta, Slack, Close, Stripe, QuickBooks, Gmail, Google Drive, Google Calendar, Twilio, n8n, HubSpot, Notion, Apollo, Intercom, Airtable, GitHub, Linear, Sentry, Vercel, Telegram): HEAD or GET on the MCP's documented health endpoint (or the closest stable read endpoint — e.g., `/me` for OAuth providers). Expect 200-299 in <2s.
   - **`transport=stdio`** (pgvector Knowledge, Playwright): no network probe; instead check the last successful tool dispatch via this MCP from `audit_log` within the last 30 minutes. If none, mark as "stale-untested" (not a health failure, but worth surfacing).
   - **For OAuth MCPs**: check the OAuth credential's `expires_at` from `oauth_credentials` — if expiring within 24h, surface as `needs_reauth_soon` (Relay event `cred.expiring`).

3. **Classify the response into a state:**
   - **`connected`** — probe returned 2xx in <2s; credentials valid; no errors
   - **`degraded`** — probe returned 2xx but took 2-10s, or returned 5xx intermittently across 3 retries
   - **`needs_reauth`** — probe returned 401/403 indicating expired or revoked credentials
   - **`needs_reauth_soon`** — connected today but credential expires within 24h
   - **`down`** — probe timed out (>10s) or returned 5xx consistently across 3 retries
   - **`rate_limited`** — probe returned 429 (transient — schedule re-probe in 10min)

4. **Compare to the previous state** (read from `mcps.status`):
   - If state changed from `connected` → anything-else: emit `connector.health.degraded` Relay event with payload `{ mcp_id, name, prev_status: 'connected', new_status, probe_latency_ms, error_detail? }`
   - If state changed from anything-else → `connected`: emit `connector.health.recovered` Relay event with same payload shape
   - If state changed to `needs_reauth`: ALSO raise a finding (`category=access`, `severity=medium`, `title="MCP needs reauth: {name}"`)
   - If state stayed the same: no event (avoid event spam)

5. **Write the new state** to `mcps.status` + update `mcps.last_health_check` timestamp.

6. **At the end of the run, write a summary** to `kb:infra/connector-health/{date}.md` (append-mode; one block per 15-min run) — the daily health log:
   - Per-MCP: status, probe_latency_ms, error_detail (if any)
   - Trend: count of degraded events in the last 24h per MCP

7. **No Slack post on a healthy run.** Only emit a Slack message to #infra-alerts if at least one MCP transitioned to a non-connected state during this run.

## Rules

- **NEVER auto-reauth.** The credential refresh is the secrets-rotation agent's job, and even that is propose-gated for client OAuth (`tool.vault-rotate.requiresApproval=true`). connector-health is observation-only.
- **3 retries before classifying as `down`.** A single 5xx is usually transient; 3 in a row across 30s is a real outage.
- **No Slack message on a healthy run.** The Brief and the SPA dashboard surface health; #infra-alerts is for events. Otherwise the channel becomes noise.
- **Backoff on `rate_limited`.** Don't keep hammering — schedule a re-probe in 10 minutes; if still 429, scale to 30min, then 1h. Persistent 429 = raise as a finding (severity=low, title="MCP {name} sustained rate-limited >1h").
- **The probe should be free or near-free.** Don't burn API quota on health checks. Use HEAD where the provider supports it; use the smallest possible read endpoint otherwise.
- **Probe at most once per 15-min window per MCP.** If the agent runs more frequently, dedupe per-MCP.
- **Transient probe failures don't trigger findings.** Only state TRANSITIONS do. A single bad probe that recovers within 15min is invisible to the rest of the fleet — that's correct.
- **Surface `needs_reauth_soon` before it becomes `needs_reauth`.** The 24h window is the buffer for the operator to refresh proactively.

## Output contract

The connector-health-monitor's `run_summaries`:
- `deliverable_kind`: `health_check`
- `deliverable_ref`: path to `kb:infra/connector-health/{date}.md`
- `highlights`: `{ mcps_probed: <int>, mcps_connected: <int>, mcps_degraded: <int>, mcps_needs_reauth: <int>, mcps_needs_reauth_soon: <int>, mcps_down: <int>, state_transitions: <int>, p95_probe_latency_ms: <float> }`
- `summary_text`: one-line — "{n}/{total} MCPs healthy. {transitions} transitions this cycle." (Or, on a degraded run: "{transitions} degradations: {names}.")
