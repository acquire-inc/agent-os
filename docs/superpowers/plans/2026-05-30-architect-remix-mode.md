# Architect Remix Mode Implementation Plan

> **For agentic workers:** Use the executing-plans discipline to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mode: "remix"` to the Architect so an operator can rewrite an existing agent from a one-line instruction ("make briefing weekly", "switch dunning-manager to T-cheap"), with a "Remix this agent" affordance in the Agents UI.

**Architecture:** Remix re-uses the propose/seed pipeline — the LLM emits a single-agent blueprint whose `key` matches the base agent. `hydrate()` already clamps autonomy to `propose`, so a remix landing in DB demotes the agent until the operator re-approves. The base agent's current row is passed into the LLM prompt as context. The seeder is unchanged: `upsertAgent` already does the right thing by `tenant_id+key`.

**Tech Stack:** TypeScript, Hono (apps/api), React + TanStack Router (apps/control-plane), Drizzle, the existing `seedAgent` helper. No new deps.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/architect/prompt.ts` | Modify | Append base-agent context block when `mode==="remix"` |
| `packages/core/src/architect/index.ts` | Modify | `loadTenantContext` extended to fetch the base agent's full row when `baseAgentKey` is set |
| `packages/core/src/architect/architect.test.ts` | Modify | Add 4 assertions covering remix prompt shape + the "remix targets the same key" invariant |
| `apps/api/src/index.ts` | Modify | `proposeBlueprint` already takes `mode` + `baseAgentKey` from the body; no route change needed. Add one validation: 400 if `mode==="remix"` without `baseAgentKey`. |
| `apps/api/src/app.test.ts` | Modify | Add a remix happy-path test that asserts the seeded agent has the same `agentId` as the base (i.e. upsert reused the row) |
| `apps/control-plane/src/lib/api.ts` | Modify | `architect.propose` already accepts `mode` + `baseAgentKey`; expose a `remixAgent(key, instruction)` convenience |
| `apps/control-plane/src/routes/_app/agents.tsx` | Modify | Add a "Remix" button to the agent drawer (next to existing actions) that opens a small dialog → calls `remixAgent` → navigates to `/architect` with the new blueprint focused |
| `apps/control-plane/src/routes/_app/architect.tsx` | Modify | Accept `?focus=blueprintId` query param to auto-open that blueprint |

---

## Task 1: Architect prompt accepts base-agent context

**Files:**
- Modify: `packages/core/src/architect/prompt.ts`
- Modify: `packages/core/src/architect/index.ts`

- [ ] **Step 1: Modify `buildUserPrompt` to accept and render the base-agent row in remix mode**

  In `prompt.ts`, change the signature of `buildUserPrompt` to accept an optional `baseAgent` parameter and render it into the remix branch:

  ```ts
  export interface BaseAgentSummary {
    key: string;
    name: string;
    model: string;
    autonomy: string;
    systemPrompt: string;
    budgetCapUsd: string | null;
    cronSchedule: string | null;
  }

  export function buildUserPrompt(
    input: ArchitectInput,
    baseAgent?: BaseAgentSummary,
  ): string {
    if (input.mode === "remix" && input.baseAgentKey) {
      const base = baseAgent
        ? `\nBASE AGENT (current row — produce a single-agent team that REPLACES this):
- key: ${baseAgent.key}     (MUST keep this key — remix targets the same row)
- name: ${baseAgent.name}
- model: ${baseAgent.model}
- autonomy: ${baseAgent.autonomy}
- budget: $${baseAgent.budgetCapUsd ?? "?"}
- cron: ${baseAgent.cronSchedule ?? "—"}
- current systemPrompt:
"""
${baseAgent.systemPrompt}
"""
`
        : `\n(base agent "${input.baseAgentKey}" not found on tenant — proceed with caller intent only)\n`;
      return `REMIX request — modify the existing agent below per the instruction. Return a single-agent team (one element in agents[]). MUST reuse the exact same key.\n${base}\nInstruction:\n${input.prompt}`;
    }
    if (input.mode === "single") {
      return `SINGLE-AGENT request — create exactly ONE new agent. Return a one-agent team.\n\nRequest:\n${input.prompt}`;
    }
    return `TEAM request — compose the coherent team this requires.\n\nRequest:\n${input.prompt}`;
  }
  ```

- [ ] **Step 2: Wire `proposeBlueprint` to load the base agent and pass it to `buildUserPrompt`**

  In `index.ts`, after `loadTenantContext(...)`, when input.mode === "remix" && input.baseAgentKey, fetch the base agent row + its current prompt + its cron trigger, then pass the resulting `BaseAgentSummary` into `buildUserPrompt`:

  ```ts
  async function loadBaseAgent(
    db: Db,
    tenantId: string,
    key: string,
  ): Promise<BaseAgentSummary | null> {
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.key, key)))
      .limit(1);
    if (!agent) return null;
    const [prompt] = await db
      .select()
      .from(schema.agentPrompts)
      .where(
        and(
          eq(schema.agentPrompts.agentId, agent.id),
          eq(schema.agentPrompts.isCurrent, true),
        ),
      )
      .limit(1);
    const [trigger] = await db
      .select()
      .from(schema.agentTriggers)
      .where(
        and(
          eq(schema.agentTriggers.agentId, agent.id),
          eq(schema.agentTriggers.type, "cron"),
        ),
      )
      .limit(1);
    return {
      key: agent.key,
      name: agent.name,
      model: agent.model,
      autonomy: agent.autonomy,
      systemPrompt: prompt?.systemPrompt ?? agent.persona ?? "",
      budgetCapUsd: agent.budgetCapUsd,
      cronSchedule: trigger?.schedule ?? null,
    };
  }
  ```

  Then in `proposeBlueprint`, before the LLM loop:

  ```ts
  let baseAgent: BaseAgentSummary | undefined;
  if (input.mode === "remix" && input.baseAgentKey) {
    baseAgent = (await loadBaseAgent(deps.db, input.tenantId, input.baseAgentKey)) ?? undefined;
  }
  const user = buildUserPrompt(input, baseAgent);
  ```

  Remove the old `const user = buildUserPrompt(input);` line.

- [ ] **Step 3: Verify typecheck**

  Run: `pnpm -r typecheck`
  Expected: 10 packages pass with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/core/src/architect/prompt.ts packages/core/src/architect/index.ts
  git commit -m "feat(architect): remix mode loads + renders base agent context"
  ```

---

## Task 2: Unit-test remix prompt + key-preservation invariant

**Files:**
- Modify: `packages/core/src/architect/architect.test.ts`

- [ ] **Step 1: Append a "remix prompt shape" test block**

  At the bottom of `main()` (before the `Results:` print), add:

  ```ts
  console.log("• remix prompt + key preservation");
  const { buildUserPrompt } = await import("./prompt.js");
  const baseAgent = {
    key: "briefing",
    name: "Briefing",
    model: "nousresearch/hermes-4-405b",
    autonomy: "execute_safe",
    systemPrompt: "You are the Briefing agent. EVERY MORNING (08:00): ...",
    budgetCapUsd: "0.50",
    cronSchedule: "0 8 * * *",
  };
  const remixUser = buildUserPrompt(
    { tenantId: TENANT, prompt: "switch to weekly on Mondays at 09:00", mode: "remix", baseAgentKey: "briefing" },
    baseAgent,
  );
  assert(remixUser.includes("REMIX request"), "remix branch labels the request");
  assert(remixUser.includes("MUST reuse the exact same key"), "remix branch insists on same key");
  assert(remixUser.includes("current systemPrompt:"), "remix branch includes current prompt");
  assert(remixUser.includes("0 8 * * *"), "remix branch includes current cron");

  // Remix prompt when base not found falls back to instruction-only.
  const remixNoBase = buildUserPrompt(
    { tenantId: TENANT, prompt: "make it weekly", mode: "remix", baseAgentKey: "unknown" },
    undefined,
  );
  assert(remixNoBase.includes("REMIX request"), "remix branch still labels the request when base unknown");
  assert(remixNoBase.includes("not found on tenant"), "remix branch flags missing base agent");
  ```

- [ ] **Step 2: Run tests**

  Run: `pnpm --filter @agent-os/core run test:architect`
  Expected: `Results: 31 passed, 0 failed` (was 25; +6 new assertions).

- [ ] **Step 3: Commit**

  ```bash
  git add packages/core/src/architect/architect.test.ts
  git commit -m "test(architect): cover remix prompt shape + missing-base fallback"
  ```

---

## Task 3: API route validation + integration test

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Validate mode=remix requires baseAgentKey**

  In the `POST /api/admin/architect/propose` handler (after the prompt check, before calling `proposeBlueprint`):

  ```ts
  if (b.mode === "remix" && !b.baseAgentKey) {
    return c.json({ error: "remix mode requires baseAgentKey" }, 400);
  }
  ```

- [ ] **Step 2: Append a remix integration test block**

  Just before the cleanup section in `app.test.ts` (after the "seed it" block), insert:

  ```ts
  // ---- remix flow ----
  // 400 when mode=remix without baseAgentKey
  const noBase = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah, body: JSON.stringify({ prompt: "make it weekly", mode: "remix" }),
  });
  assert(noBase.status === 400, "remix without baseAgentKey → 400");

  // Inject a fixture LLM that emits a single-agent remix re-using the apitest-meta-scout key.
  setArchitectLlm(fixtureLlmFromJson({
    teamName: "Remix: weekly scout",
    rationale: "Switch to weekly cadence per operator instruction.",
    agents: [{
      key: "apitest-meta-scout",                          // SAME key as the seeded agent
      name: "Apitest Meta Scout (Weekly)",
      role: "Weekly competitor scan.",
      systemPrompt: "You are the Apitest Meta Scout. EVERY MONDAY (07:00): ... RULES: ...",
      model: "nousresearch/hermes-4-70b",
      thinkingLevel: "low",
      autonomy: "propose",
      knowledgeScope: { folders: ["ad-playbooks"], tags: [] },
      budgetCapUsd: "0.30",
      cron: { schedule: "0 7 * * 1", jobName: "Weekly scout" },
      skillKeys: [],
      mcpNames: ["Pipeboard × Meta"],
    }],
    proposedSkills: [],
    proposedMcps: [],
  }, { model: "fixture/hermes-4-405b", costUsd: 0.005 }));

  const remixRes = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah,
    body: JSON.stringify({ prompt: "switch to weekly on Mondays at 07:00", mode: "remix", baseAgentKey: "apitest-meta-scout" }),
  });
  assert(remixRes.status === 201, "remix propose returns 201");
  const remixBP = (await remixRes.json()) as { blueprint: { id: string; agents: { key: string; cron?: { schedule: string } | null }[] } };
  assert(remixBP.blueprint.agents.length === 1, "remix returns single-agent team");
  assert(remixBP.blueprint.agents[0]!.key === "apitest-meta-scout", "remix preserves the base key");
  assert(remixBP.blueprint.agents[0]!.cron?.schedule === "0 7 * * 1", "remix carries new cron");

  // Seed it — upsertAgent(tenant, key) should hit the SAME row (same agentId).
  const baseAgentId = seeded.seeded.find((s) => s.key === "apitest-meta-scout")!.agentId;
  const remixSeedRes = await app.request("/api/admin/architect/seed", {
    method: "POST", headers: ah, body: JSON.stringify({ blueprintId: remixBP.blueprint.id }),
  });
  assert(remixSeedRes.status === 201, "remix seed returns 201");
  const remixSeeded = (await remixSeedRes.json()) as { seeded: { key: string; agentId: string }[] };
  assert(remixSeeded.seeded[0]!.agentId === baseAgentId, "remix re-uses the same agent row (upsert by key)");
  ```

- [ ] **Step 3: Verify typecheck**

  Run: `pnpm -r typecheck`
  Expected: all pass.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/api/src/index.ts apps/api/src/app.test.ts
  git commit -m "feat(api): architect remix validation + integration test"
  ```

---

## Task 4: UI "Remix this agent" affordance

**Files:**
- Modify: `apps/control-plane/src/lib/api.ts`
- Modify: `apps/control-plane/src/routes/_app/agents.tsx`
- Modify: `apps/control-plane/src/routes/_app/architect.tsx`

- [ ] **Step 1: Add the convenience helper to the API client**

  Append to `apps/control-plane/src/lib/api.ts` inside the `architect` object:

  ```ts
    remix: (baseAgentKey: string, instruction: string) =>
      call<{ blueprint: Blueprint }>("POST", "/api/admin/architect/propose", {
        prompt: instruction,
        mode: "remix",
        baseAgentKey,
      }),
  ```

- [ ] **Step 2: Add the Remix button + dialog to the agents drawer**

  Find the agents drawer/detail view in `apps/control-plane/src/routes/_app/agents.tsx` (the `<Drawer ...>` block around `selected`). Add a "Remix" button alongside the existing actions. On click, open an inline form that takes an instruction string + a Submit. On submit, call `architect.remix(selected.key, instruction)`, then navigate to `/architect?focus=<blueprint.id>`.

  Wire it like this (add near the top of the file):

  ```ts
  import { useNavigate } from "@tanstack/react-router";
  import { Wand2 } from "lucide-react";
  import { architect, hasAdminKey } from "#/lib/api";
  ```

  Inside `AgentsPage`, add:

  ```ts
  const navigate = useNavigate();
  const [remixingFor, setRemixingFor] = useState<Agent | null>(null);
  const [remixInstruction, setRemixInstruction] = useState("");
  const remix = useMutation({
    mutationFn: () => architect.remix(remixingFor!.key, remixInstruction),
    onSuccess: (r) => {
      setRemixingFor(null);
      setRemixInstruction("");
      navigate({ to: "/architect", search: { focus: r.blueprint.id } });
    },
  });
  ```

  Add to the drawer footer (or wherever actions live for `selected`):

  ```tsx
  {selected && hasAdminKey() && (
    <Button variant="secondary" size="sm" onClick={() => setRemixingFor(selected)}>
      <Wand2 className="size-4" /> Remix
    </Button>
  )}
  ```

  Render the modal/inline dialog at the page bottom:

  ```tsx
  {remixingFor && (
    <Drawer open onOpenChange={(v) => !v && setRemixingFor(null)}>
      <div className="p-4">
        <p className="text-sm font-medium">Remix {remixingFor.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">One-line instruction. The Architect returns a single-agent blueprint with the same key — landing in DB demotes the agent until you approve again.</p>
        <textarea
          value={remixInstruction}
          onChange={(e) => setRemixInstruction(e.target.value)}
          placeholder='e.g. "switch to weekly on Mondays at 09:00"'
          rows={3}
          className="mt-3 w-full rounded-md border border-border bg-background p-3 text-sm"
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={() => remix.mutate()} disabled={!remixInstruction.trim() || remix.isPending}>
            <Wand2 className="size-4" /> Propose remix
          </Button>
        </div>
      </div>
    </Drawer>
  )}
  ```

- [ ] **Step 3: Accept `?focus=blueprintId` on /architect**

  In `apps/control-plane/src/routes/_app/architect.tsx`, change:

  ```ts
  export const Route = createFileRoute("/_app/architect")({ component: ArchitectPage });
  ```

  to:

  ```ts
  type ArchitectSearch = { focus?: string };
  export const Route = createFileRoute("/_app/architect")({
    component: ArchitectPage,
    validateSearch: (s: Record<string, unknown>): ArchitectSearch => ({
      focus: typeof s.focus === "string" ? s.focus : undefined,
    }),
  });
  ```

  Then in the component:

  ```ts
  const { focus } = Route.useSearch();
  useEffect(() => {
    if (focus && list.data) {
      const found = list.data.find((bp) => bp.id === focus);
      if (found) setActive(found);
    }
  }, [focus, list.data]);
  ```

  Add `import { useEffect } from "react";` if not already imported.

- [ ] **Step 4: Verify build + typecheck**

  Run: `pnpm -r typecheck && pnpm --filter control-plane build`
  Expected: all pass; new `architect-*.js` chunk still emitted, `agents-*.js` chunk grows ~1-2 kB.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/control-plane/src/lib/api.ts apps/control-plane/src/routes/_app/agents.tsx apps/control-plane/src/routes/_app/architect.tsx
  git commit -m "feat(ui): Remix button on agents drawer + ?focus=<blueprintId> on /architect"
  ```

---

## Task 5: Push

- [ ] **Step 1: Push the feature branch**

  Run: `git push -u origin claude/exciting-davinci-yvptm`
  Expected: 4 new commits pushed.

---

## Verification (acceptance criteria)

- `pnpm --filter @agent-os/core run test:architect` reports `31 passed, 0 failed`.
- `pnpm -r typecheck` reports all packages Done with no errors.
- `pnpm --filter control-plane build` succeeds.
- Hand-test (off-sandbox): open an agent → click Remix → type "switch to weekly" → land on `/architect` with the new blueprint focused → click Seed → the agent's row updates (same agentId) with the new prompt + cron.

## Done when

- 4 commits land on `claude/exciting-davinci-yvptm`.
- All tests + typechecks green.
