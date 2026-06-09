// packages/core/src/change-discipline.ts — the deterministic tool behind tool.5 (One-Change-Per-Day
// Enforcer), used by ad-ops (Wave-1). The discipline constraint on ad-account changes: at most ONE
// change per entity (adset/ad) per calendar day, so the account isn't over-edited and learning isn't
// reset. Pure: given proposed changes + the recent change history, it partitions them into allowed
// vs blocked (already changed today). ad-ops applies the allowed ones and surfaces the rest.

export interface ProposedChange {
  entityId: string;     // the adset/ad the change targets
  entityName?: string;
  action: string;       // scale | cut | pause | ...
}

export interface ChangeRecord {
  entityId: string;
  changedAt: string;    // ISO timestamp of a past change
}

export interface BlockedChange extends ProposedChange { reason: string }

export interface ChangeDisciplineResult {
  allowed: ProposedChange[];
  blocked: BlockedChange[];
  summary: string;
}

/** UTC calendar day (YYYY-MM-DD) of an ISO timestamp. */
function day(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Enforce one change per entity per calendar day. Pure. An entity is locked for `now`'s day if it
 * was changed today (in `history`) OR an earlier proposal in this batch already changed it. Allows
 * the FIRST proposal per entity, blocks the rest. `maxPerDay` defaults to 1.
 */
export function enforceChangeLimit(
  proposals: ProposedChange[],
  history: ChangeRecord[],
  opts: { now?: string; maxPerDay?: number } = {},
): ChangeDisciplineResult {
  const today = day(opts.now ?? new Date().toISOString());
  const maxPerDay = opts.maxPerDay ?? 1;

  // changes already made today, per entity
  const countToday = new Map<string, number>();
  for (const h of history) {
    if (day(h.changedAt) === today) countToday.set(h.entityId, (countToday.get(h.entityId) ?? 0) + 1);
  }

  const allowed: ProposedChange[] = [];
  const blocked: BlockedChange[] = [];
  for (const p of proposals) {
    const used = countToday.get(p.entityId) ?? 0;
    if (used >= maxPerDay) {
      blocked.push({ ...p, reason: `${p.entityName ?? p.entityId} already changed today — one change per ${maxPerDay === 1 ? "day" : `${maxPerDay}/day`}.` });
    } else {
      allowed.push(p);
      countToday.set(p.entityId, used + 1); // count this proposal so a duplicate in-batch is blocked
    }
  }
  const summary = `${allowed.length} change(s) allowed, ${blocked.length} held (one-change-per-day).`;
  return { allowed, blocked, summary };
}
