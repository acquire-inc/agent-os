// Judge-calibration loop (V3 E2) — is the critic quorum still aligned with
// the humans it stands in for?
//
// Concept re-authored from the "judge-calibration" pattern (external survey
// 2026-07-21; license=NONE upstream, mechanism re-authored): a peer-review
// layer only earns trust while its verdicts TRACK the operator's. Whenever a
// proposal receives BOTH a critic-quorum outcome and (later) a human
// decision — escalations, samples, overrides — that pair is a free
// calibration point. Sustained disagreement means the judge drifted: its
// stake threshold is wrong, its critics degraded, or the work changed under
// it. Drift must SURFACE (health strip + relay event) before anyone quietly
// widens the quorum's authority.
//
// Doctrine: calibration NEVER auto-adjusts the critic policy. It measures
// and reports; the operator decides. (Anti-reward-hacking: the measuring
// stick is write-protected from the thing being measured.)
//
// Pure decision functions + sink runner, offline-testable.

export interface CalibrationPair {
  approvalId: string;
  /** What the critic quorum concluded. */
  quorumOutcome: "approved" | "escalate_to_human";
  /** What the human ultimately decided on the same proposal. */
  humanDecision: "approved" | "rejected";
}

export interface CalibrationReport {
  sampleSize: number;
  /** Pairs where quorum approval matched human approval, or quorum
   *  escalation preceded a human rejection (the escalation was warranted). */
  agreements: number;
  agreementRate: number; // 0..1; NaN-free (0 when sampleSize 0)
  /** Quorum said approve, human later rejected — the DANGEROUS direction:
   *  the peer layer green-lit something a human would have stopped. */
  falseApprovals: number;
  /** Quorum escalated, human approved — friction, not danger. */
  falseEscalations: number;
  drifted: boolean;
  rationale: string;
}

export const CALIBRATION_MIN_SAMPLE = 10;
export const CALIBRATION_AGREEMENT_FLOOR = 0.8;
/** Any false approval is worth flagging once the sample is real — the
 *  failure direction is asymmetric (a false approval is a human veto the
 *  quorum bypassed; a false escalation is just extra work). */
export const CALIBRATION_MAX_FALSE_APPROVAL_RATE = 0.05;

function agrees(p: CalibrationPair): boolean {
  if (p.quorumOutcome === "approved") return p.humanDecision === "approved";
  return p.humanDecision === "rejected"; // escalation was warranted
}

/**
 * Compute the calibration report over the observed pairs. Pure; caller
 * bounds the window (typically trailing 30 days).
 */
export function calibrateJudge(
  pairs: ReadonlyArray<CalibrationPair>,
  opts: {
    minSample?: number;
    agreementFloor?: number;
    maxFalseApprovalRate?: number;
  } = {},
): CalibrationReport {
  const minSample = opts.minSample ?? CALIBRATION_MIN_SAMPLE;
  const floor = opts.agreementFloor ?? CALIBRATION_AGREEMENT_FLOOR;
  const maxFar = opts.maxFalseApprovalRate ?? CALIBRATION_MAX_FALSE_APPROVAL_RATE;

  const sampleSize = pairs.length;
  let agreements = 0;
  let falseApprovals = 0;
  let falseEscalations = 0;
  for (const p of pairs) {
    if (agrees(p)) agreements++;
    else if (p.quorumOutcome === "approved") falseApprovals++;
    else falseEscalations++;
  }
  const agreementRate = sampleSize === 0 ? 0 : agreements / sampleSize;
  const falseApprovalRate = sampleSize === 0 ? 0 : falseApprovals / sampleSize;

  if (sampleSize < minSample) {
    return {
      sampleSize,
      agreements,
      agreementRate,
      falseApprovals,
      falseEscalations,
      drifted: false,
      rationale: `${sampleSize} pairs < minimum ${minSample} — no verdict; keep collecting`,
    };
  }
  if (falseApprovalRate > maxFar) {
    return {
      sampleSize,
      agreements,
      agreementRate,
      falseApprovals,
      falseEscalations,
      drifted: true,
      rationale: `false-approval rate ${(falseApprovalRate * 100).toFixed(1)}% > ${(maxFar * 100).toFixed(0)}% — the quorum green-lit work humans would have stopped; tighten the stake cap or critic floor`,
    };
  }
  if (agreementRate < floor) {
    return {
      sampleSize,
      agreements,
      agreementRate,
      falseApprovals,
      falseEscalations,
      drifted: true,
      rationale: `agreement ${(agreementRate * 100).toFixed(1)}% < floor ${(floor * 100).toFixed(0)}% — judge drift; recalibrate before widening quorum authority`,
    };
  }
  return {
    sampleSize,
    agreements,
    agreementRate,
    falseApprovals,
    falseEscalations,
    drifted: false,
    rationale: `agreement ${(agreementRate * 100).toFixed(1)}% over ${sampleSize} pairs — quorum tracks the operator`,
  };
}

// ─── Sink runner ───────────────────────────────────────────────────────

export interface CalibrationSink {
  /** Load quorum-vs-human pairs for the trailing window. */
  loadPairs(tenantId: string): Promise<CalibrationPair[]>;
  /** Emit `critic.calibration_drift` when drifted (only then — quiet when healthy). */
  emitDrift(input: { tenantId: string; report: CalibrationReport }): Promise<void>;
}

export async function runJudgeCalibration(
  tenantId: string,
  sink: CalibrationSink,
): Promise<CalibrationReport> {
  const pairs = await sink.loadPairs(tenantId);
  const report = calibrateJudge(pairs);
  if (report.drifted) {
    await sink.emitDrift({ tenantId, report });
  }
  return report;
}
