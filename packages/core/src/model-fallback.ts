// Cross-model fallback for the Nebius single-point-of-failure (DECISION-inference-metering-
// hosting.md open item #2). Both Hermes 4 405B and 70B are single-sourced on Nebius via
// OpenRouter — a Nebius outage takes the whole Hermes fleet down regardless of gateway. The
// gateway gives us *model* fallback (not provider fallback), so when a run fails because the
// model is unavailable, we retry once on a cheaper Claude model that degrades gracefully rather
// than halting the agent. Pure + tested; the runner wires it into the live-run catch path.

/** Primary Hermes slug → graceful cross-provider fallback (Anthropic, not Nebius). */
const FALLBACK: Record<string, string> = {
  "nousresearch/hermes-4-405b": "anthropic/claude-haiku-4-5",
  "nousresearch/hermes-4-70b": "anthropic/claude-haiku-4-5",
  "nousresearch/hermes-2-pro-llama-3-8b": "anthropic/claude-haiku-4-5",
};

/** The fallback model for a primary slug, or null if none is defined (e.g. already on Claude). */
export function fallbackModel(model: string): string | null {
  return FALLBACK[model] ?? null;
}

// Substrings that mark an error as "provider/model unavailable" — worth retrying on the
// fallback model — vs a genuine request error (bad prompt, auth) that a retry won't fix.
const AVAILABILITY_SIGNALS = [
  "no instances available",
  "no available providers",
  "model not available",
  "model_not_available",
  "503",
  "502",
  "overloaded",
  "service unavailable",
  "temporarily unavailable",
  "upstream",
  "provider returned error",
  "timeout",
  "timed out",
  "econnreset",
  "etimedout",
];

/** Does this error look like provider/model unavailability (→ retry on fallback)? */
export function isProviderUnavailable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return AVAILABILITY_SIGNALS.some((s) => msg.includes(s));
}

/**
 * Decide how to react to a failed run attempt:
 *  - { retry: true, model } when the error is an availability error AND a fallback exists AND we
 *    haven't already tried it;
 *  - { retry: false } otherwise (fail the run as before).
 */
export function planModelFallback(args: {
  model: string;
  error: unknown;
  alreadyFellBack: boolean;
}): { retry: boolean; model?: string; reason?: string } {
  if (args.alreadyFellBack) return { retry: false };
  if (!isProviderUnavailable(args.error)) return { retry: false };
  const fb = fallbackModel(args.model);
  if (!fb) return { retry: false };
  return { retry: true, model: fb, reason: `${args.model} unavailable → retrying on ${fb}` };
}
