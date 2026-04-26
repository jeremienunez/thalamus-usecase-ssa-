import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NANO_CONFIG,
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { setNanoConfigProvider, callNano, createLlmTransportWithMode } from "../src";
import { setThalamusTransportConfigProvider } from "../src/config/runtime-config";

describe("thalamus transport config provider", () => {
  afterEach(() => {
    setNanoConfigProvider(new StaticConfigProvider(DEFAULT_NANO_CONFIG));
    setThalamusTransportConfigProvider(
      new StaticConfigProvider(DEFAULT_THALAMUS_TRANSPORT_CONFIG),
    );
    vi.restoreAllMocks();
  });

  it("routes fixture-mode transport through the injected config instead of process.env", async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), "thalamus-fixtures-"));
    try {
      writeFileSync(
        join(fixturesDir, "fallback.json"),
        JSON.stringify({
          content: "fixture reply",
          provider: "none",
          recordedAt: new Date("2026-04-22T00:00:00Z").toISOString(),
        }),
        "utf8",
      );

      setThalamusTransportConfigProvider(
        new StaticConfigProvider({
          ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
          mode: "fixtures",
          fixturesDir,
          fallbackFixture: "fallback",
        }),
      );

      const transport = createLlmTransportWithMode("system prompt");
      await expect(transport.call("user prompt")).resolves.toEqual({
        content: "fixture reply",
        provider: "none",
      });
    } finally {
      rmSync(fixturesDir, { recursive: true, force: true });
    }
  });

  it("uses the injected OpenAI key for nano calls", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    setThalamusTransportConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
        openaiApiKey: "sk-test",
      }),
    );

    await expect(
      callNano({
        instructions: "system",
        input: "user",
        enableWebSearch: false,
      }),
    ).resolves.toMatchObject({
      ok: true,
      text: "ok",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
  });

  it("omits temperature for nano models that do not support it", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    setThalamusTransportConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
        openaiApiKey: "sk-test",
      }),
    );
    setNanoConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_NANO_CONFIG,
        model: "gpt-5.4-nano",
      }),
    );

    await expect(
      callNano({
        instructions: "system",
        input: "user",
        enableWebSearch: false,
        overrides: { temperature: 0.2 },
      }),
    ).resolves.toMatchObject({ ok: true, text: "ok" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ model: "gpt-5.4-nano" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("routes DeepSeek nano models through the DeepSeek chat endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "{\"action\":\"ok\"}",
              reasoning_content: "hidden",
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    setThalamusTransportConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
        deepseekApiUrl: "https://deepseek.test",
        deepseekApiKey: "sk-deepseek",
      }),
    );
    setNanoConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_NANO_CONFIG,
        model: "deepseek-v4-flash",
      }),
    );

    await expect(
      callNano({
        instructions: "Return json.",
        input: "user",
        enableWebSearch: false,
        responseFormat: {
          type: "json_schema",
          name: "action",
          strict: true,
          schema: { type: "object" },
        },
        overrides: {
          thinking: true,
          reasoningEffort: "high",
          temperature: 0.2,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      text: "{\"action\":\"ok\"}",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://deepseek.test/chat/completions",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("temperature");
  });
});
