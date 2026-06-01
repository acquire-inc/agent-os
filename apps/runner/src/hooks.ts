// SDK hook factories.
// Step 1a: PostToolUse → audit + 'allow' autonomy event on every executed tool.
// Step 1b: SessionEnd is recorded server-side by setRunStatus on terminal status;
//          budget_cap is enforced server-side in PUT /api/runs/:id/status.
// Step 1c: PreToolUse consults the autonomy gate; on 'propose' it raises an
//          approval and asks the SDK to suspend the session.
// Same helpers back the dry-run path so the wiring is verifiable without a key.
import { autonomyGate, buildApprovalOptions } from "@agent-os/core";
import type { ApiClient } from "./api-client.js";

export interface ToolEvent {
  toolName: string;
  inputHash?: string;
  result?: string;
}

/**
 * Audit + record an "allow" autonomy event for a single executed tool call.
 * If PostToolUse fires, the SDK already let the tool run — so the gate's
 * decision is, by definition, `allow`. Best-effort: never throws into the run.
 */
export async function recordToolUse(api: ApiClient, runId: string, evt: ToolEvent): Promise<void> {
  await Promise.allSettled([
    api.postAudit(runId, { toolName: evt.toolName, inputHash: evt.inputHash, result: evt.result }),
    api.postAutonomyEvent(runId, { kind: "allow", toolName: evt.toolName }),
  ]);
}

/**
 * Claude Agent SDK PostToolUse hook. The SDK invokes this after every executed
 * tool call. We capture the tool name defensively (the SDK's payload shape
 * varies across versions) and write the audit + autonomy_event row.
 */
export function buildPostToolUseHook(api: ApiClient, runId: string) {
  return async (event: Record<string, unknown>): Promise<void> => {
    const toolName = String(
      (event.tool_name as string | undefined) ??
        (event.toolName as string | undefined) ??
        "unknown",
    );
    await recordToolUse(api, runId, {
      toolName,
      result: event.tool_result != null || event.toolResult != null ? "ok" : undefined,
    });
  };
}

export interface GateCtx {
  autonomy: string;
  escalationPolicy: string | null;
  agentName: string;
  sdkSessionId?: string;
  /**
   * Wave D: emit tool.dispatched on the allow path. Best-effort — the SDK is
   * about to invoke the tool regardless; a Relay failure must not block the
   * dispatch (we can't un-dispatch). The callback logs on failure rather than
   * swallowing silently. Optional so dry-run / tests can omit it.
   */
  onDispatch?: (toolName: string) => Promise<void>;
}

/**
 * Claude Agent SDK PreToolUse hook. For each tool the SDK is about to invoke we
 * consult the pure `autonomyGate`:
 *  - 'allow'   → proceed; PostToolUse will record the 'allow' event after execution
 *  - 'propose' → raise an Approval, record a 'propose' autonomy event, and ask the
 *                SDK to suspend the session (run → waiting). The runner picks the
 *                run back up when the human decides (run → pending → running).
 *  - 'deny'    → record 'deny' and tell the SDK to block.
 * Hook return shape is intentionally loose (Record<string, unknown>) to absorb
 * minor SDK version drift in the decision contract.
 */
export function buildPreToolUseHook(api: ApiClient, runId: string, ctx: GateCtx) {
  return async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const toolName = String(
      (event.tool_name as string | undefined) ??
        (event.toolName as string | undefined) ??
        "unknown",
    );
    const decision = autonomyGate({
      toolName,
      autonomy: ctx.autonomy,
      escalationPolicy: ctx.escalationPolicy,
    });
    if (decision === "allow") {
      // tool.dispatched — the SDK is about to invoke this tool. Fire-and-await
      // best-effort; onDispatch never throws into the run.
      if (ctx.onDispatch) await ctx.onDispatch(toolName);
      return { decision: "allow" };
    }
    if (decision === "propose") {
      await Promise.allSettled([
        api.postApproval(runId, {
          context: `${ctx.agentName} wants to call ${toolName}`,
          proposedAction: toolName,
          options: buildApprovalOptions(toolName),
          sdkSessionId: ctx.sdkSessionId,
        }),
        api.postAutonomyEvent(runId, {
          kind: "propose",
          toolName,
          rationale: `under autonomy=${ctx.autonomy}, ${toolName} is irreversible`,
        }),
      ]);
      return { decision: "ask" };
    }
    await api.postAutonomyEvent(runId, {
      kind: "deny",
      toolName,
      rationale: `policy-blocked under autonomy=${ctx.autonomy}`,
    });
    return { decision: "deny" };
  };
}
