// packages/core/src/ad-rules.ts — the deterministic tool behind tool.4 (Rules Engine), used by the
// ad-ops agent (Wave-1). Pure: given an adset's performance it returns a color + a PROPOSED action
// per the doctrine's color-coded media-buying rules. Pausing/scaling are irreversible spend actions
// → flagged requiresApproval so ad-ops proposes (never auto-executes) under propose/execute_safe.

export type AdColor = "green" | "yellow" | "red";
export type AdAction = "scale" | "hold" | "cut" | "pause";

export interface AdsetPerf {
  name: string;
  cpa: number;          // current cost per acquisition
  targetCpa: number;    // the account's target CPA
  spend: number;        // spend in the window
  conversions: number;
  daysRunning: number;
  roas?: number;
}

export interface AdRuleResult {
  name: string;
  color: AdColor;
  action: AdAction;
  requiresApproval: boolean; // true for irreversible spend changes (scale/cut/pause)
  rationale: string;
}

// Learning-window guardrails: don't judge an adset before it has had a fair chance.
const MIN_DAYS = 3;
const MIN_CONVERSIONS = 3;
const MIN_SPEND = 50;
const YELLOW_CEIL = 1.3; // ≤1.3× target = watch; >1.3× sustained = cut/kill

/** Evaluate one adset against the color rules. Pure. */
export function evaluateAdset(a: AdsetPerf): AdRuleResult {
  const learning = a.daysRunning < MIN_DAYS || a.conversions < MIN_CONVERSIONS || a.spend < MIN_SPEND;
  if (learning) {
    return { name: a.name, color: "yellow", action: "hold", requiresApproval: false,
      rationale: `Still in the learning window (${a.daysRunning}d, ${a.conversions} conv, $${a.spend}) — hold, don't judge yet.` };
  }
  const ratio = a.targetCpa > 0 ? a.cpa / a.targetCpa : Infinity;
  if (ratio <= 1) {
    return { name: a.name, color: "green", action: "scale", requiresApproval: true,
      rationale: `CPA $${a.cpa} at/under target $${a.targetCpa} — propose a measured budget scale.` };
  }
  if (ratio <= YELLOW_CEIL) {
    return { name: a.name, color: "yellow", action: "hold", requiresApproval: false,
      rationale: `CPA $${a.cpa} is ${(ratio * 100 - 100).toFixed(0)}% over target — watch, hold budget.` };
  }
  // Red: well over target with real data → propose cutting budget, or pause if it's badly over.
  const action: AdAction = ratio >= 2 ? "pause" : "cut";
  return { name: a.name, color: "red", action, requiresApproval: true,
    rationale: `CPA $${a.cpa} is ${(ratio * 100 - 100).toFixed(0)}% over target $${a.targetCpa} for ${a.daysRunning}d — propose ${action}.` };
}

export interface AdRulesReport {
  results: AdRuleResult[];
  /** Proposals that change spend (irreversible) — these go to the Approvals inbox. */
  proposals: AdRuleResult[];
  summary: string;
}

/** Evaluate a batch of adsets → per-adset colors + the irreversible proposals to surface. Pure. */
export function evaluateAdRules(adsets: AdsetPerf[]): AdRulesReport {
  const results = adsets.map(evaluateAdset);
  const proposals = results.filter((r) => r.requiresApproval);
  const counts = results.reduce((m, r) => ((m[r.color] = (m[r.color] ?? 0) + 1), m), {} as Record<AdColor, number>);
  const summary = `${results.length} adsets: ${counts.green ?? 0} green / ${counts.yellow ?? 0} yellow / ${counts.red ?? 0} red. ${proposals.length} action(s) proposed for approval.`;
  return { results, proposals, summary };
}
