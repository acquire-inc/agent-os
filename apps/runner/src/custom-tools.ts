// Runner-side dispatch for custom registry tools (Plan 07-06).
//
// Tools bound to an agent surface in the Bundle as `bundle.tools[]`. For each
// one whose key matches a registered handler here, the runner can dispatch it
// outside of the Claude Agent SDK's MCP path — useful for deterministic
// shared services like tool.browser where we want SSRF guard + file outputs
// (CLAUDE.md non-negotiable #4) before anything hits the model.
//
// The PreToolUse autonomy gate still fires for these; we leave the gate alone
// and only add the dispatch layer.
import { runBrowserTool, type BrowserToolInput, type BrowserToolResult } from "@agent-os/tool-browser";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bundle } from "./api-client.js";

/** Result envelope written to a file under the run's tmp dir. */
export interface CustomToolDispatchResult {
  toolKey: string;
  resultPath: string;
}

export type CustomToolHandler = (
  input: unknown,
  ctx: { outputDir: string },
) => Promise<{ result: unknown }>;

export const customToolDispatch: Record<string, CustomToolHandler> = {
  "tool.browser": async (input, ctx) => {
    const result: BrowserToolResult = await runBrowserTool(input as BrowserToolInput, {
      outputDir: ctx.outputDir,
    });
    return { result };
  },
};

/** Derive the explicit allowedTools list from the agent's bindings. Pitfall 5:
 *  never leave allowedTools unset — that lets the agent call ANY tool. Returns
 *  custom tool keys + MCP names; the Agent SDK matches on either. */
export function deriveAllowedTools(bundle: Bundle): string[] {
  const toolKeys = (bundle.tools ?? []).map((t) => t.key);
  const mcpNames = (bundle.mcpServers ?? []).map((m) => m.name);
  return [...toolKeys, ...mcpNames];
}

/** Dispatch a custom tool call. Defense in depth — the gate also checks. */
export async function dispatchCustomTool(
  bundle: Bundle,
  toolKey: string,
  input: unknown,
): Promise<CustomToolDispatchResult> {
  const bound = (bundle.tools ?? []).find((t) => t.key === toolKey);
  if (!bound) {
    throw new Error(`agent ${bundle.agent.key} is not bound to ${toolKey} — refusing dispatch`);
  }
  const handler = customToolDispatch[toolKey];
  if (!handler) {
    throw new Error(`no custom-tool handler registered for ${toolKey}`);
  }
  const outputDir = await mkdtemp(join(tmpdir(), `runner-${bundle.agent.key}-`));
  const { result } = await handler(input, { outputDir });
  const resultPath = join(outputDir, `${toolKey.replace(/[^a-zA-Z0-9._-]/g, "_")}-result.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
  return { toolKey, resultPath };
}
