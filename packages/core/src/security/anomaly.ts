// anomaly.ts — windowed usage-spike scan for the `security-anomaly-watchdog`
// agent.
//
// Pitfall 3 (RESEARCH.md): audit_log accrues volume FAST under the runner
// (every tool call writes one row). A naive "compare all-time avg vs today"
// scan crushes the planner once the table crosses a few million rows. The
// mitigations encoded here:
//   1. 24h rolling current window — never scans the full table.
//   2. 7-day baseline restricted to days 8→1 prior — fixed lookback, planner
//      uses audit_log_tenant_ts_idx (migration 0010, plan 09-01).
//   3. Absolute floor `n > 10` — short-circuits the trivial "1 call vs 0 calls
//      = infinity ratio" false-positive class.
//   4. 5× ratio threshold — D-07 says day-1 thresholds stay loose; tightening
//      is the agent-evaluator's job once we have ground-truth incidents.
//
// Constants are inline (not knobs) by design — Pitfall 3 mitigation should
// not be tunable via runtime param surgery.

import { type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

export interface UsageSpikeRow extends Record<string, unknown> {
  tool_name: string;
  n: number;
  daily_avg: number | null;
  ratio: number | null;
}

export async function detectUsageSpikes(
  db: Db,
  tenantId: string,
  window: { hours: number } = { hours: 24 },
) {
  return db.execute<UsageSpikeRow>(sql`
    with current_window as (
      select tool_name, count(*) as n
      from audit_log
      where tenant_id = ${tenantId}
        and ts > now() - (${window.hours} || ' hours')::interval
      group by tool_name
    ),
    baseline as (
      select tool_name, count(*)::float / 7 as daily_avg
      from audit_log
      where tenant_id = ${tenantId}
        and ts between now() - interval '8 days' and now() - interval '1 day'
      group by tool_name
    )
    select c.tool_name, c.n, b.daily_avg, c.n / nullif(b.daily_avg, 0) as ratio
    from current_window c
    left join baseline b using (tool_name)
    where c.n > 10
      and (b.daily_avg is null or c.n / nullif(b.daily_avg, 0) > 5)
  `);
}
