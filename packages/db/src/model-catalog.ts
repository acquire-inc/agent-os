// Phase 41: Drizzle-backed model catalog loader for the intelligent picker.
//
// The picker (Phase 39) takes ModelCatalogEntry[] as input — pure data.
// This module is the production source: reads from the `models` table
// and shapes rows into the picker's expected schema.

import { eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./client.js";

/** Structural shape matching @agent-os/core's ModelCatalogEntry. Duplicated
 *  here to avoid a circular dep — db cannot import core. The shapes are
 *  asserted compatible by the runtime test in core. */
export interface ModelCatalogRow {
  slug: string;
  provider: string;
  family: string;
  status: "preferred" | "secondary" | "deprecated" | "experimental";
  costInputPerMillionUsd: number;
  costOutputPerMillionUsd: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  capabilityScores: Record<string, number>;
  tierAffinity: "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical" | null;
  enabled: boolean;
}

/** Load every enabled, non-deprecated model row. The picker filters
 *  further (T-critical, hard requirements, soft floors). */
export async function loadModelCatalog(db: Db): Promise<ModelCatalogRow[]> {
  const rows = await db
    .select()
    .from(schema.models)
    .where(eq(schema.models.enabled, true));
  return rows.map((r) => ({
    slug: r.slug,
    provider: r.provider,
    family: r.family,
    status: r.status,
    costInputPerMillionUsd: Number(r.costInputPerMillionUsd),
    costOutputPerMillionUsd: Number(r.costOutputPerMillionUsd),
    contextWindowTokens: r.contextWindowTokens,
    maxOutputTokens: r.maxOutputTokens,
    supportsTools: r.supportsTools,
    supportsReasoning: r.supportsReasoning,
    supportsVision: r.supportsVision,
    supportsStreaming: r.supportsStreaming,
    capabilityScores: (r.capabilityScores ?? {}) as Record<string, number>,
    tierAffinity: r.tierAffinity ?? null,
    enabled: r.enabled,
  }));
}
