---
name: access-audit
description: Use weekly on Wednesday 05:00 — inventory every grant; flag over-broad scopes and orphan credentials older than 30 days.
---
# SKILL: Access Audit

## Purpose
Apply least-privilege across every grant in the system. Surface orphaned OAuth credentials (archived agents >30 days still holding live tokens), over-scoped agents, and dangling tenant-member rows. This audit protects clients' data as much as Acqu's.

## Workflow
1. Run `tool.access-audit` with `{ tenantId }`. The SQL joins `oauth_credentials → agent_mcps → agents → mcps` and filters `lifecycle_state = 'archived' AND lifecycle_changed_at < now() - interval '30 days'`. Phase 8.5 keeps recent archives' bindings for history — only >30d ones surface.
2. For each row in the result:
   - Score by risk: client OAuth > internal MCP credential.
   - Call `recordFinding({ category: "access", severity: "high" | "medium", title: "orphan grant: <mcp_name> bound to archived agent <agent_key>", payload: row })`.
3. Cross-reference each agent's `knowledge_scope` + bound tools + bound MCPs against its job description. Over-scoped (e.g. `ads_management` when the job needs `ads_read`) is a finding.
4. Verify every active human in `tenant_members` still belongs (no departed-employee rows).
5. Output: `kb:security/access-audit-{week}.md`. Slack `#security` with findings ranked by risk.

## Rules
- Least privilege is the standard. Every excess grant is a finding.
- A churned tenant's credentials must be revoked — flag any that linger.
- Pitfall 4 mitigation lives in the SQL: do NOT lower the 30-day grace window without explicit approval; Phase 8.5 archived-binding history depends on it.
- This skill consumes `tool.access-audit` output; it does NOT mutate state. Revocations go through `secrets-rotation` (which is propose-gated).
