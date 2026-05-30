// SDK hook factories. Today: PostToolUse only (Step 1a). 1b/1c will add Stop /
// SessionEnd / PreToolUse alongside, but those wire into the same API surface.
// The same `recordToolUse` is used by the dry-run path so the wiring is
// verifiable without an Anthropic key.
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
