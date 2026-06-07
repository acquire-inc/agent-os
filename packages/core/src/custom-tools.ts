// packages/core/src/custom-tools.ts — the dispatcher from a registry tool_key to its real
// deterministic implementation. This is the bridge between "the catalog lists tool.X" and "tool.X
// actually runs": the runner's in-process SDK tools delegate here. Tools without an entry are still
// catalog stubs (metadata only) — runCustomTool reports that honestly rather than pretending.
import { evaluateClaim } from "./compliance-ruleset.js";
import { evaluateIsolation, type IsolationProbe } from "./isolation-tester.js";
import { lintVoice } from "./voice-lint.js";

/** Registry tool_keys that have a real implementation today (everything else is a catalog stub). */
export const IMPLEMENTED_TOOL_KEYS = [
  "tool.compliance-ruleset",
  "tool.isolation-test-suite",
  "tool.voice-lint",
] as const;
export type ImplementedToolKey = (typeof IMPLEMENTED_TOOL_KEYS)[number];

export function isImplementedTool(key: string): key is ImplementedToolKey {
  return (IMPLEMENTED_TOOL_KEYS as readonly string[]).includes(key);
}

export interface CustomToolResult { ok: boolean; result?: unknown; error?: string }

function asText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "text" in input) return String((input as { text: unknown }).text ?? "");
  return "";
}

/**
 * Invoke an implemented deterministic tool by its registry key. Pure (these tools have no I/O).
 * Unknown/stub keys return ok:false with a clear message — never a fabricated result.
 */
export function runCustomTool(key: string, input: unknown): CustomToolResult {
  switch (key) {
    case "tool.compliance-ruleset":
      return { ok: true, result: evaluateClaim(asText(input)) };
    case "tool.voice-lint":
      return { ok: true, result: lintVoice(asText(input)) };
    case "tool.isolation-test-suite": {
      const probes = (input && typeof input === "object" && "probes" in input
        ? (input as { probes: IsolationProbe[] }).probes
        : []) as IsolationProbe[];
      return { ok: true, result: evaluateIsolation(Array.isArray(probes) ? probes : []) };
    }
    default:
      return { ok: false, error: `tool '${key}' has no implementation yet (catalog stub).` };
  }
}
