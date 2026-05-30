# Assessment — aligning agent-os to `agentic-templates-restructure-v2-stack-alignment`

*2026-05-30. Evidence is verbatim from the uploaded zip (sub-agent extractions). An earlier
sub-agent "digest" hallucinated a clean frontmatter schema — this assessment supersedes it and
is based only on quoted file content.*

## What the uploaded repo actually is

Not the agent-doctrine repo we expected. It's a **Python autonomous agency-build factory** —
"the Agentic Solution build loop": take a client intake (meeting notes + questionnaire + brief)
and run an end-to-end autonomous build (websites, CRMs, lead pipelines, voice agents) with one
human pause point per credential. Verified components:

- `agentic_build/` — orchestrator (autonomous_driver, classifier, intake_parser, pause_policy,
  cost_ceiling, retro_runner, rescue_mode, factory_mode) + `skills/*/SKILL.md` + `rubrics/` + `fix_strategies/`.
- `build_lib/` — hardened lib (agent_runner, budget, vault, manifest, idempotency, spec_io, voice_lint, tracks/).
- `.planning/` — **GSD** artifacts (PROJECT/ROADMAP/STATE/REQUIREMENTS, phases/, research/, HANDOFF.json). They use GSD too — validates our adoption.
- `templates/agent-sdk-base/` (43 files) — a **TypeScript Anthropic Agent SDK base project** (src/tools/, migrations, middleware). The "stack alignment".
- `managed-agents-registry.json` — 29 agents: `{id, version, name, model, filename, status, system_prompt_length}` + `deployment_order[]`.
- `schemas/*.schema.json` — build-spec.v2, client-build-spec, client-questionnaire (JSON Schema).
- `knowledge-base/` — playbooks/known_issues/lessons/decision_records + INDEX.md + BEFORE_YOU_BUILD.md, mandatory YAML frontmatter.
- `website-factory/` — generation factory; `agents/*.md` are SDK subagents.

## Verbatim conventions worth adopting

1. **Agent files = SDK subagent format.** `website-factory/agents/*.md` have YAML frontmatter with
   exactly `name`, `description`, `model` + a prose body. (Claude Agent SDK `.claude/agents/*.md`.)
2. **Skills = SKILL.md** with frontmatter `name`, `description`, optional `argument-hint`,
   `allowed-tools: [...]`; body uses `<objective>/<execution_context>/<context>/<process>` tags;
   domain logic lives in code, the skill is a thin orchestration layer.
3. **MCP = `.claude/mcp.json`** standard form: `mcpServers: { <name>: { command, args, env } }`
   (e.g. n8n via `npx @anthropic/n8n-mcp-server`, `N8N_BASE_URL`).
4. **Managed Agents (beta `managed-agents-2026-04-01`)** is the live runtime + a JSON registry manifest.
5. **Credential namespacing:** `AGENTIC_<KEY>` = infra (resolve silently, fail loud if missing);
   `CLIENT_<SLUG>_<KEY>` = per-client (missing → PAUSE + human paste-back). Vault `~/.agentic-vault.env`.
6. **Cost ceiling** ($15k/build) hard-halt + re-approval pause. **Pricing floors** $5k / $25k.
7. **Brand-voice gate** (`voice_lint.py`): no em-dashes; banned phrases (delve into, leverage,
   elevate your, robust solution, let's dive in, …) hard-fail before delivery.
8. **JSON Schema validation** of every spec; **KB** files carry frontmatter + an INDEX + decision_records.

## Recommended enhancements to how we build agents (prioritized)

| # | Enhancement | Why it's leverage | Size |
|---|---|---|---|
| **A** | **SDK-native agent export** — emit each registry agent as `.claude/agents/<key>.md` (frontmatter `name/description/model/tools` from `agent_tools` + body=current prompt) + a `managed-agents-registry.json` manifest | Makes our DB agents portable to the Agent SDK / Managed Agents runtime; human-diffable; matches the repo's structure exactly. "Structured correctly." | M |
| **B** | **Skill `allowed-tools`** — tie skills→tools (least privilege) in the skill record/files | We have tools registry + agent_tools; this closes the skill→tool link the repo standardizes | S |
| **C** | **Credential namespacing** — formalize `AGENTIC_*` (infra) vs `CLIENT_<tenant>_*` (per-tenant, pause-on-missing) in the vault/connector layer; pause = an approval gate | Clean multi-tenant secrets model; maps onto our vault + safety hooks | M |
| **D** | **`tool.voice-lint`** — deterministic brand-voice gate, bound to content agents, enforced in a hook | Stops banned phrases/em-dashes in client-facing output; cheap, high-trust | S |
| **E** | **Cost-ceiling pause** — at `budget_cap_usd`, pause for re-approval (not only kill) | Recovers expensive runs instead of discarding; we already enforce the cap server-side | S |
| **F** | **`ManagedAgentsRunner`** — second `Runner` backend behind our interface (beta header) | Doctrine names Managed Agents as the swappable runtime; repo proves it out | L |
| **G** | **JSON Schema for agent/tool/skill records** — validate seeds against a schema | Catches drift; the repo validates every spec this way | S |

## Sequencing

A is the keystone (everything downstream — Managed Agents F, schema G — builds on a clean
SDK-native representation). Do **A → G → B → D → E**, then **C** and **F** as larger tracks.
Phase 8 (eval suites) remains the open v2 item and is independent of this track.
