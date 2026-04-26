import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
  type ThalamusTransportConfig,
} from "@interview/shared/config";
import { setThalamusTransportConfigProvider } from "../src/config/runtime-config";
import { DeepSeekProvider } from "../src/transports/providers/deepseek.provider";
import { KimiProvider } from "../src/transports/providers/kimi.provider";
import { LocalProvider } from "../src/transports/providers/local.provider";
import { MiniMaxProvider } from "../src/transports/providers/minimax.provider";
import { OpenAIProvider } from "../src/transports/providers/openai.provider";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@interview/shared/observability", () => ({
  createLogger: () => logger,
}));

function setTransportConfig(overrides: Partial<ThalamusTransportConfig>): void {
  setThalamusTransportConfigProvider(
    new StaticConfigProvider({
      ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
      ...overrides,
    }),
  );
}

function readBody(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  const request = fetchMock.mock.calls[0]?.[1];
  if (!request || typeof request !== "object" || !("body" in request)) {
    return {};
  }
  if (typeof request.body !== "string") {
    return {};
  }
  return JSON.parse(request.body) as Record<string, unknown>;
}

afterEach(() => {
  setThalamusTransportConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_TRANSPORT_CONFIG),
  );
  Reflect.set(KimiProvider, "lastKimiCallMs", 0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe("LocalProvider", () => {
  it("appends the chat completions path and forwards local-only options", async () => {
    setTransportConfig({
      localLlmUrl: "http://127.0.0.1:11434",
      localLlmModel: "local-base",
      localLlmMaxTokens: 80,
      localLlmTemperature: 0.33,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "<think>hidden</think>ready" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LocalProvider();

    await provider.refreshConfig();
    const result = await provider.call("SYSTEM", "USER", {
      model: "gemma-4",
      maxOutputTokens: 42,
      temperature: 0.1,
      reasoningFormat: "deepseek",
      thinking: true,
    });
    const body = readBody(fetchMock);

    expect(provider.isEnabled()).toBe(true);
    expect(result).toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/chat/completions",
      expect.any(Object),
    );
    expect(body).toMatchObject({
      model: "gemma-4",
      max_tokens: 42,
      temperature: 0.1,
      reasoning_format: "deepseek",
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it("keeps a full chat completions URL and falls back to config defaults when no overrides are set", async () => {
    setTransportConfig({
      localLlmUrl: "http://127.0.0.1:11434/v1/chat/completions",
      localLlmModel: "local-base",
      localLlmMaxTokens: 77,
      localLlmTemperature: 0.25,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LocalProvider();

    const result = await provider.call("SYSTEM", "USER", {});
    const body = readBody(fetchMock);

    expect(result).toBe("");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/chat/completions",
      expect.any(Object),
    );
    expect(body).toMatchObject({
      model: "local-base",
      max_tokens: 77,
      temperature: 0.25,
    });
    expect(body).not.toHaveProperty("reasoning_format");
    expect(body).not.toHaveProperty("chat_template_kwargs");
  });

  it("throws a detailed error when the local server returns a non-OK response", async () => {
    setTransportConfig({
      localLlmUrl: "http://127.0.0.1:11434",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "busy",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LocalProvider();

    await expect(provider.call("SYSTEM", "USER", {})).rejects.toThrow(
      "Local LLM error 503: busy",
    );
  });

  it("passes AbortSignal to the local fetch call", async () => {
    setTransportConfig({
      localLlmUrl: "http://127.0.0.1:11434",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LocalProvider();
    const controller = new AbortController();

    await provider.call("SYSTEM", "USER", { signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("reports disabled when the configured URL is blank", async () => {
    setTransportConfig({
      localLlmUrl: "",
    });
    const provider = new LocalProvider();

    await provider.refreshConfig();

    expect(provider.isEnabled()).toBe(false);
  });
});

describe("KimiProvider", () => {
  it("waits for the rate limiter and forwards web-search, token, temperature, and thinking overrides", async () => {
    setTransportConfig({
      kimiApiUrl: "https://kimi.test/v1/chat/completions",
      kimiApiKey: "sk-kimi",
      kimiModel: "kimi-base",
      kimiMaxTokens: 128,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "<think>hidden</think>answer",
              reasoning_content: "I think the source matches.",
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00Z"));
    Reflect.set(KimiProvider, "lastKimiCallMs", Date.now());
    const provider = new KimiProvider();

    await provider.refreshConfig();
    const promise = provider.call("SYSTEM", "USER", {
      enableWebSearch: true,
      model: "kimi-thinking",
      maxOutputTokens: 64,
      temperature: 0.7,
      thinking: false,
    });

    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    const body = readBody(fetchMock);

    expect(provider.isEnabled()).toBe(true);
    expect(result).toBe("answer");
    expect(body).toMatchObject({
      model: "kimi-thinking",
      max_completion_tokens: 64,
      temperature: 0.7,
      tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
      thinking: { type: "disabled" },
    });
  });

  it("uses config defaults and can enable the Kimi thinking channel explicitly", async () => {
    setTransportConfig({
      kimiApiUrl: "https://kimi.test/v1/chat/completions",
      kimiApiKey: "sk-kimi",
      kimiModel: "kimi-base",
      kimiMaxTokens: 256,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              reasoning_content: "deterministic chain",
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new KimiProvider();

    const result = await provider.call("SYSTEM", "USER", {
      thinking: true,
    });
    const body = readBody(fetchMock);

    expect(result).toBe("");
    expect(body).toMatchObject({
      model: "kimi-base",
      max_completion_tokens: 256,
      temperature: 1,
      thinking: { type: "enabled" },
    });
    expect(body).not.toHaveProperty("tools");
  });

  it("returns the message content directly when no reasoning channel is present", async () => {
    setTransportConfig({
      kimiApiUrl: "https://kimi.test/v1/chat/completions",
      kimiApiKey: "sk-kimi",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "plain answer",
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new KimiProvider();

    await expect(provider.call("SYSTEM", "USER", {})).resolves.toBe(
      "plain answer",
    );
  });

  it("returns an empty string when the API returns no message", async () => {
    setTransportConfig({
      kimiApiUrl: "https://kimi.test/v1/chat/completions",
      kimiApiKey: "sk-kimi",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new KimiProvider();

    const result = await provider.call("SYSTEM", "USER", {});
    const body = readBody(fetchMock);

    expect(result).toBe("");
    expect(body).not.toHaveProperty("thinking");
  });

  it("throws a detailed error when the Kimi API fails", async () => {
    setTransportConfig({
      kimiApiUrl: "https://kimi.test/v1/chat/completions",
      kimiApiKey: "sk-kimi",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new KimiProvider();

    await expect(provider.call("SYSTEM", "USER", {})).rejects.toThrow(
      "Kimi K2 API error 429: rate limited",
    );
  });

  it("passes AbortSignal to the Kimi fetch call", async () => {
    setTransportConfig({
      kimiApiUrl: "https://kimi.test/v1/chat/completions",
      kimiApiKey: "sk-kimi",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new KimiProvider();
    const controller = new AbortController();

    await provider.call("SYSTEM", "USER", { signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("reports disabled when no Kimi API key is configured", async () => {
    setTransportConfig({
      kimiApiKey: "",
    });
    const provider = new KimiProvider();

    await provider.refreshConfig();

    expect(provider.isEnabled()).toBe(false);
  });
});

describe("MiniMaxProvider", () => {
  it("forwards reasoning_split and strips inline thinking markers", async () => {
    setTransportConfig({
      minimaxApiUrl: "https://minimax.test/v1/text/chatcompletion_v2",
      minimaxApiKey: "sk-minimax",
      minimaxModel: "MiniMax-M2.7",
      minimaxMaxTokens: 144,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "<thinking>hidden</thinking>done",
              reasoning_details: { tokens: 12 },
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MiniMaxProvider();

    await provider.refreshConfig();
    const result = await provider.call("SYSTEM", "USER", {
      model: "MiniMax-M2.7-pro",
      maxOutputTokens: 50,
      temperature: 0.2,
      reasoningSplit: true,
    });
    const body = readBody(fetchMock);

    expect(provider.isEnabled()).toBe(true);
    expect(result).toBe("done");
    expect(body).toMatchObject({
      model: "MiniMax-M2.7-pro",
      max_completion_tokens: 50,
      temperature: 0.2,
      reasoning_split: true,
    });
  });

  it("falls back to config defaults when MiniMax overrides are omitted", async () => {
    setTransportConfig({
      minimaxApiUrl: "https://minimax.test/v1/text/chatcompletion_v2",
      minimaxApiKey: "sk-minimax",
      minimaxModel: "MiniMax-M2.7",
      minimaxMaxTokens: 144,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "plain",
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MiniMaxProvider();

    const result = await provider.call("SYSTEM", "USER", {});
    const body = readBody(fetchMock);

    expect(result).toBe("plain");
    expect(body).toMatchObject({
      model: "MiniMax-M2.7",
      max_completion_tokens: 144,
      temperature: 1,
    });
    expect(body).not.toHaveProperty("reasoning_split");
  });

  it("normalizes a null MiniMax content field to an empty string", async () => {
    setTransportConfig({
      minimaxApiUrl: "https://minimax.test/v1/text/chatcompletion_v2",
      minimaxApiKey: "sk-minimax",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              reasoning_content: "chain",
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MiniMaxProvider();

    await expect(provider.call("SYSTEM", "USER", {})).resolves.toBe("");
  });

  it("returns an empty string when MiniMax returns no message", async () => {
    setTransportConfig({
      minimaxApiUrl: "https://minimax.test/v1/text/chatcompletion_v2",
      minimaxApiKey: "sk-minimax",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MiniMaxProvider();

    await expect(provider.call("SYSTEM", "USER", {})).resolves.toBe("");
  });

  it("throws a detailed error when the MiniMax API fails", async () => {
    setTransportConfig({
      minimaxApiUrl: "https://minimax.test/v1/text/chatcompletion_v2",
      minimaxApiKey: "sk-minimax",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "gateway error",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MiniMaxProvider();

    await expect(provider.call("SYSTEM", "USER", {})).rejects.toThrow(
      "MiniMax API error 500: gateway error",
    );
  });

  it("passes AbortSignal to the MiniMax fetch call", async () => {
    setTransportConfig({
      minimaxApiUrl: "https://minimax.test/v1/text/chatcompletion_v2",
      minimaxApiKey: "sk-minimax",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MiniMaxProvider();
    const controller = new AbortController();

    await provider.call("SYSTEM", "USER", { signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("reports disabled when no MiniMax API key is configured", async () => {
    setTransportConfig({
      minimaxApiKey: "",
    });
    const provider = new MiniMaxProvider();

    await provider.refreshConfig();

    expect(provider.isEnabled()).toBe(false);
  });
});

describe("DeepSeekProvider", () => {
  it("forwards DeepSeek thinking knobs and strips inline thinking markers", async () => {
    setTransportConfig({
      deepseekApiUrl: "https://deepseek.test/chat/completions",
      deepseekApiKey: "sk-deepseek",
      deepseekModel: "deepseek-v4-flash",
      deepseekMaxTokens: 144,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "<think>hidden</think>done",
              reasoning_content: "chain",
            },
          },
        ],
        usage: {
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DeepSeekProvider();

    await provider.refreshConfig();
    const result = await provider.call("SYSTEM", "USER", {
      model: "deepseek-v4-pro",
      maxOutputTokens: 50,
      temperature: 0.2,
      thinking: true,
      reasoningEffort: "high",
    });
    const body = readBody(fetchMock);

    expect(provider.isEnabled()).toBe(true);
    expect(result).toBe("done");
    expect(body).toMatchObject({
      model: "deepseek-v4-pro",
      max_tokens: 50,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("uses config defaults and still omits temperature when DeepSeek thinking is disabled", async () => {
    setTransportConfig({
      deepseekApiUrl: "https://deepseek.test",
      deepseekApiKey: "sk-deepseek",
      deepseekModel: "deepseek-v4-flash",
      deepseekMaxTokens: 144,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "plain" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DeepSeekProvider();

    const result = await provider.call("SYSTEM", "USER", {
      temperature: 0.3,
      thinking: false,
    });
    const body = readBody(fetchMock);

    expect(result).toBe("plain");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://deepseek.test/chat/completions",
    );
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      max_tokens: 144,
      thinking: { type: "disabled" },
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("temperature");
  });

  it("throws a detailed error when the DeepSeek API fails", async () => {
    setTransportConfig({
      deepseekApiUrl: "https://deepseek.test/chat/completions",
      deepseekApiKey: "sk-deepseek",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DeepSeekProvider();

    await expect(provider.call("SYSTEM", "USER", {})).rejects.toThrow(
      "DeepSeek API error 429: rate limited",
    );
  });

  it("reports disabled when no DeepSeek API key is configured", async () => {
    setTransportConfig({
      deepseekApiKey: "",
    });
    const provider = new DeepSeekProvider();

    await provider.refreshConfig();

    expect(provider.isEnabled()).toBe(false);
  });
});

describe("OpenAIProvider", () => {
  it("forwards OpenAI overrides and warns when the response is incomplete", async () => {
    setTransportConfig({
      openaiApiKey: "sk-openai",
      openaiFallbackModel: "gpt-5.4-mini",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 5 },
          },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "<thinking>hidden</thinking>done",
                },
                { type: "summary_text", text: "ignored" },
              ],
            },
            {
              type: "tool_call",
              content: [{ type: "output_text", text: "ignored" }],
            },
          ],
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider();

    await provider.refreshConfig();
    const result = await provider.call("SYSTEM", "USER", {
      model: "gpt-5.4",
      reasoningEffort: "high",
      verbosity: "low",
      maxOutputTokens: 111,
      temperature: 0.3,
    });
    const body = readBody(fetchMock);

    expect(provider.isEnabled()).toBe(true);
    expect(result).toBe("done");
    expect(body).toMatchObject({
      model: "gpt-5.4",
      instructions: "SYSTEM",
      input: "USER",
      reasoning: { effort: "high" },
      text: { format: { type: "text" }, verbosity: "low" },
      store: true,
      max_output_tokens: 111,
      temperature: 0.3,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "max_output_tokens",
        model: "gpt-5.4",
        effort: "high",
        verbosity: "low",
        maxOutputTokens: 111,
      }),
      "OpenAI response incomplete — completion truncated",
    );
  });

  it("falls back to default OpenAI settings when optional overrides are omitted", async () => {
    setTransportConfig({
      openaiApiKey: "sk-openai",
      openaiFallbackModel: "gpt-5-nano",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "plain" }],
            },
          ],
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider();

    const result = await provider.call("SYSTEM", "USER", {});
    const body = readBody(fetchMock);

    expect(result).toBe("plain");
    expect(body).toMatchObject({
      model: "gpt-5-nano",
      instructions: "SYSTEM",
      input: "USER",
      reasoning: { effort: "minimal" },
      text: { format: { type: "text" } },
      store: true,
    });
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to empty arrays and status strings when the OpenAI payload omits optional fields", async () => {
    setTransportConfig({
      openaiApiKey: "sk-openai",
      openaiFallbackModel: "gpt-5-nano",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          status: "incomplete",
          output: [
            {
              type: "message",
            },
            {
              type: "message",
              content: [{ type: "output_text" }],
            },
          ],
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider();

    const result = await provider.call("SYSTEM", "USER", {});

    expect(result).toBe("");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "incomplete",
        maxOutputTokens: null,
      }),
      "OpenAI response incomplete — completion truncated",
    );
  });

  it("throws a detailed error when the OpenAI API fails", async () => {
    setTransportConfig({
      openaiApiKey: "sk-openai",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider();

    await expect(provider.call("SYSTEM", "USER", {})).rejects.toThrow(
      "OpenAI API error 401: unauthorized",
    );
  });

  it("passes AbortSignal to the OpenAI fetch call", async () => {
    setTransportConfig({
      openaiApiKey: "sk-openai",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider();
    const controller = new AbortController();

    await provider.call("SYSTEM", "USER", { signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("reports disabled when no OpenAI key is configured", async () => {
    setTransportConfig({
      openaiApiKey: "",
    });
    const provider = new OpenAIProvider();

    await provider.refreshConfig();

    expect(provider.isEnabled()).toBe(false);
  });
});
