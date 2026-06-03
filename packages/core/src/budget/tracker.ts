// Per-run budget tracker — implements the cost-ceiling-discipline skill's
// reserve / commit / release contract.
//
// Pure in-memory state, keyed by runId. The runner instantiates one
// BudgetTracker per process and threads it into the tool-dispatch path.
// On runner restart mid-run, the run's in-flight reserve state is lost
// but the committed total survives in runs.cost_usd; the next dispatch
// re-reads the actual spend and rebuilds a fresh tracker for that run.
//
// When db-backed persistence lands (separate phase + migration), the same
// interface gets a db-backed implementation — callers don't change.

export type BudgetEventName =
  | "budget.reserved"
  | "budget.committed"
  | "budget.released"
  | "budget.cap_breached"
  | "budget.summary";

export interface BudgetEvent {
  eventName: BudgetEventName;
  runId: string;
  amountUsd: number;
  /** Running balance AFTER this event lands. */
  reservedTotal: number;
  committedTotal: number;
  releasedTotal: number;
  /** True effective spend = committedTotal. reservedTotal is in-flight. */
  effectiveSpend: number;
  capUsd: number;
  metadata?: Record<string, unknown>;
}

export type BudgetEventSink = (evt: BudgetEvent) => void;

interface RunBudgetState {
  runId: string;
  capUsd: number;
  reservedTotal: number;
  committedTotal: number;
  releasedTotal: number;
  /** Per-reservation map so commits/releases can match by reservationId. */
  reservations: Map<string, number>;
  nextReservationSeq: number;
  /** True iff a cap_breached event has already fired for this run (avoid spam). */
  capBreached: boolean;
}

export interface ReserveResult {
  ok: boolean;
  reservationId: string | null;
  reason: "ok" | "would_breach_cap" | "unknown_run";
  state: BudgetEvent;
}

export interface CommitResult {
  ok: boolean;
  reason: "ok" | "unknown_reservation" | "unknown_run";
  /** Final committed delta vs reserved (positive = under, negative = over). */
  delta: number;
  state: BudgetEvent;
}

export interface ReleaseResult {
  ok: boolean;
  reason: "ok" | "unknown_reservation" | "unknown_run";
  state: BudgetEvent;
}

/** Phase 31: optional db-backed persistence for the in-flight reservations.
 *  When supplied, the tracker writes through to the backing store on
 *  reserve/commit/release, and the singleton's openRun re-hydrates from
 *  the store on startup so reservations survive runner restart. */
export interface ReservationPersister {
  insert: (args: {
    id: string;
    tenantId: string;
    runId: string;
    amountUsd: number;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Read all reservations for a run — used to re-hydrate on tracker boot. */
  listForRun: (runId: string) => Promise<{ id: string; amountUsd: number }[]>;
}

export class BudgetTracker {
  private runs = new Map<string, RunBudgetState>();
  private sink: BudgetEventSink;
  private persister: ReservationPersister | null;
  /** Per-run tenant id captured at openRun for persister calls. */
  private runTenantIds = new Map<string, string>();

  constructor(sink?: BudgetEventSink, persister?: ReservationPersister) {
    this.sink = sink ?? (() => {});
    this.persister = persister ?? null;
  }

  /** Phase 31: provide tenant context for persister calls when openRun is
   *  used in places that have a tenantId at the call site. The singleton
   *  pattern in apps/runner/src/budget.ts sets this from the bundle. */
  setRunTenant(runId: string, tenantId: string): void {
    this.runTenantIds.set(runId, tenantId);
  }

  /** Start tracking a run. Called once at run start. Returns the state.
   *
   * WR-06 fix: throw on key collision instead of silently returning the
   * existing state. The prior behavior leaked the old cap + reservations
   * into the new run when a runId was accidentally reused (test fixture,
   * a misbehaving caller, etc.) — silent failure mode. The executeRun
   * path opens exactly once per run; legitimate reuse does not exist.
   */
  openRun(runId: string, capUsd: number): RunBudgetState {
    if (this.runs.has(runId)) {
      throw new Error(
        `BudgetTracker.openRun: run ${runId} already open — would leak prior reservations/cap into a new run`,
      );
    }
    const state: RunBudgetState = {
      runId,
      capUsd,
      reservedTotal: 0,
      committedTotal: 0,
      releasedTotal: 0,
      reservations: new Map(),
      nextReservationSeq: 1,
      capBreached: false,
    };
    this.runs.set(runId, state);
    return state;
  }

  hasRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  reserveSpend(runId: string, amountUsd: number, metadata?: Record<string, unknown>): ReserveResult {
    const state = this.runs.get(runId);
    if (!state) {
      return {
        ok: false,
        reservationId: null,
        reason: "unknown_run",
        state: this.emptyEvent("budget.reserved", runId, amountUsd, 0),
      };
    }
    const projected = state.committedTotal + state.reservedTotal + amountUsd;
    if (projected > state.capUsd) {
      // Cap breach — emit cap_breached, refuse the reserve.
      if (!state.capBreached) {
        state.capBreached = true;
        const breachEvent = this.toEvent("budget.cap_breached", state, amountUsd, metadata);
        this.sink(breachEvent);
      }
      return {
        ok: false,
        reservationId: null,
        reason: "would_breach_cap",
        state: this.toEvent("budget.cap_breached", state, amountUsd, metadata),
      };
    }
    const reservationId = `${runId}:r${state.nextReservationSeq++}`;
    state.reservations.set(reservationId, amountUsd);
    state.reservedTotal += amountUsd;
    const evt = this.toEvent("budget.reserved", state, amountUsd, { ...metadata, reservationId });
    this.sink(evt);
    // Phase 31: write-through to the persister so the reservation survives
    // runner restart. Best-effort — log on failure but don't roll back the
    // in-memory reserve (the audit trail is still in the Relay budget.reserved
    // event above; the table is just a transient ledger for re-hydration).
    if (this.persister) {
      const tenantId = this.runTenantIds.get(runId);
      if (tenantId) {
        this.persister
          .insert({ id: reservationId, tenantId, runId, amountUsd, metadata })
          .catch((e) => {
            console.error(`[BudgetTracker] persister.insert failed for ${reservationId}: ${(e as Error).message}`);
          });
      }
    }
    return { ok: true, reservationId, reason: "ok", state: evt };
  }

  commitSpend(
    runId: string,
    reservationId: string,
    actualUsd: number,
    metadata?: Record<string, unknown>,
  ): CommitResult {
    const state = this.runs.get(runId);
    if (!state) {
      return {
        ok: false,
        reason: "unknown_run",
        delta: 0,
        state: this.emptyEvent("budget.committed", runId, actualUsd, 0),
      };
    }
    const reservedAmount = state.reservations.get(reservationId);
    if (reservedAmount == null) {
      return {
        ok: false,
        reason: "unknown_reservation",
        delta: 0,
        state: this.toEvent("budget.committed", state, actualUsd, metadata),
      };
    }
    state.reservations.delete(reservationId);
    state.reservedTotal -= reservedAmount;
    state.committedTotal += actualUsd;
    const delta = reservedAmount - actualUsd; // positive = under; negative = over
    const evt = this.toEvent("budget.committed", state, actualUsd, {
      ...metadata,
      reservationId,
      reservedAmount,
      delta,
    });
    this.sink(evt);
    // Phase 31: remove the persisted reservation. Best-effort.
    if (this.persister) {
      this.persister.remove(reservationId).catch((e) => {
        console.error(`[BudgetTracker] persister.remove failed for ${reservationId}: ${(e as Error).message}`);
      });
    }
    return { ok: true, reason: "ok", delta, state: evt };
  }

  releaseSpend(
    runId: string,
    reservationId: string,
    metadata?: Record<string, unknown>,
  ): ReleaseResult {
    const state = this.runs.get(runId);
    if (!state) {
      return {
        ok: false,
        reason: "unknown_run",
        state: this.emptyEvent("budget.released", runId, 0, 0),
      };
    }
    const reservedAmount = state.reservations.get(reservationId);
    if (reservedAmount == null) {
      return {
        ok: false,
        reason: "unknown_reservation",
        state: this.toEvent("budget.released", state, 0, metadata),
      };
    }
    state.reservations.delete(reservationId);
    state.reservedTotal -= reservedAmount;
    state.releasedTotal += reservedAmount;
    const evt = this.toEvent("budget.released", state, reservedAmount, {
      ...metadata,
      reservationId,
    });
    this.sink(evt);
    // Phase 31: remove the persisted reservation. Best-effort.
    if (this.persister) {
      this.persister.remove(reservationId).catch((e) => {
        console.error(`[BudgetTracker] persister.remove failed for ${reservationId}: ${(e as Error).message}`);
      });
    }
    return { ok: true, reason: "ok", state: evt };
  }

  /** Phase 31: re-hydrate in-flight reservations from the persister.
   *  Called after openRun on a runner restart so the tracker can resume
   *  enforcement from where the prior process left off. The
   *  reservedTotal is reconstructed; committedTotal stays 0 (the
   *  committed totals are sourced from runs.cost_usd by the caller). */
  async hydrateRun(runId: string): Promise<{ rehydratedCount: number } | null> {
    if (!this.persister) return null;
    const state = this.runs.get(runId);
    if (!state) return null;
    const rows = await this.persister.listForRun(runId);
    for (const row of rows) {
      state.reservations.set(row.id, row.amountUsd);
      state.reservedTotal += row.amountUsd;
      // Update nextReservationSeq to be > the max seq in the rehydrated set.
      const m = row.id.match(/:r(\d+)$/);
      if (m) {
        const seq = Number(m[1]);
        if (seq >= state.nextReservationSeq) {
          state.nextReservationSeq = seq + 1;
        }
      }
    }
    return { rehydratedCount: rows.length };
  }

  /** Emit a summary event for the run and remove it from the tracker. */
  closeRun(runId: string, metadata?: Record<string, unknown>): BudgetEvent | null {
    const state = this.runs.get(runId);
    if (!state) return null;
    const evt = this.toEvent("budget.summary", state, state.committedTotal, {
      ...metadata,
      reservationsOutstanding: state.reservations.size,
      capUtilizationPct: state.capUsd > 0 ? Math.round((state.committedTotal / state.capUsd) * 100) : 0,
    });
    this.sink(evt);
    this.runs.delete(runId);
    this.runTenantIds.delete(runId);
    return evt;
  }

  /** Read-only snapshot for tests / debug. */
  snapshot(runId: string): RunBudgetState | null {
    return this.runs.get(runId) ?? null;
  }

  private toEvent(
    eventName: BudgetEventName,
    state: RunBudgetState,
    amountUsd: number,
    metadata?: Record<string, unknown>,
  ): BudgetEvent {
    return {
      eventName,
      runId: state.runId,
      amountUsd,
      reservedTotal: state.reservedTotal,
      committedTotal: state.committedTotal,
      releasedTotal: state.releasedTotal,
      effectiveSpend: state.committedTotal,
      capUsd: state.capUsd,
      metadata,
    };
  }

  private emptyEvent(
    eventName: BudgetEventName,
    runId: string,
    amountUsd: number,
    capUsd: number,
  ): BudgetEvent {
    return {
      eventName,
      runId,
      amountUsd,
      reservedTotal: 0,
      committedTotal: 0,
      releasedTotal: 0,
      effectiveSpend: 0,
      capUsd,
    };
  }
}
