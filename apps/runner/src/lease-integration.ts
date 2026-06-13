// Runner-side wrapper for agent lease arbitration (I-003).
//
// This helper sits between the runner's tool-dispatch path
// (custom-tools.ts dispatchCustomTool) and the pure lease module
// (@agent-os/core lease.ts). The wrapper carries the runner's view
// of the caller — bundle.agent identity + the target spec — and
// returns a single `proceed | yield` answer the call site can act on
// without depending on the underlying decision shape.
//
// Today this helper is callable but NOT yet called by dispatchCustomTool
// (TODO marker lives at the call site). When the operator pushes
// migration 0029 and wires `LeaseSink` into lifecycle.ts, drop the
// snippet documented at the call site to activate lease enforcement.
// Until then, this file is the agent-readable spec + the unit-tested
// wrapper.

import type { ActiveLease, LeaseSink, LeaseTarget } from "@agent-os/core";
import { requestLease } from "@agent-os/core";

export interface AcquireForToolCallInput {
  runId: string;
  agentId: string;
  agentKey: string;
  /** Whether bundle.agent.key is on CANT_FAIL_KEYS. Caller-passed (same
   *  convention as router/resolve.ts) so this module stays free of
   *  cross-module deps. */
  isCantFail: boolean;
  /** Target spec the tool dispatch will mutate. Caller (the runner)
   *  computes this from the tool input — typically a connector record
   *  id, lead id, deal id, or objective id. Pass null for tools that
   *  don't sequenceable resources (read-only, retrieval). */
  target: LeaseTarget | null;
  /** Optional override; defaults applied by core. */
  ttlMs?: number;
}

export type AcquireForToolCallResult =
  | { proceed: true; lease: ActiveLease | null; rationale: string }
  | { proceed: false; lease: null; retryAfterMs: number; rationale: string };

/**
 * Try to acquire (or renew/preempt) a lease before dispatching a tool that
 * targets a sequenceable resource. The runner uses the boolean answer:
 *   - proceed=true  -> dispatch the tool, then call releaseLease() on the
 *                      returned lease.id at terminal.
 *   - proceed=false -> yield this dispatch attempt; the SDK should re-ask
 *                      later (the runner converts retryAfterMs to a back-off).
 *
 * When `target` is null the wrapper short-circuits with proceed=true —
 * tools that don't take a sequenceable resource never wait on a lease.
 */
export async function acquireLeaseForToolCall(
  input: AcquireForToolCallInput,
  sink: LeaseSink,
): Promise<AcquireForToolCallResult> {
  if (!input.target) {
    return { proceed: true, lease: null, rationale: "no target — tool is not sequenceable" };
  }
  const result = await requestLease(
    {
      target: input.target,
      requestedBy: {
        ownerAgentId: input.agentId,
        ownerRunId: input.runId,
        ownerIsCantFail: input.isCantFail,
      },
      ttlMs: input.ttlMs,
    },
    sink,
  );
  if (result.decision.kind === "conflict") {
    return {
      proceed: false,
      lease: null,
      retryAfterMs: result.decision.retryAfterMs ?? 15_000,
      rationale: result.decision.rationale,
    };
  }
  // grant | renew | preempt — caller proceeds with the returned lease.
  return { proceed: true, lease: result.lease, rationale: result.decision.rationale };
}
