import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callMock: vi.fn(),
  createLlmTransportMock: vi.fn(),
}));

vi.mock("../src/transports/llm-chat", () => {
  class LlmUnavailableError extends Error {
    constructor(
      public readonly attemptedProviders: string[],
      public readonly failures: Array<{ provider: string; message: string }>,
    ) {
      super("All LLM providers failed or were unavailable");
      this.name = "LlmUnavailableError";
    }
  }

  return {
    LlmUnavailableError,
    createLlmTransport: mocks.createLlmTransportMock,
  };
});

vi.mock("../src/config/runtime-config", () => ({
  getCortexConfig: async () => ({ overrides: {} }),
  getPlannerConfig: async () => ({
    maxFindingsPerCortex: 3,
    provider: undefined,
    model: undefined,
    maxOutputTokens: undefined,
    temperature: undefined,
    reasoningEffort: undefined,
    verbosity: undefined,
    thinking: undefined,
    reasoningFormat: undefined,
    reasoningSplit: undefined,
  }),
}));

import { analyzeCortexData } from "../src/cortices/cortex-llm";
import { LlmUnavailableError } from "../src/transports/llm-chat";

beforeEach(() => {
  mocks.callMock.mockReset();
  mocks.createLlmTransportMock.mockReset();
  mocks.createLlmTransportMock.mockReturnValue({
    call: mocks.callMock,
  });
});

describe("cortex LLM provider diagnostics", () => {
  it("maps total provider failure to an explicit provider_unavailable diagnostic", async () => {
    mocks.callMock.mockRejectedValue(
      new LlmUnavailableError(
        ["kimi", "openai"],
        [
          { provider: "kimi", message: "Kimi API error 503" },
          { provider: "openai", message: "OpenAI API error 401" },
        ],
      ),
    );

    const result = await analyzeCortexData({
      cortexName: "diagnostic_cortex",
      systemPrompt: "You are a diagnostic cortex.",
      dataPayload: "[]",
    });

    expect(result).toMatchObject({
      findings: [],
      model: "none",
      status: "provider_unavailable",
      diagnostic: {
        kind: "provider_unavailable",
        reason: "All LLM providers failed or were unavailable",
        attemptedProviders: ["kimi", "openai"],
        providerFailures: [
          { provider: "kimi", message: "Kimi API error 503" },
          { provider: "openai", message: "OpenAI API error 401" },
        ],
      },
    });
  });
});
