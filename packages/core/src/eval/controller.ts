// Scorecard controller — applies a Phase 18 Scorecard verdict to the
// AgentOS autonomy ladder (propose → execute_safe → execute_full).
//
// Pure function. The scheduled job calls computeNextAutonomy(currentAutonomy,
// verdict, isCantFail) to decide what autonomy the agent should be on next.
// The actual UPDATE on agents.autonomy is the job's responsibility — this
// module returns the decision.

import type { Verdict } from "./scorecard.js";

export type Autonomy = "propose" | "execute_safe" | "execute_full";

const LADDER: readonly Autonomy[] = ["propose", "execute_safe", "execute_full"] as const;

export interface ControllerDecision {
  /** What the controller decided. */
  nextAutonomy: Autonomy;
  /** Did the autonomy actually change? */
  changed: boolean;
  /** Human-readable reason. */
  rationale: string;
}

/**
 * Compute the next autonomy given the current autonomy + the scorecard verdict.
 *
 * Rules:
 *   - `force_demote_safety` → propose. Unconditional. Overrides everything.
 *     Even T-critical can't-fail agents get ratcheted to propose — they
 *     should already BE at propose given their nature, but if drift placed
 *     them higher, the safety floor pulls them back.
 *   - `demote` → one step down the ladder (or stay at propose if already there).
 *   - `promote` → one step up the ladder. With one caveat: can't-fail agents
 *     CANNOT be promoted past `execute_safe` — they are not eligible for
 *     `execute_full` regardless of scorecard. The doctrine: can't-fail agents
 *     run with operator-in-the-loop for high-stakes calls; full autonomy on
 *     those is a doctrine violation.
 *   - `hold` / `insufficient_data` → no change.
 */
export function computeNextAutonomy(
  currentAutonomy: Autonomy,
  verdict: Verdict,
  isCantFail: boolean,
): ControllerDecision {
  const idx = LADDER.indexOf(currentAutonomy);
  if (idx < 0) {
    // Unknown current value — bias to safety floor.
    return {
      nextAutonomy: "propose",
      changed: currentAutonomy !== "propose",
      rationale: `unknown current autonomy "${currentAutonomy}" — defaulting to propose floor`,
    };
  }

  switch (verdict) {
    case "force_demote_safety":
      return {
        nextAutonomy: "propose",
        changed: currentAutonomy !== "propose",
        rationale: "force_demote_safety: cantfail.* event in window — pulled to propose",
      };

    case "demote": {
      const nextIdx = Math.max(0, idx - 1);
      const next = LADDER[nextIdx]!;
      return {
        nextAutonomy: next,
        changed: next !== currentAutonomy,
        rationale: `demote: one step down from ${currentAutonomy} → ${next}`,
      };
    }

    case "promote": {
      let nextIdx = Math.min(LADDER.length - 1, idx + 1);
      let cap = "";
      if (isCantFail && LADDER[nextIdx] === "execute_full") {
        // Cap can't-fail agents at execute_safe.
        nextIdx = LADDER.indexOf("execute_safe");
        cap = " (capped at execute_safe — can't-fail agents do not promote to execute_full)";
      }
      const next = LADDER[nextIdx]!;
      return {
        nextAutonomy: next,
        changed: next !== currentAutonomy,
        rationale: `promote: ${currentAutonomy} → ${next}${cap}`,
      };
    }

    case "hold":
    case "insufficient_data":
      return {
        nextAutonomy: currentAutonomy,
        changed: false,
        rationale: `${verdict}: no change`,
      };
  }
}
