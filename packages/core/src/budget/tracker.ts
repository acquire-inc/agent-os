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

export class BudgetTracker {
  private runs = new Map<string, RunBudgetState>();
  private sink: BudgetEventSink;

  constructor(sink?: BudgetEventSink) {
    this.sink = sink ?? (() => {});
  }

  /** Start tracking a run. Called once at run start. Returns the state. */
  openRun(runId: string, capUsd: number): RunBudgetState {
    const existing = this.runs.get(runId);
    if (existing) return existing;
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
    return { ok: true, reason: "ok", state: evt };
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
