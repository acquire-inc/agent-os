// Phase 48: Drizzle-backed artifact persistence helpers.
//
// The runner / executor calls these at run close to register artifacts
// in the database so the operator's "output type of interface" can
// render them. Pure DB layer — no policy here.

import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./client.js";

export type ArtifactKind =
  | "file"
  | "doc"
  | "spreadsheet"
  | "image"
  | "link"
  | "json"
  | "markdown"
  | "code";

export interface ArtifactInput {
  tenantId: string;
  runId: string;
  agentId: string;
  kind: ArtifactKind;
  name: string;
  uri?: string | null;
  inlinePayload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export async function registerArtifact(db: Db, args: ArtifactInput): Promise<{ id: string }> {
  if (!args.uri && !args.inlinePayload) {
    throw new Error("registerArtifact: either uri or inlinePayload must be provided");
  }
  const [row] = await db
    .insert(schema.artifacts)
    .values({
      tenantId: args.tenantId,
      runId: args.runId,
      agentId: args.agentId,
      kind: args.kind,
      name: args.name,
      uri: args.uri ?? null,
      inlinePayload: args.inlinePayload ?? null,
      metadata: args.metadata ?? {},
    })
    .returning({ id: schema.artifacts.id });
  if (!row) throw new Error("registerArtifact: insert returned no row");
  return { id: row.id };
}

export async function listArtifactsForRun(
  db: Db,
  tenantId: string,
  runId: string,
): Promise<(typeof schema.artifacts.$inferSelect)[]> {
  return db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.tenantId, tenantId), eq(schema.artifacts.runId, runId)))
    .orderBy(desc(schema.artifacts.createdAt));
}
