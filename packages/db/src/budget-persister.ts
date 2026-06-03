// Phase 31: Drizzle-backed BudgetTracker persister.
//
// The runtime tracker accepts a ReservationPersister; this module produces
// one over the budget_reservations table (migration 0018) using the
// project's existing Db handle.

import { eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./client.js";

export interface ReservationPersisterMinimal {
  insert: (args: {
    id: string;
    tenantId: string;
    runId: string;
    amountUsd: number;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  listForRun: (runId: string) => Promise<{ id: string; amountUsd: number }[]>;
}

export function makeReservationPersister(db: Db): ReservationPersisterMinimal {
  return {
    insert: async (args) => {
      await db.insert(schema.budgetReservations).values({
        id: args.id,
        tenantId: args.tenantId,
        runId: args.runId,
        amountUsd: args.amountUsd.toString(),
        metadata: args.metadata ?? {},
      });
    },
    remove: async (id) => {
      await db.delete(schema.budgetReservations).where(eq(schema.budgetReservations.id, id));
    },
    listForRun: async (runId) => {
      const rows = await db
        .select({ id: schema.budgetReservations.id, amountUsd: schema.budgetReservations.amountUsd })
        .from(schema.budgetReservations)
        .where(eq(schema.budgetReservations.runId, runId));
      return rows.map((r) => ({ id: r.id, amountUsd: Number(r.amountUsd) }));
    },
  };
}
