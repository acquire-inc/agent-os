// Runner-side dispatch for custom registry tools (Plan 07-06 + 09-04).
//
// Tools bound to an agent surface in the Bundle as `bundle.tools[]`. For each
// one whose key matches a registered handler here, the runner can dispatch it
// outside of the Claude Agent SDK's MCP path — useful for deterministic
// shared services like tool.browser where we want SSRF guard + file outputs
// (CLAUDE.md non-negotiable #4) before anything hits the model.
//
// The PreToolUse autonomy gate still fires for these; we leave the gate alone
// and only add the dispatch layer.
//
// Phase 9 adds: tool.rls-test, tool.vault-rotate, tool.access-audit,
// tool.access-log-analyzer. Each lazy-creates its db connection + (for
// vault-rotate) the vault key from env vars on first call so handlers stay
// process-isolated from runner module load — env may not be wired at import.
import {
  emit,
  isCantFail,
  pickModelIntelligently,
  raiseCapBreachApproval,
  recordFinding,
  scrubToolResult,
  type ModelTier,
} from "@agent-os/core";
import { getBudgetTracker } from "./budget.js";
import { getModelCatalog } from "./catalog.js";
import { ratchetAutonomy, registerOutputDir } from "./run-state.js";
import { dispatchSubAgent } from "./sub-agent.js";
import { runBrowserTool, type BrowserToolInput, type BrowserToolResult } from "@agent-os/tool-browser";
import {
  runIsolationSuite,
  type IsolationInput,
  type IsolationResult,
} from "@agent-os/tool-rls-test";
import {
  rotateCredential,
  findOrphanedGrants,
  detectUsageSpikes,
  closeRefresher,
  metaRefresher,
  stripeRefresher,
  type RotateResult,
} from "@agent-os/core";
import { createDb, registerArtifact, type Db } from "@agent-os/db";
import type { Refresher } from "@agent-os/vault";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bundle } from "./api-client.js";

/** Result envelope written to a file under the run's tmp dir. */
export interface CustomToolDispatchResult {
  toolKey: string;
  resultPath: string;
}

export interface CustomToolHandlerCtx {
  outputDir: string;
  /** Bundle metadata for Phase 19 Relay finding emission. Optional for
   *  back-compat with handlers that don't need it. */
  tenantId?: string;
  runId?: string;
  agentId?: string;
}

export type CustomToolHandler = (
  input: unknown,
  ctx: CustomToolHandlerCtx,
) => Promise<{ result: unknown }>;

// Lazy singletons — created on first use, reused across dispatches.
let cachedDb: Db | null = null;
function getDb(): Db {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for security tool dispatch");
  cachedDb = createDb(url);
  return cachedDb;
}

function getVaultKey(): Buffer {
  const k = process.env.AOS_VAULT_KEY;
  if (!k) throw new Error("AOS_VAULT_KEY required for tool.vault-rotate");
  // Keys are stored hex-encoded; 32 bytes for AES-256.
  return Buffer.from(k, "hex");
}

function pickRefresher(provider: string): Refresher {
  switch (provider) {
    case "close":
      return closeRefresher;
    case "meta":
      return metaRefresher;
    case "stripe":
      return stripeRefresher;
    default:
      throw new Error(`tool.vault-rotate: unknown provider "${provider}" (expected close|meta|stripe)`);
  }
}

export const customToolDispatch: Record<string, CustomToolHandler> = {
  "tool.browser": async (input, ctx) => {
    const result: BrowserToolResult = await runBrowserTool(input as BrowserToolInput, {
      outputDir: ctx.outputDir,
    });
    // Phase 15: scrub prompt-injection patterns from browser-returned content
    // before piping back to the planner. The browser is the canonical
    // external-trust-boundary tool — scraped pages can contain hostile text.
    // Phase 19: emit finding.recorded for each distinct category detected.
    const { result: scrubbed, detections } = scrubToolResult(result);
    if (detections.length > 0) {
      const categoriesSeen = [...new Set(detections.map((d) => d.category))];
      console.warn(
        `[runner] tool.browser: ${detections.length} prompt-injection pattern(s) redacted from result (categories: ${categoriesSeen.join(", ")})`,
      );
      // WR-03 fix: steganographic-only matches (BOM, RTL/LTR marks, ZWJ, etc.)
      // commonly appear in legitimate non-ASCII content (Arabic/Hebrew text,
      // Windows-exported Excel snippets, emoji ZWJ sequences). They get
      // recorded as findings but do NOT trigger the autonomy ratchet — the
      // redaction marker is the audit trail; the ratchet would produce an
      // operator-noise firehose.
      const nonSteganographic = categoriesSeen.filter((c) => c !== "steganographic");
      // Phase 22: ratchet the rest of the run to propose ONLY when the
      // match included a real-attack category (anything beyond steganographic).
      if (ctx.runId && nonSteganographic.length > 0) {
        ratchetAutonomy(
          ctx.runId,
          "propose",
          `prompt-injection detected in tool.browser result (categories: ${nonSteganographic.join(", ")})`,
        );
      }
      // Best-effort Relay emit. Skip if we don't have tenant context (e.g.
      // tests dispatch without bundle metadata).
      if (ctx.tenantId && ctx.runId) {
        try {
          const db = getDb();
          for (const cat of categoriesSeen) {
            const catDetections = detections.filter((d) => d.category === cat);
            // WR-03 fix: steganographic = medium (often benign non-ASCII).
            // Other categories = high (real attack patterns).
            // WR-12 fix: base64-encode the span preview so the operator must
            // explicitly decode it. A determined attacker could craft a
            // payload whose first-100 chars exfiltrate into operator logs.
            const severity = cat === "steganographic" ? "medium" : "high";
            await recordFinding(db, {
              tenantId: ctx.tenantId,
              category: "anomaly",
              severity,
              title: "prompt-injection attempt redacted",
              agentId: ctx.agentId ?? null,
              payload: {
                source: "tool.browser",
                run_id: ctx.runId,
                category: cat,
                detail: `${catDetections.length} ${cat} injection pattern(s) detected in tool.browser result; redacted before planner read`,
                count: catDetections.length,
                first_span_preview_b64: Buffer.from(
                  catDetections[0]!.matchedSpan.slice(0, 100),
                ).toString("base64"),
              },
            }).catch((e) => {
              console.error(`[runner] failed to recordFinding for injection cat=${cat}: ${(e as Error).message}`);
            });
          }
        } catch (e) {
          console.error(`[runner] tool.browser injection-emit skipped (db unavailable): ${(e as Error).message}`);
        }
      }
    }
    return { result: scrubbed };
  },
  // D-01: runner-dispatched RLS test uses ctx.db (likely service-role) — for
  // cron sanity ONLY; HARD GATE verification uses scripts/verify/isolation-live.ts
  // with RLS_TEST_DATABASE_URL (plan 09-06). The in-runner call is sanity-
  // checking; false-pass is caught by positive controls in attack-vectors.ts.
  "tool.rls-test": async (input, ctx) => {
    const result: IsolationResult = await runIsolationSuite(input as IsolationInput, {
      db: getDb(),
      outputDir: ctx.outputDir,
    });
    return { result };
  },
  "tool.vault-rotate": async (input) => {
    const { mcpId, provider } = input as { mcpId: string; provider: string };
    const result: RotateResult = await rotateCredential(
      getDb(),
      getVaultKey(),
      mcpId,
      pickRefresher(provider),
    );
    return { result };
  },
  "tool.access-audit": async (input) => {
    const { tenantId } = input as { tenantId: string };
    const result = await findOrphanedGrants(getDb(), tenantId);
    return { result };
  },
  "tool.access-log-analyzer": async (input) => {
    const { tenantId, hours } = input as { tenantId: string; hours?: number };
    const result = await detectUsageSpikes(getDb(), tenantId, { hours: hours ?? 24 });
    return { result };
  },
};

/** Derive the explicit allowedTools list from the agent's bindings. Pitfall 5:
 *  never leave allowedTools unset — that lets the agent call ANY tool. Returns
 *  custom tool keys + MCP names; the Agent SDK matches on either. */
export function deriveAllowedTools(bundle: Bundle): string[] {
  const toolKeys = (bundle.tools ?? []).map((t) => t.key);
  const mcpNames = (bundle.mcpServers ?? []).map((m) => m.name);
  // Phase 58: tool.delegate is built-in. Auto-enabled when the agent has
  // skills bound — the agent can use it to delegate to sub-agents
  // optimized per skill. Agents with no skills can't usefully delegate.
  const builtins: string[] = [];
  if ((bundle.skills ?? []).length > 0) builtins.push("tool.delegate");
  return [...toolKeys, ...mcpNames, ...builtins];
}

/** Sentinel error thrown when a tool dispatch is refused because the
 *  reserve would breach the agent's budget cap. Callers (the SDK hook or
 *  the runner orchestrator) can map this to a propose / approval / abort
 *  path per the cost-ceiling-discipline skill workflow step 5. */
export class CapBreachError extends Error {
  readonly toolKey: string;
  readonly requestedUsd: number;
  readonly committedUsd: number;
  readonly capUsd: number;

  constructor(toolKey: string, requestedUsd: number, committedUsd: number, capUsd: number) {
    super(
      `dispatchCustomTool: cap breach refused for ${toolKey} (requested $${requestedUsd.toFixed(4)} + committed $${committedUsd.toFixed(4)} > cap $${capUsd.toFixed(2)})`,
    );
    this.name = "CapBreachError";
    this.toolKey = toolKey;
    this.requestedUsd = requestedUsd;
    this.committedUsd = committedUsd;
    this.capUsd = capUsd;
  }
}

/** Dispatch a custom tool call.
 *
 * Phase 26: wraps the handler with the BudgetTracker reserve-before /
 * commit-after pattern from the cost-ceiling-discipline SKILL. The
 * reserve uses the tool's per-invocation cost estimate (bundle.tools[].
 * costEstimateUsd, sourced from migration 0016's tools.cost_estimate_usd).
 * A reserve that would breach the run's cap throws CapBreachError — the
 * tool call does NOT run.
 *
 * Best-effort: if the run was never opened in the singleton tracker
 * (test fixtures, dry-run paths that don't call executeRun's openRun),
 * we skip reserve/commit silently so dispatchCustomTool stays usable
 * in isolation. The audit trail is only complete when executeRun is
 * the entry point.
 */
export async function dispatchCustomTool(
  bundle: Bundle,
  toolKey: string,
  input: unknown,
): Promise<CustomToolDispatchResult> {
  // Phase 58: built-in `tool.delegate` short-circuits the normal handler
  // dispatch and invokes the sub-agent path. Input: { skill_key, prompt }.
  // The agent's skill registry is queried for the target skill's
  // task_profile + preferredModelTier; pickModelIntelligently selects the
  // optimal model; dispatchSubAgent runs the prompt on it and returns the
  // result. Closes the model-intelligence loop end-to-end: the agent
  // delegates explicitly, and the runner picks the best model for the
  // sub-task.
  if (toolKey === "tool.delegate") {
    const delegateInput = (input ?? {}) as { skill_key?: string; prompt?: string; system_prompt?: string };
    if (!delegateInput.skill_key || !delegateInput.prompt) {
      throw new Error("tool.delegate requires { skill_key, prompt }");
    }
    const skill = (bundle.skills ?? []).find((s) => s.key === delegateInput.skill_key);
    if (!skill) {
      throw new Error(`agent ${bundle.agent.key} is not bound to skill "${delegateInput.skill_key}" — refusing delegate`);
    }
    const catalog = await getModelCatalog();
    const baselineTier = ((bundle.agent as { modelTier?: import("@agent-os/core").ModelTier }).modelTier ?? "T-work") as import("@agent-os/core").ModelTier;
    const { pickModelIntelligently } = await import("@agent-os/core");
    const pick = pickModelIntelligently({
      agentKey: bundle.agent.key,
      agentModel: bundle.agent.model,
      agentTier: baselineTier,
      taskLabel: `skill:${skill.key}`,
      taskProfile: (skill.taskProfile ?? null) as Record<string, unknown> | null,
      taskPreferredTier: (skill.preferredModelTier ?? null) as import("@agent-os/core").ModelTier | null,
      catalog,
    });
    const dbHandle = (() => { try { return getDb(); } catch { return undefined; } })();
    const subResult = await dispatchSubAgent({
      bundle,
      modelSlug: pick.model,
      prompt: delegateInput.prompt,
      systemPrompt: delegateInput.system_prompt,
      taskLabel: `skill:${skill.key}`,
      costEstimateUsd: Number(skill.costEstimateUsd ?? "0"),
      db: dbHandle,
    });
    const outputDir = await mkdtemp(join(tmpdir(), `runner-${bundle.agent.key}-delegate-`));
    registerOutputDir(bundle.run.id, outputDir);
    const resultPath = join(outputDir, `delegate-${skill.key}-result.json`);
    await writeFile(resultPath, JSON.stringify({
      delegated_to_skill: skill.key,
      model_ran: subResult.modelRan,
      ok: subResult.ok,
      result: subResult.result,
      cost_usd: subResult.costUsd,
      tokens_in: subResult.tokensIn,
      tokens_out: subResult.tokensOut,
      error: subResult.error ?? null,
      pick_rationale: pick.reason,
      pick_source: pick.source,
    }, null, 2), "utf8");
    return { toolKey, resultPath };
  }

  const bound = (bundle.tools ?? []).find((t) => t.key === toolKey);
  if (!bound) {
    throw new Error(`agent ${bundle.agent.key} is not bound to ${toolKey} — refusing dispatch`);
  }
  const handler = customToolDispatch[toolKey];
  if (!handler) {
    throw new Error(`no custom-tool handler registered for ${toolKey}`);
  }

  // Phase 26: reserve before dispatch. Skip if the tracker has no open run
  // for this id (dispatchCustomTool used outside executeRun, e.g. a script
  // or a dry-run test path).
  const tracker = getBudgetTracker();
  const estimateUsd = Number(bound.costEstimateUsd ?? "0");
  let reservationId: string | null = null;
  if (tracker.hasRun(bundle.run.id) && estimateUsd > 0) {
    const r = tracker.reserveSpend(bundle.run.id, estimateUsd, {
      tool: toolKey,
      phase: "dispatch",
    });
    if (!r.ok && r.reason === "would_breach_cap") {
      // Phase 28: surface the per-tool cap breach as an operator Approval
      // before throwing — same lever set as the end-of-run path
      // (raise / truncated / abort). Best-effort: if no db handle is
      // available (test / dry-run), still throw the sentinel so the
      // caller can react.
      try {
        const dbHandle = getDb();
        await raiseCapBreachApproval(dbHandle, {
          runId: bundle.run.id,
          tenantId: bundle.agent.tenantId,
          agentId: bundle.agent.id,
          requestedUsd: estimateUsd,
          committedUsd: r.state.committedTotal,
          capUsd: r.state.capUsd,
        });
      } catch (e) {
        console.error(
          `[runner] dispatch cap-breach approval emit skipped for ${toolKey}: ${(e as Error).message}`,
        );
      }
      throw new CapBreachError(
        toolKey,
        estimateUsd,
        r.state.committedTotal,
        r.state.capUsd,
      );
    }
    if (r.ok) reservationId = r.reservationId;
  }

  // Phase 32: per-tool model affinity. If the tool has a preferred_model_tier
  // and the agent is NOT can't-fail (safety floor), compute the forked model
  // and emit a model.routed Relay event so the audit trail captures the swap.
  // We don't actually re-target the SDK session here (that's the runner's
  // dryRun / liveRun responsibility); this emit is the audit + signal so a
  // future orchestrator that supports sub-agents can act on it.
  const toolPreferredTier = (bound.preferredModelTier ?? null) as ModelTier | null;
  const toolProfile = bound.taskProfile as Record<string, unknown> | undefined;
  const hasToolProfile = toolProfile && Object.keys(toolProfile).length > 0;
  if ((toolPreferredTier || hasToolProfile) && !isCantFail(bundle.agent.key)) {
    try {
      const baselineTier = ((bundle.agent as { modelTier?: ModelTier }).modelTier ?? "T-work") as ModelTier;
      const catalog = await getModelCatalog();
      const pick = pickModelIntelligently({
        agentKey: bundle.agent.key,
        agentModel: bundle.agent.model,
        agentTier: baselineTier,
        taskLabel: toolKey,
        taskProfile: toolProfile ?? null,
        taskPreferredTier: toolPreferredTier,
        catalog,
      });
      if (pick.model !== bundle.agent.model) {
        const dbHandle = getDb();
        const top3 = pick.alternatives.slice(0, 3).map((a) => ({
          slug: a.slug,
          value_score: Number(a.valueScore.toFixed(2)),
          capability: Number(a.capabilityMatchScore.toFixed(2)),
          cost_index: Number(a.costIndex.toFixed(2)),
        }));
        await emit(dbHandle, {
          tenantId: bundle.agent.tenantId,
          eventName: "model.routed",
          actor: "system",
          agentId: bundle.agent.id,
          runId: bundle.run.id,
          payload: {
            // CR-05 fix: audit-only — the SDK call did NOT re-target.
            // applied: false signals downstream that agent_model is the
            // slug that actually ran. Phase 52 will implement real SDK
            // re-targeting and emit applied: true.
            agent_model: bundle.agent.model,
            applied: false,
            recommended_slug: pick.model,
            recommended_tier: pick.tier,
            task_label: toolKey,
            source: pick.source,
            reason: pick.reason,
            top_alternatives: top3,
          },
          piiClass: "none",
        }).catch((e) => {
          console.error(`[runner] model.routed emit failed for ${toolKey}: ${(e as Error).message}`);
        });
      }
    } catch (e) {
      console.error(`[runner] pickModelIntelligently refused for ${toolKey}: ${(e as Error).message}`);
    }
  }

  const outputDir = await mkdtemp(join(tmpdir(), `runner-${bundle.agent.key}-`));
  // WR-08 fix: register for cleanup at run close (clearRunState).
  registerOutputDir(bundle.run.id, outputDir);
  try {
    const { result } = await handler(input, {
      outputDir,
      tenantId: bundle.agent.tenantId,
      runId: bundle.run.id,
      agentId: bundle.agent.id,
    });

    // Phase 30: post-handler injection scrub for ANY tool that crosses
    // the AgentOS trust boundary. tool.browser already scrubs at the
    // handler level (Phase 15/19/22); this defense-in-depth wrap covers
    // future connector-shaped tools (tool.connector.*) that aren't yet
    // implemented but should inherit the same scrub + ratchet.
    let finalResult: unknown = result;
    const isExternalTrustTool =
      toolKey === "tool.browser" || toolKey.startsWith("tool.connector.");
    if (isExternalTrustTool && toolKey !== "tool.browser") {
      // tool.browser already scrubs inside its handler (with the richer
      // finding-emit and base64 logic). For other external-trust tools
      // we just do the redaction here at dispatch-exit so the result is
      // never piped back un-scrubbed.
      const { result: scrubbed, detections } = scrubToolResult(result);
      finalResult = scrubbed;
      if (detections.length > 0) {
        const categoriesSeen = [...new Set(detections.map((d) => d.category))];
        console.warn(
          `[runner] ${toolKey}: ${detections.length} prompt-injection pattern(s) redacted (categories: ${categoriesSeen.join(", ")})`,
        );
        const nonSteg = categoriesSeen.filter((c) => c !== "steganographic");
        if (nonSteg.length > 0) {
          ratchetAutonomy(
            bundle.run.id,
            "propose",
            `prompt-injection detected in ${toolKey} result (categories: ${nonSteg.join(", ")})`,
          );
        }
        // Emit a single finding per category at the dispatch layer
        // (mirrors the tool.browser handler emit but consolidated).
        try {
          const dbHandle = getDb();
          for (const cat of categoriesSeen) {
            const catDetections = detections.filter((d) => d.category === cat);
            const severity = cat === "steganographic" ? "medium" : "high";
            await recordFinding(dbHandle, {
              tenantId: bundle.agent.tenantId,
              category: "anomaly",
              severity,
              title: "prompt-injection attempt redacted",
              agentId: bundle.agent.id,
              payload: {
                source: toolKey,
                run_id: bundle.run.id,
                category: cat,
                detail: `${catDetections.length} ${cat} injection pattern(s) detected in ${toolKey} result; redacted before planner read`,
                count: catDetections.length,
                first_span_preview_b64: Buffer.from(
                  catDetections[0]!.matchedSpan.slice(0, 100),
                ).toString("base64"),
              },
            }).catch((e) => {
              console.error(
                `[runner] ${toolKey} finding emit failed for cat=${cat}: ${(e as Error).message}`,
              );
            });
          }
        } catch (e) {
          console.error(
            `[runner] ${toolKey} dispatch-layer injection-emit skipped: ${(e as Error).message}`,
          );
        }
      }
    }

    const resultPath = join(outputDir, `${toolKey.replace(/[^a-zA-Z0-9._-]/g, "_")}-result.json`);
    await writeFile(resultPath, JSON.stringify(finalResult, null, 2), "utf8");

    // Phase 48: register the tool result as an artifact so the operator's
    // dashboard sees what each tool produced. Best-effort; never throws
    // into the run. Tools with sensitive outputs can opt out by future
    // metadata flag (not implemented here).
    try {
      const dbHandle = getDb();
      await registerArtifact(dbHandle, {
        tenantId: bundle.agent.tenantId,
        runId: bundle.run.id,
        agentId: bundle.agent.id,
        kind: "json",
        name: `${toolKey} result`,
        uri: `file://${resultPath}`,
        metadata: {
          tool_key: toolKey,
          generated_by: "runner.dispatchCustomTool",
          phase: 48,
        },
      });
    } catch (e) {
      console.error(
        `[runner] artifact register skipped for ${toolKey}: ${(e as Error).message}`,
      );
    }

    // Commit the estimate as the actual on success. Future enhancement:
    // a handler that returns a true cost can supersede the estimate.
    if (reservationId) {
      tracker.commitSpend(bundle.run.id, reservationId, estimateUsd, {
        tool: toolKey,
        phase: "dispatch",
      });
    }
    return { toolKey, resultPath };
  } catch (err) {
    // Release the reservation on any failure so subsequent dispatches
    // can still proceed within the cap.
    if (reservationId) {
      tracker.releaseSpend(bundle.run.id, reservationId, {
        tool: toolKey,
        phase: "dispatch",
        error: (err as Error).message,
      });
    }
    throw err;
  }
}
