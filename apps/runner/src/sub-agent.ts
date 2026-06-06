// Phase 52: Sub-agent SDK dispatch — real mid-run model fork.
//
// When pickModelIntelligently recommends a different model for a sub-task
// (skill or tool invocation), this dispatcher actually runs the sub-task
// on the picked model instead of the parent agent's baseline. The audit
// trail captures this with `applied: true` (CR-05 honesty).
//
// Architecture:
//   - Parent run uses the baseline model in the main SDK session
//   - At a skill/tool intercept point, the dispatcher spawns a fresh
//     sdk.query() with the picked model + scoped allowedTools + smaller
//     maxTurns ceiling
//   - Per-sub-call BudgetTracker reserve/commit against the parent run's
//     cap (uses the parent run's runId so cost accumulates correctly)
//   - Per-sub-call timeout (default 30s) — sub-agents shouldn't loop
//   - On exception: release the reserve so subsequent sub-calls still work
//
// The SDK is dynamically imported (like liveRun) to keep the dry-run path
// SDK-free. Tests pass an sdkOverride for full coverage without the
// live SDK.

import { emit } from "@agent-os/core";
import type { ApiClient, Bundle } from "./api-client.js";
import { getBudgetTracker } from "./budget.js";

export type SubAgentSdkLike = {
  query: (args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;
};

export interface SubAgentDispatchArgs {
  /** Parent bundle — provides tenant + agent identity + run id. */
  bundle: Bundle;
  /** Model slug to run THIS sub-task on. */
  modelSlug: string;
  /** The sub-task prompt. */
  prompt: string;
  /** Override the system prompt for the sub-agent. Defaults to a
   *  scoped one referencing the parent agent's name. */
  systemPrompt?: string;
  /** Tools the sub-agent is allowed to call. Defaults to []
   *  (sub-agents are by default tool-less — pure reasoning). */
  allowedTools?: string[];
  /** Max turns the sub-agent can take. Default 4. */
  maxTurns?: number;
  /** Hard wall-clock timeout in ms. Default 30000 (30s). */
  timeoutMs?: number;
  /** Cost estimate for the reserve. When 0, reserve is skipped and the
   *  commit happens against the actual SDK-reported cost. */
  costEstimateUsd?: number;
  /** Human-readable label for the audit trail (skill key, tool key, etc). */
  taskLabel: string;
  /** Test seam: inject a stub SDK. When omitted, dynamically imports
   *  @anthropic-ai/claude-agent-sdk. */
  sdkOverride?: SubAgentSdkLike;
  /** Test/optional: relay db for audit emit. When omitted, no audit fires. */
  db?: import("@agent-os/db").Db;
  /** Test/optional: api client for activity logging. */
  api?: ApiClient;
}

export interface SubAgentDispatchResult {
  result: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  /** True iff the sub-agent reached the `result` message. False if it
   *  timed out or hit max turns. */
  ok: boolean;
  /** Set when the dispatch failed (timeout, SDK error, exception). */
  error?: string;
  /** The model that actually ran (echoes args.modelSlug). */
  modelRan: string;
  /** Reservation id used (for downstream audit). null if reserve skipped. */
  reservationId: string | null;
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`sub-agent dispatch exceeded ${ms}ms timeout`);
    this.name = "TimeoutError";
  }
}

function defaultSubSystemPrompt(parentAgentName: string, taskLabel: string): string {
  return [
    `You are a sub-agent of "${parentAgentName}", dispatched specifically for: ${taskLabel}.`,
    "Return your answer concisely. Do not loop; do not chain follow-up tasks.",
    "When the task is done, emit a single `result` message and stop.",
  ].join("\n");
}

/**
 * Dispatch a sub-task on a specified model. The parent run's SDK session
 * is untouched; this opens a fresh sub-session, runs the task, closes it,
 * and merges the result back to the caller.
 *
 * The caller (a future PreSkillUse hook, a tool handler that wants
 * delegated reasoning, etc.) decides what to do with the returned result.
 */
export async function dispatchSubAgent(
  args: SubAgentDispatchArgs,
): Promise<SubAgentDispatchResult> {
  const tracker = getBudgetTracker();
  const estimate = args.costEstimateUsd ?? 0;
  let reservationId: string | null = null;

  // Reserve against the parent run's tracker so the per-run cap accounts
  // for the sub-agent's expected cost. Skip when no tracker is open or
  // when the estimate is zero.
  if (tracker.hasRun(args.bundle.run.id) && estimate > 0) {
    const r = tracker.reserveSpend(args.bundle.run.id, estimate, {
      tool: `sub-agent:${args.taskLabel}`,
      phase: "sub-agent",
      modelSlug: args.modelSlug,
    });
    if (!r.ok) {
      return {
        result: "",
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        ok: false,
        error: `sub-agent reserve refused: ${r.reason}`,
        modelRan: args.modelSlug,
        reservationId: null,
      };
    }
    reservationId = r.reservationId;
  }

  // Acquire the SDK (dynamic import in production, override in tests).
  let sdk: SubAgentSdkLike;
  try {
    sdk = args.sdkOverride
      ?? ((await import("@anthropic-ai/claude-agent-sdk")) as unknown as SubAgentSdkLike);
  } catch (e) {
    if (reservationId) {
      tracker.releaseSpend(args.bundle.run.id, reservationId, {
        phase: "sub-agent",
        reason: "sdk-import-failed",
      });
    }
    return {
      result: "",
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      ok: false,
      error: `sdk import failed: ${(e as Error).message}`,
      modelRan: args.modelSlug,
      reservationId,
    };
  }

  const subOptions: Record<string, unknown> = {
    model: args.modelSlug,
    systemPrompt: args.systemPrompt ?? defaultSubSystemPrompt(args.bundle.agent.name, args.taskLabel),
    allowedTools: args.allowedTools ?? [],
    maxTurns: args.maxTurns ?? 4,
  };

  let result = "";
  let costUsd = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let ok = false;
  let error: string | undefined;

  const timeoutMs = args.timeoutMs ?? 30000;

  // Race the iteration against a timeout.
  const iterationPromise = (async () => {
    for await (const msg of sdk.query({ prompt: args.prompt, options: subOptions })) {
      const type = msg.type as string | undefined;
      if (type === "result") {
        result = (msg.result as string) ?? result;
        costUsd = (msg.total_cost_usd as number) ?? 0;
        const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        tokensIn = usage?.input_tokens ?? 0;
        tokensOut = usage?.output_tokens ?? 0;
        ok = true;
      }
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    await Promise.race([iterationPromise, timeoutPromise]);
  } catch (e) {
    error = (e as Error).message;
    ok = false;
  }

  // Commit or release based on outcome.
  if (reservationId) {
    if (ok) {
      tracker.commitSpend(args.bundle.run.id, reservationId, costUsd > 0 ? costUsd : estimate, {
        phase: "sub-agent",
        modelSlug: args.modelSlug,
      });
    } else {
      tracker.releaseSpend(args.bundle.run.id, reservationId, {
        phase: "sub-agent",
        reason: error ?? "sub-agent failed",
      });
    }
  }

  // Audit emit: with applied: true so the feedback loop can attribute
  // outcomes to the actual model that ran.
  if (args.db) {
    try {
      await emit(args.db, {
        tenantId: args.bundle.agent.tenantId,
        eventName: "model.routed",
        actor: "system",
        agentId: args.bundle.agent.id,
        runId: args.bundle.run.id,
        payload: {
          agent_model: args.bundle.agent.model,
          applied: true,
          model_ran: args.modelSlug,
          task_label: args.taskLabel,
          source: "sub_agent_dispatch",
          reason: ok
            ? `sub-agent on ${args.modelSlug} completed task "${args.taskLabel}"`
            : `sub-agent on ${args.modelSlug} failed task "${args.taskLabel}": ${error}`,
          cost_usd: costUsd,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
        },
        piiClass: "none",
      });
    } catch (e) {
      console.error(`[runner] sub-agent model.routed emit failed: ${(e as Error).message}`);
    }
  }

  if (args.api && result) {
    await args.api
      .postActivity(args.bundle.run.id, "assistant", `[sub-agent ${args.taskLabel}] ${result.slice(0, 500)}`)
      .catch(() => {});
  }

  return {
    result,
    costUsd,
    tokensIn,
    tokensOut,
    ok,
    error,
    modelRan: args.modelSlug,
    reservationId,
  };
}
