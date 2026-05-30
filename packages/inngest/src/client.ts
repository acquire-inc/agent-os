// The Inngest client for the Agent OS control plane.
//
// Inngest is the durable orchestrator (doctrine main-acqu-agent-doctrine.md §2.1):
// it wraps the in-process scheduler so scheduled runs become retryable and
// observable, and it is where the handoff chains (deal.closed -> next agent) are
// later wired. The in-process apps/scheduler worker remains the fallback for
// non-Supabase deploys; Inngest is the primary path.
//
// Auth: production inbound webhooks are signed with INNGEST_SIGNING_KEY and the
// `inngest/hono` serve handler (mounted in apps/api, Plan 04) verifies them.
// Outbound events use INNGEST_EVENT_KEY.
import { Inngest } from "inngest";

// Dev mode (INNGEST_DEV=1) routes to a local inngest-cli dev relay, which serves
// UNSIGNED traffic for local ergonomics. The signingKey ternary is load-bearing:
// if BOTH INNGEST_DEV=1 AND INNGEST_SIGNING_KEY are set, the SDK would attempt
// signature verification against the dev relay's unsigned traffic and reject
// everything. Forcing signingKey to undefined in dev makes the SDK default to
// dev-relay behavior regardless of stray env state (RESEARCH Pitfall 4: never
// let a real signing key leak into dev).
const isDev = process.env.INNGEST_DEV === "1";

export const inngest = new Inngest({
  id: "agent-os",
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: isDev ? undefined : process.env.INNGEST_SIGNING_KEY,
  isDev,
});
