// Phase 53: tenant-level monthly cost cap math.
//
// Pure functions. The caller (chat dispatch endpoint, runner
// SessionStart) supplies the tenant's `monthlyBudgetUsd`, the live
// `monthToDateUsd`, and an optional `forecastUsd` for an inbound run.
// We return whether the run can proceed and how much budget remains.
//
// Tenants with `monthlyBudgetUsd === null` have no cap — those flows
// pass through with `ok: true` and `cap: null`.

export interface TenantBudgetCheck {
  /** True iff the run can proceed (no cap, or cap not yet breached
   *  including the optional forecast). */
  ok: boolean;
  /** Budget remaining after the forecast lands (negative when over). */
  remainingUsd: number;
  /** 0..100. */
  percentUsed: number;
  /** Cap (null when tenant has no monthly budget set). */
  capUsd: number | null;
  /** Month-to-date spend at check time. */
  monthToDateUsd: number;
  /** When forecastUsd was supplied: month-to-date + forecast. */
  projectedAfterRunUsd: number;
  /** Reason if !ok. */
  reason?: string;
}

export interface TenantBudgetCheckArgs {
  /** From tenants.monthly_budget_usd. Null = no cap. */
  monthlyBudgetUsd: number | null;
  /** Live month-to-date USD spend. From tenant_month_to_date_usd(). */
  monthToDateUsd: number;
  /** Optional forecast for the run being considered. 0 when unknown. */
  forecastUsd?: number;
  /** Warning threshold percentage (default 90). Doesn't gate; surfaces
   *  via the `reason` field when crossed but ok stays true. */
  warnPercentage?: number;
}

export function checkTenantBudget(args: TenantBudgetCheckArgs): TenantBudgetCheck {
  const cap = args.monthlyBudgetUsd;
  const mtd = args.monthToDateUsd;
  const forecast = args.forecastUsd ?? 0;
  const projected = mtd + forecast;
  const warnPct = args.warnPercentage ?? 90;

  if (cap === null || cap === undefined) {
    return {
      ok: true,
      remainingUsd: Number.POSITIVE_INFINITY,
      percentUsed: 0,
      capUsd: null,
      monthToDateUsd: mtd,
      projectedAfterRunUsd: projected,
    };
  }

  if (cap <= 0) {
    return {
      ok: false,
      remainingUsd: -mtd,
      percentUsed: mtd > 0 ? 100 : 0,
      capUsd: cap,
      monthToDateUsd: mtd,
      projectedAfterRunUsd: projected,
      reason: `monthly_budget_usd is ${cap.toFixed(2)} — no spend allowed`,
    };
  }

  const remaining = cap - projected;
  const percentUsed = (projected / cap) * 100;

  if (projected > cap) {
    return {
      ok: false,
      remainingUsd: remaining,
      percentUsed: Math.min(percentUsed, 100),
      capUsd: cap,
      monthToDateUsd: mtd,
      projectedAfterRunUsd: projected,
      reason: `projected ${projected.toFixed(4)} USD exceeds monthly cap ${cap.toFixed(2)} USD (mtd ${mtd.toFixed(4)} + forecast ${forecast.toFixed(4)})`,
    };
  }

  const reason = percentUsed >= warnPct
    ? `WARN: ${percentUsed.toFixed(1)}% of monthly budget used (forecast lands at ${projected.toFixed(4)} of ${cap.toFixed(2)})`
    : undefined;

  return {
    ok: true,
    remainingUsd: remaining,
    percentUsed,
    capUsd: cap,
    monthToDateUsd: mtd,
    projectedAfterRunUsd: projected,
    reason,
  };
}
