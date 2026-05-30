# Acqu / Cliently — Agent OS Build Spec

> **What this is:** the engineering build spec for the Agent OS *platform*. This is the document you feed to Claude Code, one session at a time. It is **not** the doctrine. The doctrine (`acqu-agent-doctrine.md` + `-v2.md`) is the business *what/why* — the functions, agents, and prompts. This spec is the platform *how* — the data model, the runner, the safety layer, and the build sequence. Both live in `/docs`. Sessions read the slice they need.
>
> **The thesis this spec exists to enforce:** agents are **data**, not code. The OS is a multi-tenant control plane that *executes* agents defined as registry records + system prompts + skill files. Build the control plane once. Then every one of the ~70 agents in the doctrine is configuration — usually zero new application code.

---

## 0. The build philosophy (read this first, every session)

1. **One coherent system, built in bounded sessions.** The OS is one codebase. Build it in ~5 focused Claude Code sessions, each with a single deliverable and acceptance test. Each session ends with `main` green and committed. Never one 12-hour mega-session (context dies); never one-session-per-agent (agents aren't code).

2. **Agents are data.** The moment you find yourself writing a new code module to add an agent from the doctrine, stop — you're doing it wrong. Adding an agent = a row in `agents`, a system prompt, skill files, trigger config. The only code that changes per-agent is a genuinely new *deterministic tool* (and those are shared across agents).

3. **Docs live in the repo; sessions read on demand.** Both doctrine files go in `/docs`. `CLAUDE.md` (repo root) orients every session. Never paste large docs into the prompt — point Claude Code at the file + the section.

4. **The runtime is abstracted.** All agent execution goes through a `Runner` interface. Implementation v1 = Claude Agent SDK directly. Future = Claude Managed Agents (beta, server-side stateful sandboxes) or self-hosted. The OS control plane never imports the SDK directly — only the `Runner` impl does.

5. **Safety is enforced by hooks, not hope.** Autonomy levels, approval gates, and budget caps are enforced in SDK hooks (PreToolUse / PostToolUse / Stop / SessionEnd), so an agent *cannot* bypass them by misbehaving in its prompt.

---

## 1. Stack (the established decisions)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | One language across app + tools + runner |
| App framework | TanStack Start | SSR + API routes; the control-plane UI + API |
| DB | Postgres + `pgvector` | Multi-tenant, RLS-enforced; vector store for knowledge |
| ORM | Drizzle | Typed schema + migrations |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` | Agent loop, tools, hooks, sessions, subagents |
| Auth to Anthropic | **API key** | Customer-facing (Cliently) requires API-key auth, not subscription. Acqu-internal could use SDK credits, but build for API-key from day one. |
| Connectors | MCP | Close, Pipeboard×Meta, Slack, Google Drive, n8n (already connected) |
| Containerization | Docker | Runner workers + app |
| Queue/scheduler | Postgres-backed job table + a worker loop (start simple); graduate to a real queue later | |

Alt path (if you want to move faster on infra and accept the tradeoffs): Lovable + Supabase for the app + DB + RLS, with the runner as a separate Node service. Same data model. Decide before Session 0; don't mix.

**Model tiering** (enforce in agent config, never by default):
- `claude-haiku-4-5` — triage, monitors, classification (~80% of runs)
- `claude-sonnet-4-6` — default working model (~18%)
- `claude-opus-4-8` — heavy reasoning, decision memos, pricing, offer architecture (~2%) *(doctrine says 4-7; 4-8 is the current top tier — use it for the opus slot)*

**Cost levers, wired into the runner:** prompt caching on the static system-prompt + per-tenant knowledge bundle; Batch API for non-real-time agents; per-agent `budget_cap_usd`; `/clear`-equivalent between dispatches (fresh session per run by default).

---

## 2. The architecture — control plane vs. runtime

```
┌─────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (the OS — you build this)                     │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Registries  │  │  Knowledge   │  │  Scheduler   │         │
│  │ agents/tools │  │  + skills    │  │  routines    │         │
│  │ mcp/tenants  │  │  (pgvector)  │  │  triggers    │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │                 │
│  ┌──────┴─────────────────┴─────────────────┴──────┐          │
│  │           Orchestrator                           │          │
│  │  resolves an agent + trigger → builds the        │          │
│  │  context bundle → invokes Runner → records run   │          │
│  └──────────────────────┬───────────────────────────┘          │
│                         │                                      │
│  ┌──────────────────────┴───────────────────────────┐          │
│  │  Safety + Observability (SDK hooks)              │          │
│  │  autonomy gate · approval bridge · budget cap ·  │          │
│  │  audit log · run-summary writer                  │          │
│  └──────────────────────┬───────────────────────────┘          │
└─────────────────────────┼──────────────────────────────────────┘
                          │  Runner interface
┌─────────────────────────┴──────────────────────────────────────┐
│  RUNTIME  (swappable; v1 = Agent SDK)                          │
│  Agent SDK process → model + built-in tools + MCP + sandbox    │
└─────────────────────────────────────────────────────────────┘
```

The control plane is identical regardless of runtime. Only the `Runner` impl changes if you adopt Managed Agents later.

---

## 3. The data model (Session 1 — the spine)

Every table carries `tenant_id`. RLS on every table. This is the foundation; get it right.

```sql
-- TENANCY
tenants            (id, name, kind['acqu'|'cliently'|'client'], status, created_at)
projects           (id, tenant_id, name, slug)                       -- Ad-Ops, Founder Ops, etc.

-- AGENT REGISTRY (agents are DATA)
agents             (id, tenant_id, project_id, agent_key, name, replaces,
                    one_line_job, model, thinking_level, backend,
                    autonomy['propose'|'execute_safe'|'execute_full'],
                    budget_cap_usd, monthly_cap_usd, status, version,
                    sandbox_name, created_at)
agent_prompts      (id, agent_id, version, system_prompt, created_at)  -- versioned
agent_triggers     (id, agent_id, type['cron'|'webhook'|'state'|'on_demand'],
                    schedule, event_key)
agent_tool_bindings(id, agent_id, tool_key)                            -- which tools this agent may call
agent_mcp_bindings (id, agent_id, mcp_key)
agent_skills       (id, agent_id, skill_key, skill_version)
agent_knowledge_scope (id, agent_id, folder, tag)                      -- retrieval scope

-- TOOL REGISTRY (deterministic tools, shared)
tools              (id, tenant_id?, tool_key, name, description, kind['custom'|'mcp'],
                    input_schema, requires_approval, reversible, status)
mcp_connections    (id, tenant_id, mcp_key, url, auth_ref, status, last_health)

-- KNOWLEDGE + SKILLS
knowledge_docs     (id, tenant_id, project_id, title, type, tags[], folder,
                    body, sensitivity, version, owner, last_updated)
knowledge_vectors  (id, doc_id, chunk, embedding vector, metadata)     -- pgvector
skills             (id, skill_key, version, description, owner, body,    -- the SKILL.md registry
                    mcps_required[], tools_required[])

-- SCHEDULING
routines           (id, tenant_id, name, cron, enabled)
routine_steps      (id, routine_id, agent_id, order)
job_queue          (id, tenant_id, agent_id, trigger_id, scheduled_for,
                    state['queued'|'running'|'done'|'failed'|'stuck'], payload, claimed_by)

-- EXECUTION + OBSERVABILITY
runs               (id, tenant_id, agent_id, trigger_id, started_at, ended_at,
                    status, model, cost_usd, tokens_in, tokens_out, sdk_session_id)
run_summaries      (id, run_id, what_i_did, what_i_produced, what_i_learned,
                    whats_next, verification, raw_md)
tool_calls         (id, run_id, tool_key, input, output_ref, approved_by, at)
audit_log          (id, tenant_id, run_id, actor, action, detail, at)

-- SAFETY
approvals          (id, tenant_id, run_id, agent_id, action_summary, diff,
                    state['pending'|'approved'|'rejected'], decided_by, decided_at,
                    slack_ts)                                          -- the approval bridge
autonomy_events    (id, agent_id, from_level, to_level, reason, at)    -- promotions/demotions
agent_metrics      (id, agent_id, date, runs, success_rate, approval_rate,
                    error_rate, cost_usd, p95_latency_ms)              -- the scorecard
```

**RLS rule:** every query is scoped by `tenant_id` from the session context. The acceptance test for Session 1 is: *a query authenticated as tenant A returns zero rows from tenant B, across every table, including the vector store and the runner's view.*

---

## 4. The Runner interface (Session 2 — the heart)

```typescript
interface Runner {
  run(input: {
    agent: AgentConfig;          // resolved from the registry
    contextBundle: ContextBundle;// assembled by the orchestrator (below)
    hooks: RunHooks;             // safety + observability callbacks
    budgetCapUsd: number;
  }): Promise<RunResult>;
}
```

**The orchestrator builds the `ContextBundle`** (this is the "/next bundle" pattern):
1. The agent's versioned `system_prompt` (cached).
2. Scoped knowledge: vector-retrieve from `knowledge_docs` limited to the agent's `knowledge_scope` (folders + tags). Never retrieve cross-project.
3. Recent `run_summaries` for this agent+tenant (continuity).
4. The agent's tool list (custom tools + MCP bindings).
5. Per-tenant/per-customer "call options" variables.
6. Fresh, short-TTL credentials for its MCP connections (never long-lived tokens in context).

**The SDK Runner impl** wires the bundle into `@anthropic-ai/claude-agent-sdk`:
- `systemPrompt` = bundle's prompt; enable prompt caching.
- `allowedTools` = the agent's bound tools (+ `Agent`/`Task` if it may spawn subagents like adversarial critics).
- `mcpServers` = the agent's MCP bindings.
- `hooks` = the safety layer (Section 5).
- `model` = the agent's tier.
- Fresh session per run by default (`/clear` discipline); `resume`/`forkSession` only where the doctrine calls for stateful continuity (e.g. multi-day onboarding-runner).
- Adversarial critics (creative-critic, offer-validator) are **subagents** invoked via the Agent tool — exactly the fresh-context review pattern.

**Acceptance test:** a trivial agent runs end-to-end, produces a `run_summary` row, records `cost_usd`, and is killed if it exceeds `budget_cap_usd`.

---

## 5. The safety layer (Session 3 — via SDK hooks)

This is where the autonomy ladder + approval bridge + budget caps live. Hooks make them un-bypassable.

| Hook | Enforces |
|---|---|
| `PreToolUse` | **Autonomy gate.** Look up the tool's `requires_approval` + the agent's `autonomy`. If the action is gated for this level → create an `approvals` row, post to Slack via the bridge, **block** the tool call, and park the run awaiting decision. |
| `PreToolUse` | **Budget guard.** If projected cost would exceed `budget_cap_usd` → stop the run. |
| `PostToolUse` | **Audit.** Write the tool call + result ref to `tool_calls` and `audit_log`. Large results saved to file/blob; store the ref, not the blob. |
| `Stop` / `SessionEnd` | **Run-summary writer.** Force the run-summary contract (what I did / produced / learned / next / verification) into `run_summaries`; finalize `cost_usd`, tokens, status. |

**The approval bridge** = `approvals` table + Slack mirror (the connected Slack MCP). A gated action posts a card with action summary + diff + one-tap approve/reject. On approve, the parked run resumes and the tool executes; on reject, the run records the rejection. **No approvals via DM; all logged.**

**The approval matrix** (from doctrine Part 3.3) is encoded as `tools.requires_approval` + per-level rules. Money, contracts, Meta kills/publishes, scope changes, hiring, pricing, cross-tenant access → always gated.

**Acceptance test:** a `propose`-level agent attempts a write → blocked → Slack card appears → on approve, the action executes; on reject, it doesn't. A `budget_cap_usd` breach kills the run mid-flight.

---

## 6. Capability layer (Session 4 — MCP + first custom tools)

- Register the 5 connected MCPs in `mcp_connections` and expose their tools through the tool registry so agents bind to them by `tool_key`.
- Build the first 2 **deterministic custom tools** end-to-end as the reference implementation for all 22 in the doctrine catalog. Recommended first two:
  1. **Run-Summary Writer** (`tool.22`) — already needed by every agent; trivial; proves the tool pattern.
  2. **Rules Engine** (`tool.4`) — the color-coded ad rules as code; high-value; proves a real business tool.
- Tool contract: every custom tool is a typed function with a JSON input schema, a `requires_approval` flag, a `reversible` flag, and it **saves large outputs to a file and returns the path** (never dumps into agent context).

**Acceptance test:** an agent calls a real MCP tool (e.g. read a Close opportunity) and a custom tool (Rules Engine) through the OS, with results audited.

---

## 7. First real agent as DATA + the scheduler (Session 5 — prove the thesis)

- Build the scheduler: the worker loop that claims due `job_queue` rows (cron + event triggers) and hands them to the orchestrator.
- Create the first production agent **with no new application code** — purely registry rows + a system prompt + skill files. Recommended: **`vitals`** (simplest: read metrics → post Slack snapshot) or **`ad-ops`** (higher value, slightly more setup).
- The system prompt comes straight from the doctrine. The skill files (`skill:morning-vitals`, etc.) are written as `SKILL.md` per the doctrine's skill template.

**Acceptance test — the whole thesis:** `vitals` runs on its 06:30 cron, assembles its bundle, calls its tools, posts to Slack, writes a run-summary — and you added it *without writing a code module*. From here, every doctrine agent is this same data operation.

---

## 8. After the OS core — the expansion model

Once Session 5 passes, the OS is real. Adding the rest of the doctrine's agents follows one of two paths:

- **Config-only (most agents):** registry rows + system prompt (from the doctrine) + skill files + triggers. No code session needed — do it through the OS UI or a seed script. You can batch-add a whole function's agents at once.
- **New-tool agents (some agents):** if an agent needs a deterministic tool that doesn't exist yet (e.g. `tool.billing-engine`, `tool.isolation-test-suite`), that's a small, bounded code session to build the *tool* (shared, reusable), after which the agent is config-only.

Map this to the doctrine's build phases (v2 Part F). The OS-core sessions above are the prerequisite for **all** of them. Then:
- Phase 1 agents (ad-ops, vitals, briefing, ea, expense-tracker, margin-monitor, **+ dunning-manager, connector-health-monitor, memory-consolidator**) — mostly config + a handful of tools.
- The three hard gates from v2 still apply: ad-claim-compliance before client ad launches; tenant-isolation-tester before external Cliently; dunning-manager before recurring billing.

---

## 9. How to run each Claude Code session (operating instructions)

For every session:

1. Open Claude Code in the repo. `CLAUDE.md` auto-loads and orients it.
2. Give it the session's scope in one line, and point it at this spec's section + any doctrine section it needs. Example:
   > "Build Session 1 from `/docs/acqu-os-build-spec.md` §3 — the multi-tenant data model with RLS. Read §3 and the tenancy notes in `/docs/acqu-agent-doctrine-v2.md` Part A. Write the Drizzle schema, migrations, RLS policies, and the cross-tenant isolation test. Don't build the runner yet."
3. Let it plan first (plan mode). Review the plan before it codes.
4. It reads files from `/docs` on demand — do not paste doc contents into the prompt.
5. End the session when the acceptance test passes. Commit. `main` stays green.
6. `/clear` between sessions so stale context doesn't carry over and inflate cost.

**Bounded scope per session is the whole discipline.** If a session's plan balloons beyond its one deliverable, cut it and split.

---

## 10. Reference

- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk/overview (hooks, subagents, sessions)
- Claude Managed Agents (beta, future Runner impl): https://platform.claude.com/docs/en/managed-agents/overview
- Claude Code: https://docs.claude.com/en/docs/claude-code/overview
- The doctrine: `/docs/acqu-agent-doctrine-v2.md` (architecture + new functions) and `/docs/acqu-agent-doctrine.md` (original 14 function specs + prompts)

---

## Appendix — the 5-session map at a glance

| Session | Deliverable | Acceptance test |
|---|---|---|
| 0 (+1) | Scaffold: repo, CLAUDE.md, Docker, Postgres+pgvector, Drizzle, CI, `/docs` | App boots, DB migrates, CI green |
| 1 | Multi-tenant data model + RLS | Cross-tenant read returns zero rows, everywhere |
| 2 | The Runner (SDK impl behind interface) + orchestrator/context-bundle | Trivial agent runs, writes run_summary, respects budget cap |
| 3 | Safety layer via hooks: autonomy gate + approval bridge + budget guard + audit | `propose` write blocked → Slack approve → executes; budget breach kills run |
| 4 | MCP registry + first 2 custom tools (Run-Summary Writer, Rules Engine) | Agent calls a real MCP tool + a custom tool, audited |
| 5 | Scheduler + first agent (`vitals`) as **data only** | `vitals` runs on cron, posts Slack, writes summary — zero new code modules |

After Session 5: every doctrine agent is config + skills (+ an occasional shared tool). The OS expands from there.
