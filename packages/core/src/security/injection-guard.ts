// Prompt-injection scrubbing for tool-returned content.
//
// The runtime mechanical layer paired with the prompt-injection-guardrail
// SKILL.md doctrine (external/acqu-skills/prompt-injection-guardrail/).
// When AgentOS reaches across its trust boundary (browser scrape, fetch,
// parsed email body, third-party API payload), the response is data, not
// instructions. This module finds directive-shaped spans, redacts them
// with a tagged marker, and emits a structured detection record for the
// caller to log as `finding.recorded` (category=anomaly, severity=high).
//
// Two enforcement points:
//   1. apps/runner/src/custom-tools.ts wraps every external-trust tool
//      handler (tool.browser today; tool.connector.* and tool.fetch as
//      added) with scrubToolResult() before returning to the SDK.
//   2. Direct callers (e.g. an agent-side helper) can call
//      scrubInjections() on a raw string.
//
// The redaction is structural — it preserves where the content was so
// the planner sees that *something* lived there, marked with a category.
// Silent deletion is forbidden because it hides the attempt from the audit
// trail.

export type InjectionCategory =
  | "direct_override"
  | "role_shift"
  | "steganographic"
  | "envelope_mimicry"
  | "exfiltration"
  | "tool_coercion";

interface PatternEntry {
  /** The detection regex (case-insensitive, multiline-aware). */
  pattern: RegExp;
  /** Bucket the match into for the audit trail. */
  category: InjectionCategory;
}

// The pattern bank. Multi-line, case-insensitive. Patterns are intentionally
// broad — false positives are cheap (operator reviews the finding); false
// negatives are reputation incidents.
//
// Maintenance: adding to the bank is a deliberate edit. The runtime guard's
// bypass-safety relies on this list being the floor; agent-side reasoning
// is the policy layer on top.
const PATTERNS: readonly PatternEntry[] = [
  // Direct overrides — explicit attempts to redirect the model.
  {
    pattern: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|the\s+above|your)\s+(instructions|rules|prompt|directives|context)\b/gi,
    category: "direct_override",
  },
  { pattern: /\byou\s+are\s+now\s+a?\s*[a-z\s]{0,40}\b(assistant|agent|model)?\b/gi, category: "direct_override" },
  { pattern: /\b(pretend|act)\s+(you\s+are|as\s+if|like)\s+(a|an)?\s*\b/gi, category: "direct_override" },
  { pattern: /\bnew\s+(instructions|directive|system\s+prompt)\s*:/gi, category: "direct_override" },

  // Role-shift forgeries — text masquerading as our system envelope.
  { pattern: /<\/?\s*(system|assistant|user|tool|developer)\s*>/gi, category: "role_shift" },
  { pattern: /^#+\s*(system\s+prompt|instructions|developer\s+message)\s*$/gim, category: "role_shift" },
  { pattern: /\[\[\s*(system|assistant)\s*\]\]/gi, category: "role_shift" },

  // Steganographic carriers — hidden directives.
  { pattern: /<!--[\s\S]{0,500}?-->/g, category: "steganographic" },
  { pattern: /[​-‏‪-‮⁠-⁤﻿]/g, category: "steganographic" },

  // Envelope mimicry — text imitating our tool-call JSON shape.
  { pattern: /\{\s*"(?:tool_use|tool_call|name)"\s*:\s*"[a-z_.]+"\s*,/gi, category: "envelope_mimicry" },
  { pattern: /<tool_use[\s>]/gi, category: "envelope_mimicry" },

  // Exfiltration probes — attempts to extract the system prompt or rules.
  { pattern: /\b(print|repeat|reveal|show|display|output|list)\s+(your\s+)?(system\s+prompt|instructions|rules|guidelines|persona)\b/gi, category: "exfiltration" },
  { pattern: /\bwhat\s+(are\s+)?your\s+(rules|instructions|guidelines|directives|tools)\b/gi, category: "exfiltration" },

  // Tool coercion — text trying to direct the agent into specific tool calls.
  { pattern: /\b(now|please)\s+(call|invoke|execute|run|use)\s+(the\s+)?[a-z_.]+\s+tool\b/gi, category: "tool_coercion" },
  { pattern: /\bexecute\s+the\s+following\b/gi, category: "tool_coercion" },
];

export interface InjectionMatch {
  category: InjectionCategory;
  matchedSpan: string;
  startIndex: number;
  endIndex: number;
}

export interface ScrubResult {
  /** Original text length (for audit). */
  inputLength: number;
  /** The scrubbed text — directive-shaped spans replaced with redaction markers. */
  scrubbed: string;
  /** Structured detections. Empty array = clean pass. */
  detections: InjectionMatch[];
  /** Convenience flag — true iff detections.length > 0. */
  prohibited: boolean;
}

/**
 * Pure scrub: returns scrubbed text + structured detections. Does NOT throw,
 * does NOT emit events — callers handle that based on their context.
 *
 * Redaction marker shape: `[REDACTED: injection-attempt; category=<cat>]`
 * The marker preserves position so the planner sees a placeholder rather
 * than silent deletion (silent deletion hides the audit trail).
 */
export function scrubInjections(text: string): ScrubResult {
  const detections: InjectionMatch[] = [];
  let scrubbed = text;

  // Two-pass: collect detections from the ORIGINAL text against every
  // pattern, then rebuild the scrubbed output.
  for (const { pattern, category } of PATTERNS) {
    // Reset RegExp state since these are stateful 'g' flag patterns.
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      detections.push({
        category,
        matchedSpan: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
      // Prevent infinite loop on zero-width matches.
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }

  if (detections.length === 0) {
    return { inputLength: text.length, scrubbed: text, detections: [], prohibited: false };
  }

  // Sort detections by start index DESCENDING so we can splice from the
  // back without invalidating earlier indices.
  detections.sort((a, b) => b.startIndex - a.startIndex);

  // De-dup overlapping spans: prefer the earlier-listed pattern (most
  // specific gets the redaction). Walk descending and skip a detection
  // if it's contained in or overlaps with a previously-applied one.
  const applied: InjectionMatch[] = [];
  for (const det of detections) {
    const overlaps = applied.some(
      (a) => !(det.endIndex <= a.startIndex || det.startIndex >= a.endIndex),
    );
    if (overlaps) continue;
    applied.push(det);
    const marker = `[REDACTED: injection-attempt; category=${det.category}]`;
    scrubbed = scrubbed.slice(0, det.startIndex) + marker + scrubbed.slice(det.endIndex);
  }

  // Re-sort detections by ascending index for the caller's audit view.
  applied.sort((a, b) => a.startIndex - b.startIndex);

  return {
    inputLength: text.length,
    scrubbed,
    detections: applied,
    prohibited: applied.length > 0,
  };
}

/**
 * Convenience wrapper for the runner: scrubs `result` (or each string field
 * of a result object) and returns the scrubbed shape plus the detection list.
 * For nested results, only top-level string fields are scrubbed (deeper
 * structures are out of scope — add a recursive variant when needed).
 */
export function scrubToolResult(result: unknown): { result: unknown; detections: InjectionMatch[] } {
  if (typeof result === "string") {
    const { scrubbed, detections } = scrubInjections(result);
    return { result: scrubbed, detections };
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const out: Record<string, unknown> = {};
    const all: InjectionMatch[] = [];
    for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
      if (typeof v === "string") {
        const { scrubbed, detections } = scrubInjections(v);
        out[k] = scrubbed;
        all.push(...detections);
      } else {
        out[k] = v;
      }
    }
    return { result: out, detections: all };
  }
  return { result, detections: [] };
}
