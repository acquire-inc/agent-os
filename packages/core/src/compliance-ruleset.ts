// packages/core/src/compliance-ruleset.ts — the deterministic tool behind `tool.compliance-ruleset`,
// used by the can't-fail `ad-claim-compliance` agent (Gate 1: no client ad launches before this
// works). Pure, no I/O. Evaluates ad/marketing copy against substantiation + deceptive-claim rules
// (FTC-style: claims need substantiation; no false guarantees; income/health claims are gated). The
// agent decides launch from the result — BLOCK on any `block` violation. Rules are DATA so the set
// can grow without touching the engine.

export type ComplianceCategory =
  | "unsubstantiated-performance" | "false-guarantee" | "income-claim" | "health-claim"
  | "absolute-superlative" | "deceptive-risk" | "unrealistic-timeframe";
export type ComplianceSeverity = "block" | "warn";

export interface ComplianceRule {
  id: string;
  category: ComplianceCategory;
  severity: ComplianceSeverity;
  /** Simple, linear-time pattern (ReDoS-safe: no nested quantifiers/backrefs). */
  pattern: RegExp;
  message: string;
  fix: string;
}

// Word-boundary, bounded patterns only — every quantifier is bounded or applied to a char class.
export const COMPLIANCE_RULES: ComplianceRule[] = [
  { id: "multiplier-claim", category: "unsubstantiated-performance", severity: "block",
    pattern: /\b\d{1,4}\s?x\b(?!\d)/i,
    message: "Unsubstantiated multiplier claim (e.g. '10x your revenue').",
    fix: "Remove the multiplier or cite a verifiable, typical-result source from the proof-vault." },
  { id: "guaranteed-outcome", category: "false-guarantee", severity: "block",
    // Block a guarantee tied to an OUTCOME (either order, small window). Leaves a true
    // 'money-back guarantee' / 'satisfaction guarantee' alone (no outcome term nearby).
    pattern: /\bguarantee(?:d|s)?\b[^.\n]{0,30}\b(?:results?|revenue|success|income|roi|leads?|sales?|profit|growth)\b|\b(?:results?|revenue|success|income|roi|leads?|sales?|profit|growth)\b[^.\n]{0,20}\bguarantee(?:d|s)?\b/i,
    message: "Guarantee of an outcome/result (deceptive unless a true, disclosed guarantee).",
    fix: "Drop the outcome guarantee, or scope it to a real, stated money-back guarantee." },
  { id: "income-claim", category: "income-claim", severity: "block",
    pattern: /(?:make|earn|profit|income of)\s+\$?\d[\d,]{0,9}/i,
    message: "Earnings/income claim without a results disclaimer.",
    fix: "Remove the figure or add a clear 'results not typical' income disclaimer + substantiation." },
  { id: "income-per-period", category: "income-claim", severity: "block",
    pattern: /\$\d[\d,]{0,9}\s?(?:\/|per|a)\s?(?:day|week|month|year)/i,
    message: "Per-period earnings claim (e.g. '$10k/month').",
    fix: "Remove or substantiate with typical results + disclaimer." },
  { id: "risk-free", category: "deceptive-risk", severity: "block",
    pattern: /\b(?:risk[ -]?free|no[ -]?risk|zero[ -]?risk)\b/i,
    message: "'Risk-free' claim (deceptive unless literally true with no cost/obligation).",
    fix: "Replace with the actual terms (e.g. '14-day money-back')." },
  { id: "absolute-effectiveness", category: "false-guarantee", severity: "block",
    pattern: /\b100\s?%\s?(?:effective|guaranteed|results|success|safe)\b/i,
    message: "Absolute effectiveness/safety claim.",
    fix: "Qualify the claim and cite substantiation." },
  { id: "health-claim", category: "health-claim", severity: "block",
    pattern: /\b(?:cure|cures|heal|heals|reverse|reverses)\b|\blose\s+\d{1,3}\s?(?:lbs|pounds|kg)\b/i,
    message: "Health/medical or weight-loss claim (regulated; requires substantiation).",
    fix: "Remove the medical/weight claim or route to legal with clinical substantiation." },
  { id: "superlative", category: "absolute-superlative", severity: "warn",
    pattern: /(?:#\s?1\b|\bnumber\s?one\b|\bthe\s+best\b|\bworld'?s\s+best\b|\bnation'?s\s+best\b)/i,
    message: "Absolute superlative ('#1', 'the best') without substantiation.",
    fix: "Add a cited basis (e.g. 'rated #1 by <source>') or soften the claim." },
  { id: "unrealistic-timeframe", category: "unrealistic-timeframe", severity: "warn",
    pattern: /\b(?:overnight|instantly|instant|immediately|in\s+\d{1,2}\s+(?:hours|days))\b/i,
    message: "Unrealistic/instant-result timeframe — review for deceptiveness.",
    fix: "State a realistic, typical timeframe or remove." },
];

const MAX_INPUT = 100_000; // ReDoS / cost guard

export interface ComplianceViolation {
  ruleId: string;
  category: ComplianceCategory;
  severity: ComplianceSeverity;
  match: string;
  index: number;
  message: string;
  fix: string;
}

export interface ComplianceResult {
  pass: boolean;                 // true only when there are NO `block` violations
  decision: "pass" | "block";    // the launch decision for ad-claim-compliance
  violations: ComplianceViolation[];
  blocks: number;
  warnings: number;
}

/** Evaluate marketing/ad copy against the ruleset. Pure. A single `block` violation fails the gate. */
export function evaluateClaim(text: string, rules: ComplianceRule[] = COMPLIANCE_RULES): ComplianceResult {
  const t = (text ?? "").length > MAX_INPUT ? text.slice(0, MAX_INPUT) : (text ?? "");
  const violations: ComplianceViolation[] = [];
  for (const r of rules) {
    const m = r.pattern.exec(t);
    if (m) {
      violations.push({
        ruleId: r.id, category: r.category, severity: r.severity,
        match: m[0], index: m.index, message: r.message, fix: r.fix,
      });
    }
  }
  violations.sort((a, b) => a.index - b.index);
  const blocks = violations.filter((v) => v.severity === "block").length;
  const warnings = violations.length - blocks;
  return { pass: blocks === 0, decision: blocks === 0 ? "pass" : "block", violations, blocks, warnings };
}

/** One-line verdict for a run summary / Slack approval. */
export function complianceVerdict(r: ComplianceResult): string {
  if (r.pass && r.warnings === 0) return "PASS — no claim violations.";
  if (r.pass) return `PASS with ${r.warnings} warning(s) to review: ${r.violations.map((v) => v.ruleId).join(", ")}.`;
  return `BLOCK — ${r.blocks} disallowed claim(s): ${r.violations.filter((v) => v.severity === "block").map((v) => v.ruleId).join(", ")}.`;
}
