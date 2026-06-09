// packages/core/src/custom-tools.ts — the dispatcher from a registry tool_key to its real
// deterministic implementation. This is the bridge between "the catalog lists tool.X" and "tool.X
// actually runs": the runner's in-process SDK tools delegate here. Tools without an entry are still
// catalog stubs (metadata only) — runCustomTool reports that honestly rather than pretending.
import { evaluateClaim } from "./compliance-ruleset.js";
import { evaluateIsolation, type IsolationProbe } from "./isolation-tester.js";
import { evaluateConnectorHealth, type ConnectorHealth } from "./connector-health.js";
import { evaluateAdRules, type AdsetPerf } from "./ad-rules.js";
import { lintVoice } from "./voice-lint.js";

/** Registry tool_keys that have a real implementation today (everything else is a catalog stub). */
export const IMPLEMENTED_TOOL_KEYS = [
  "tool.compliance-ruleset",
  "tool.isolation-test-suite",
  "tool.connector-healthcheck",
  "tool.4", // Rules Engine (ad-ops)
  "tool.voice-lint",
] as const;
export type ImplementedToolKey = (typeof IMPLEMENTED_TOOL_KEYS)[number];

export function isImplementedTool(key: string): key is ImplementedToolKey {
  return (IMPLEMENTED_TOOL_KEYS as readonly string[]).includes(key);
}

export interface ToolCoverage {
  implemented: string[];
  stub: string[];
  total: number;
  ratio: number; // implemented / total (0 when total is 0)
}

/** Partition referenced tool keys into implemented (real dispatcher) vs. stub (catalog metadata
 *  only). Go-live visibility: the `stub` list is exactly what still needs building. Pure. */
export function toolCoverage(toolKeys: string[]): ToolCoverage {
  const unique = [...new Set(toolKeys)];
  const implemented = unique.filter(isImplementedTool).sort();
  const stub = unique.filter((k) => !isImplementedTool(k)).sort();
  return { implemented, stub, total: unique.length, ratio: unique.length ? implemented.length / unique.length : 0 };
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
    case "tool.connector-healthcheck": {
      const connectors = (input && typeof input === "object" && "connectors" in input
        ? (input as { connectors: ConnectorHealth[] }).connectors
        : []) as ConnectorHealth[];
      return { ok: true, result: evaluateConnectorHealth(Array.isArray(connectors) ? connectors : []) };
    }
    case "tool.4": {
      const adsets = (input && typeof input === "object" && "adsets" in input
        ? (input as { adsets: AdsetPerf[] }).adsets
        : []) as AdsetPerf[];
      return { ok: true, result: evaluateAdRules(Array.isArray(adsets) ? adsets : []) };
    }
    default:
      return { ok: false, error: `tool '${key}' has no implementation yet (catalog stub).` };
  }
}
