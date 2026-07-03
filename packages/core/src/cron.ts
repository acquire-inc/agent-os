import { CronExpressionParser } from "cron-parser";

/** The most recent time this cron should have fired at or before `now` (UTC), or null. */
export function previousTick(cron: string, now: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: now, tz: "UTC" });
    return interval.prev().toDate();
  } catch {
    return null;
  }
}

// (nextTick and isValidCron were removed in the Phase 70 cleanup — only
// previousTick has consumers. Restore from git history if the scheduler ever
// needs forward-looking ticks or seed-time cron validation.)
