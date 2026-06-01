// Provider OAuth refresher stubs — Meta + Stripe (D-03 fail-closed pattern).
//
// CLAUDE.md Non-negotiable #6 documents the Vault → Nango migration; until each
// provider's real refresher lands, we MUST fail closed rather than silently
// claim success. A no-op refresher that returns null would let a stale token
// linger past expiry and surface as "rotated: false, provider refresh failed"
// — which is recoverable but misleading. A THROW surfaces the gap immediately
// to the operator on first call.
//
// Close.io is the reference implementation (see ./close.ts). Meta and Stripe
// remain stubs until OAuth flows are wired (docs/HANDOFF-other-session.md).

import type { Refresher } from "@agent-os/vault";

const STUB_ERROR =
  "operator: implement provider refresher — see docs/HANDOFF-other-session.md";

export const metaRefresher: Refresher = async () => {
  throw new Error(STUB_ERROR);
};

export const stripeRefresher: Refresher = async () => {
  throw new Error(STUB_ERROR);
};
