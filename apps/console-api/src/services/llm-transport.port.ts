// apps/console-api/src/services/llm-transport.port.ts
//
// Port abstracting the concrete LLM transport. The `create` factory binds a
// system prompt and returns a `call(input)` handle, mirroring the shape of
// `@interview/thalamus`'s `createLlmTransportWithMode` without importing the
// transport package from domain services.

export interface LlmTransportCallOptions {
  signal?: AbortSignal;
}

export interface LlmTransportFactory {
  create(systemPrompt: string): {
    call(
      input: string,
      options?: LlmTransportCallOptions,
    ): Promise<{ content: string; provider: string }>;
  };
}
