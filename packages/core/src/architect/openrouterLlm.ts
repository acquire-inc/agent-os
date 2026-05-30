// Concrete LlmClient impl backed by OpenRouter.
// Build deltas per Main §1.2: ANTHROPIC_BASE_URL=https://openrouter.ai/api.
// For the Architect we hit the OpenAI-style chat completions endpoint directly
// (this is a one-shot completion, not an SDK session).

import type { LlmClient, LlmCompletion } from "./llm.js";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterChoice {
  message?: OpenRouterMessage;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_cost?: number;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  model?: string;
}

export interface OpenRouterLlmOptions {
  apiKey: string;
  /** Default architect model — T-reason (Hermes 405B). Caller can override per-request. */
  model?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override base URL (tests / staging). */
  baseUrl?: string;
  /** Hard token cap; default 4096. */
  maxTokens?: number;
}

const DEFAULT_MODEL = "nousresearch/hermes-4-405b";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export function openrouterLlm(opts: OpenRouterLlmOptions): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const maxTokens = opts.maxTokens ?? 4096;
  return {
    async complete({ system, user, maxTokens: perCall, jsonHint }): Promise<LlmCompletion> {
      const body = {
        model,
        max_tokens: perCall ?? maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(jsonHint ? { response_format: { type: "json_object" as const } } : {}),
      };
      const resp = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": "https://acquire.inc",
          "X-Title": "Agent OS Architect",
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`OpenRouter ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const json = (await resp.json()) as OpenRouterResponse;
      const content = json.choices?.[0]?.message?.content ?? "";
      return {
        content,
        model: json.model ?? model,
        costUsd: json.usage?.total_cost ?? 0,
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
      };
    },
  };
}
