// relay/emit.ts — the single insert helper for the Relay event bus.
//
// Every internal emission point (runner hooks, lifecycle writers, security
// findings recorder, autonomy gate, cost cap, knowledge writer) calls this.
// The external Pixel SDK (GENX-PLAN.md §4) writes through /relay/ingest which
// ALSO uses this helper after validating the tenant API key.
//
// Validates the event_name against the closed registry (events.ts) before
// the DB insert — unknown names throw, never reach the table.
//
// Idempotency: when `eventKey` is supplied, a duplicate (tenant_id, event_key)
// pair is silently dropped (the unique partial index in migration 0011 catches
// it; emit() returns the existing row id). External Pixel callers MUST stamp
// eventKey for replay safety; internal callers MAY supply it for the same
// reason on retry-prone paths (the SessionEnd composer uses event_id = run_id
// so a re-composed terminal event is a no-op).

import { schema, type Db } from "@agent-os/db";
import { and, eq } from "drizzle-orm";
import { isEventName, type EventName } from "./events.js";

const { relayEvents } = schema;

export type RelayActor = "agent" | "system" | "human" | "external";
export type ConsentScope = "tenant_only" | "cross_tenant_aggregated";
export type PiiClass = "none" | "internal_id" | "client_pii";

export interface RelayEmitArgs {
  tenantId: string;
  eventName: EventName | string;
  actor: RelayActor;
  payload?: Record<string, unknown>;
  agentId?: string | null;
  runId?: string | null;
  actorId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  eventKey?: string | null;
  consentScope?: ConsentScope;
  piiClass?: PiiClass;
  /** Defaults to now() if omitted. External Pixel callers stamp this from the SDK clock. */
  occurredAt?: Date;
}

export type RelayEvent = typeof schema.relayEvents.$inferSelect;

export async function emit(db: Db, args: RelayEmitArgs): Promise<RelayEvent> {
  if (!isEventName(args.eventName)) {
    throw new Error(
      `relay.emit: unknown event_name "${args.eventName}". ` +
        `Closed namespace — see packages/core/src/relay/events.ts EVENT_NAMES. ` +
        `Adding a new event requires a code-reviewed PR.`,
    );
  }

  const row = {
    tenantId: args.tenantId,
    agentId: args.agentId ?? null,
    runId: args.runId ?? null,
    actor: args.actor,
    actorId: args.actorId ?? null,
    eventName: args.eventName,
    payload: args.payload ?? {},
    correlationId: args.correlationId ?? null,
    causationId: args.causationId ?? null,
    eventKey: args.eventKey ?? null,
    consentScope: args.consentScope ?? "tenant_only",
    piiClass: args.piiClass ?? "none",
    occurredAt: args.occurredAt ?? new Date(),
  };

  // Idempotency: if eventKey is set, return the existing row instead of
  // inserting a duplicate. The unique partial index would reject the insert
  // anyway; we do the lookup first so the caller gets a clean row id back.
  if (args.eventKey) {
    const [existing] = await db
      .select()
      .from(relayEvents)
      .where(and(eq(relayEvents.tenantId, args.tenantId), eq(relayEvents.eventKey, args.eventKey)))
      .limit(1);
    if (existing) return existing;
  }

  const [inserted] = await db.insert(relayEvents).values(row).returning();
  return inserted!;
}
