// Input/output contract for tool.rls-test (Phase 9).
import { z } from "zod";

export const IsolationInputSchema = z.object({
  tenantPairs: z
    .array(
      z.object({
        userA: z.string().uuid(),
        userB: z.string().uuid(),
        tenantA: z.string().uuid(),
        tenantB: z.string().uuid(),
      }),
    )
    .min(1),
  /** Optional table allowlist — when set, only vectors covering these tables run. */
  tables: z.array(z.string()).optional(),
});

export type IsolationInput = z.infer<typeof IsolationInputSchema>;

export interface VectorResult {
  id: string;
  table: string;
  passed: boolean;
  /** Rows returned by the cross-tenant attack — MUST be 0 for `passed: true`. */
  actual: number;
  expected: 0;
  /** Free-form notes (e.g. "positive control returned N rows; attack returned 0"). */
  notes?: string;
}

export interface IsolationResult {
  resultsPath: string;
  passed: boolean;
  count: number;
}
