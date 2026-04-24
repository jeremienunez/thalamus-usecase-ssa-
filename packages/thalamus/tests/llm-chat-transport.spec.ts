import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { setThalamusTransportConfigProvider } from "../src/config/runtime-config";
import {
  createLlmTransport,
  LlmChatTransport,
  LlmUnavailableError,
} from "../src/transports/llm-chat";
import type {
  LlmProvider,
  LlmProviderCallOpts,
  ProviderName,
} from "../src/transports/providers";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@interview/shared/observability", () => ({
  createLogger: () => logger,
}));

type MockProvider = LlmProvider & {
  refreshConfig: ReturnType<typeof vi.fn>;
  isEnabled: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
};

function buildProvider(name: ProviderName, enabled = true): MockProvider {
  return {
    name,
    refreshConfig: vi.fn(async () => undefined),
    isEnabled: vi.fn(() => enabled),
    call: vi.fn(
      async (_system: string, _user: string, _opts: LlmProviderCallOpts) => {
        return `${name}-ok`;
      },
    ),
  };
}

afterEach(() => {
  setThalamusTransportConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_TRANSPORT_CONFIG),
  );
  Reflect.set(LlmChatTransport, "kimiConsecutiveFailures", 0);
  Reflect.set(LlmChatTransport, "kimiCircuitState", "closed");
  Reflect.set(LlmChatTransport, "kimiCircuitOpenedAt", null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe("LlmChatTransport", () => {
  it("creates the default provider chain and stores the passed options", () => {
    const transport = createLlmTransport("SYSTEM", {
      maxRetries: 4,
      enableWebSearch: true,
      preferredProvider: "openai",
      overrides: {
        model: "gpt-5.4-mini",
        reasoningEffort: "high",
      },
    });

    const providers = Reflect.get(transport, "providers") as Array<{
      name: string;
    }>;
    const config = Reflect.get(transport, "config") as Record<string, unknown>;

    expect(transport).toBeInstanceOf(LlmChatTransport);
    expect(providers.map((provider) => provider.name)).toEqual([
      "local",
      "kimi",
      "minimax",
      "openai",
    ]);
    expect(config).toEqual({
      systemPrompt: "SYSTEM",
      maxRetries: 4,
      enableWebSearch: true,
      preferredProvider: "openai",
      overrides: {
        model: "gpt-5.4-mini",
        reasoningEffort: "high",
      },
    });
  });

  it("tries the preferred provider first and strips the model override on fallback providers", async () => {
    const local = buildProvider("local", false);
    const kimi = buildProvider("kimi");
    const openai = buildProvider("openai");

    kimi.call.mockRejectedValueOnce(new Error("kimi down"));
    openai.call.mockResolvedValueOnce("openai answer");

    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
        enableWebSearch: true,
        preferredProvider: "kimi",
        overrides: {
          model: "kimi-k2-thinking",
          temperature: 0.4,
          reasoningEffort: "high",
        },
      },
      [local, kimi, openai],
    );

    await expect(transport.call("USER")).resolves.toEqual({
      content: "openai answer",
      provider: "openai",
    });
    expect(kimi.call).toHaveBeenCalledWith("SYSTEM", "USER", {
      model: "kimi-k2-thinking",
      temperature: 0.4,
      reasoningEffort: "high",
      enableWebSearch: true,
    });
    expect(openai.call).toHaveBeenCalledWith("SYSTEM", "USER", {
      temperature: 0.4,
      reasoningEffort: "high",
      enableWebSearch: true,
    });
    expect(local.call).not.toHaveBeenCalled();
    expect(kimi.refreshConfig).toHaveBeenCalledOnce();
    expect(local.refreshConfig).toHaveBeenCalledOnce();
    expect(openai.refreshConfig).toHaveBeenCalledOnce();
  });

  it("uses the injected retry budget when maxRetries is unset and resets Kimi failures after success", async () => {
    setThalamusTransportConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
        llmMaxRetries: 2,
      }),
    );
    vi.useFakeTimers();
    const kimi = buildProvider("kimi");
    kimi.call
      .mockRejectedValueOnce(new Error("retry me"))
      .mockResolvedValueOnce("settled");

    const transport = new LlmChatTransport({ systemPrompt: "SYSTEM" }, [kimi]);
    const promise = transport.call("USER");

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toEqual({
      content: "settled",
      provider: "kimi",
    });
    expect(kimi.call).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      { attempt: 1, error: "retry me" },
      "Retrying Kimi K2 call",
    );
    expect(Reflect.get(LlmChatTransport, "kimiConsecutiveFailures")).toBe(0);
  });

  it("skips Kimi once the circuit breaker trips across calls", async () => {
    const kimi = buildProvider("kimi");
    const openai = buildProvider("openai");

    kimi.call.mockRejectedValue(new Error("kimi down"));
    openai.call.mockResolvedValue("openai fallback");

    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
      },
      [kimi, openai],
    );

    await transport.call("first");
    await transport.call("second");
    await transport.call("third");
    const result = await transport.call("fourth");

    expect(result).toEqual({
      content: "openai fallback",
      provider: "openai",
    });
    expect(kimi.call).toHaveBeenCalledTimes(3);
    expect(openai.call).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledWith(
      "Kimi K2 circuit breaker tripped — switching to OpenAI",
    );
  });

  it("allows one half-open Kimi probe after cooldown and closes on success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00Z"));
    const kimi = buildProvider("kimi");
    const openai = buildProvider("openai");

    kimi.call
      .mockRejectedValueOnce(new Error("kimi down 1"))
      .mockRejectedValueOnce(new Error("kimi down 2"))
      .mockRejectedValueOnce(new Error("kimi down 3"))
      .mockResolvedValueOnce("kimi recovered");
    openai.call.mockResolvedValue("openai fallback");

    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
      },
      [kimi, openai],
    );

    await transport.call("first");
    await transport.call("second");
    await transport.call("third");
    expect(Reflect.get(LlmChatTransport, "kimiCircuitState")).toBe("open");

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(transport.call("after cooldown")).resolves.toEqual({
      content: "kimi recovered",
      provider: "kimi",
    });

    expect(kimi.call).toHaveBeenCalledTimes(4);
    expect(openai.call).toHaveBeenCalledTimes(3);
    expect(Reflect.get(LlmChatTransport, "kimiCircuitState")).toBe("closed");
    expect(Reflect.get(LlmChatTransport, "kimiConsecutiveFailures")).toBe(0);
  });

  it("reopens Kimi circuit when the half-open probe fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00Z"));
    const kimi = buildProvider("kimi");
    const openai = buildProvider("openai");

    kimi.call.mockRejectedValue(new Error("still down"));
    openai.call.mockResolvedValue("openai fallback");

    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
      },
      [kimi, openai],
    );

    await transport.call("first");
    await transport.call("second");
    await transport.call("third");
    await vi.advanceTimersByTimeAsync(60_000);
    await transport.call("half-open");
    await transport.call("still cooling down");

    expect(kimi.call).toHaveBeenCalledTimes(4);
    expect(openai.call).toHaveBeenCalledTimes(5);
    expect(Reflect.get(LlmChatTransport, "kimiCircuitState")).toBe("open");
  });

  it("throws an unavailable error when every enabled provider fails", async () => {
    const local = buildProvider("local");
    const minimax = buildProvider("minimax");
    const openai = buildProvider("openai");

    local.call.mockRejectedValueOnce(new Error("local down"));
    minimax.call.mockRejectedValueOnce(new Error("minimax down"));
    openai.call.mockRejectedValueOnce(new Error("openai down"));

    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
      },
      [local, minimax, openai],
    );

    const error = await transport.call("USER").catch((err: unknown) => err);

    expect(error).toMatchObject({
      name: "LlmUnavailableError",
      attemptedProviders: ["local", "minimax", "openai"],
      failures: [
        { provider: "local", message: "local down" },
        { provider: "minimax", message: "minimax down" },
        { provider: "openai", message: "openai down" },
      ],
    });
    expect(error).toBeInstanceOf(LlmUnavailableError);

    expect(logger.warn).toHaveBeenCalledWith(
      { error: "local down" },
      "Local LLM call failed — falling through to remote providers",
    );
    expect(logger.warn).toHaveBeenCalledWith("OpenAI fallback also failed");
    expect(minimax.call).toHaveBeenCalledOnce();
  });

  it("throws an unavailable error when every provider is disabled", async () => {
    const local = buildProvider("local", false);
    const kimi = buildProvider("kimi", false);
    const openai = buildProvider("openai", false);

    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
      },
      [local, kimi, openai],
    );

    await expect(transport.call("USER")).rejects.toMatchObject({
      attemptedProviders: [],
      failures: [
        { provider: "local", message: "provider disabled" },
        { provider: "kimi", message: "provider disabled" },
        { provider: "openai", message: "provider disabled" },
      ],
    });
    expect(local.call).not.toHaveBeenCalled();
    expect(kimi.call).not.toHaveBeenCalled();
    expect(openai.call).not.toHaveBeenCalled();
  });

  it("forwards AbortSignal to provider calls", async () => {
    const openai = buildProvider("openai");
    const controller = new AbortController();
    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 1,
      },
      [openai],
    );

    await expect(
      transport.call("USER", { signal: controller.signal }),
    ).resolves.toEqual({
      content: "openai-ok",
      provider: "openai",
    });

    expect(openai.call).toHaveBeenCalledWith("SYSTEM", "USER", {
      enableWebSearch: undefined,
      signal: controller.signal,
    });
  });

  it("does not retry aborted provider calls", async () => {
    const openai = buildProvider("openai");
    const abort = new Error("cancelled by test");
    abort.name = "AbortError";
    openai.call.mockRejectedValue(abort);
    const transport = new LlmChatTransport(
      {
        systemPrompt: "SYSTEM",
        maxRetries: 3,
      },
      [openai],
    );

    await expect(transport.call("USER")).rejects.toThrow("cancelled by test");
    expect(openai.call).toHaveBeenCalledOnce();
  });

  it("parses JSON objects from markdown-wrapped content", () => {
    const parsed = LlmChatTransport.parseJson(
      'Planner reply:\n```json\n{"ready":true,"count":2}\n```',
      z.object({
        ready: z.boolean(),
        count: z.number(),
      }),
    );

    expect(parsed).toEqual({
      ready: true,
      count: 2,
    });
  });

  it("throws when no JSON object is present", () => {
    expect(() =>
      LlmChatTransport.parseJson(
        "No structured payload here.",
        z.object({ ready: z.boolean() }),
      ),
    ).toThrow("No JSON object found in LLM response");
  });
});
