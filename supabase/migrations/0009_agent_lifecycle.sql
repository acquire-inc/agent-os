-- 0009_agent_lifecycle.sql
-- First-class lifecycle states for the workforce layer (the agent-architect / org-design loop).
-- Until now an agent was only enabled/disabled; "the team hires/benches/fires agents like a
-- company" needs a real status so a *proposed* (not-yet-approved) agent is distinct from an
-- *archived* (retired) one and from a *paused* (benched) one.
--
-- Additive + backfilled to 'active' → existing rows, RLS policies, and the scheduler's
-- `enabled` gate are all unaffected. `enabled` stays the runtime on/off switch; `status`
-- carries the lifecycle intent the workforce tools mutate.
alter table agents add column if not exists status text not null default 'active';

-- proposed → awaiting human approval to go live (created by spawn-agent, enabled=false)
-- active   → live (enabled=true)
-- paused   → benched, reversible (enabled=false)
-- archived → retired/fired, terminal unless reactivated (enabled=false)
alter table agents drop constraint if exists agents_status_check;
alter table agents add constraint agents_status_check
  check (status in ('proposed', 'active', 'paused', 'archived'));

-- A proposed agent must never be runnable until a human approves it (defense in depth,
-- mirrors the autonomy gate). enabled=true is only legal for active agents.
alter table agents drop constraint if exists agents_enabled_status_check;
alter table agents add constraint agents_enabled_status_check
  check (not (enabled and status <> 'active'));
