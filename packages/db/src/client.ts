import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const sql = postgres(connectionString, { prepare: false });
  return drizzle(sql, { schema });
}

type Connection = ReturnType<typeof createDb>;

/** Db is the union of the top-level connection AND the transaction handle
 *  passed by `db.transaction(async (tx) => ...)`. Every internal helper that
 *  reads/writes typed by `Db` works inside or outside of a transaction. The
 *  `$client` property is only on Connection, but no helper in the codebase
 *  needs it — keeping it on the union would block the tx-handle from being
 *  passed in, which is the Wave-C atomicity pattern. */
export type Db = Omit<Connection, "$client"> | Parameters<Parameters<Connection["transaction"]>[0]>[0];
