-- v3 enhancement B — skill → allowed-tools (least privilege at the skill layer).
-- The uploaded agentic-templates repo declares `allowed-tools` in every SKILL.md frontmatter.
-- This column stores the tool keys a skill is permitted to drive, so an agent's effective tool
-- surface can be reasoned about as: its agent_tools, narrowed by what its skills allow.

alter table skills add column if not exists allowed_tools_json jsonb not null default '[]';
