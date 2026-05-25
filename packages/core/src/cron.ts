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

/** The next time this cron will fire after `now` (UTC), or null. */
export function nextTick(cron: string, now: Date = new Date()): Date | null {
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: now, tz: "UTC" });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export function isValidCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}
