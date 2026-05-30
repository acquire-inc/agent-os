// LLM client interface — concrete impls (OpenRouter / fixture) plug in here.

export interface LlmCompletion {
  content: string;
  model: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

export interface LlmClient {
  complete(args: {
    system: string;
    user: string;
    maxTokens?: number;
    /** Hint only — drift is caught by parseAgentBlueprints' repair loop. */
    jsonHint?: boolean;
  }): Promise<LlmCompletion>;
}

/** Test/dev double: returns canned completions in order. */
export function fixtureLlm(responses: LlmCompletion[]): LlmClient {
  let i = 0;
  return {
    async complete() {
      const r = responses[i++];
      if (!r) throw new Error("fixtureLlm: out of canned responses");
      return r;
    },
  };
}

/** Quick helper for tests that just want one completion. */
export function fixtureLlmFromJson(json: unknown, opts?: Partial<LlmCompletion>): LlmClient {
  return fixtureLlm([
    {
      content: typeof json === "string" ? json : JSON.stringify(json),
      model: opts?.model ?? "fixture/llm",
      costUsd: opts?.costUsd ?? 0,
      tokensIn: opts?.tokensIn ?? 0,
      tokensOut: opts?.tokensOut ?? 0,
    },
  ]);
}
