---
name: secrets-rotation
description: Use daily at 04:00 and on connector-health expiry signals — rotate internal credentials on schedule; propose-gate every client OAuth rotation.
---
# SKILL: Secrets Rotation

## Purpose
Enforce short-TTL discipline across the OAuth vault. Rotate credentials before they expire (eager rotation), shorten TTLs that drift long, and ensure no agent run ever holds a long-lived token in context. For CLIENT credentials, NEVER rotate unilaterally — coordinate via the propose-gated `tool.vault-rotate` (requiresApproval=true).

## Workflow
1. Inventory credentials approaching expiry: select from `oauth_credentials` where `expires_at < now() + interval '24 hours'`.
2. For each credential, decide the rotation path:
   - **Internal/system credential**: invoke `tool.vault-rotate` directly. The handler calls `rotateCredential(db, key, mcpId, refresher)` — composes `decrypt → refresher → storeCredential`.
   - **Client OAuth (Meta/Stripe/Close on a client tenant)**: invoke `tool.vault-rotate` — the PreToolUse hook 1c will pause for human approval per v2 D5.3 L1254. Wait for the operator decision.
3. If `RotateResult.rotated === false`:
   - `no expiry — manual provider rotation required` → log; some providers (Slack, GitHub) don't issue rotating refresh tokens.
   - `no refresh token` → trigger needs_reauth flow.
   - `provider refresh failed` → recordFinding already wrote it (high severity); add a Slack `#security` alert.
4. Flag any access token whose TTL exceeds 300s in agent context — that violates the `makeBundleTokenResolver` contract (Pitfall 2).
5. Slack `#security` summary: rotations done + anything flagged.

## Rules
- Short-lived credentials per run are the default. A long-lived token in an agent's context is a finding.
- Never break a client connection without coordination — the propose-gating is the safety net, not the recipe.
- Stale credentials are findings, not chores — track every one to closure via `recordFinding`.
- Cron window is 04:00 daily for Pitfall 2 (race condition) — in-flight bundle tokens ≤300s TTL expire naturally; do not invalidate mid-run.
