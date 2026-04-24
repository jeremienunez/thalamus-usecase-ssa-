import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NullWebSearchAdapter,
  OpenAIWebSearchAdapter,
} from "../src/transports/openai-web-search.adapter";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@interview/shared/observability", () => ({
  createLogger: () => logger,
}));

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe("OpenAIWebSearchAdapter", () => {
  it("extracts joined message text from the Responses payload", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [{ text: "alpha" }, { text: "beta" }],
          },
          {
            type: "tool_call",
            content: [{ text: "ignored" }],
          },
          {
            type: "message",
            content: [{ text: "gamma" }],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAIWebSearchAdapter("sk-test", "gpt-search");

    const result = await adapter.search("Search the web", "ignored query");
    const body = readBody(fetchMock);

    expect(result).toBe("alphabeta\ngamma");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
    expect(body).toEqual({
      model: "gpt-search",
      tools: [{ type: "web_search_preview" }],
      input: "Search the web",
    });
  });

  it("returns an empty string when the web search HTTP call fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAIWebSearchAdapter("sk-test", "gpt-search");

    await expect(
      adapter.search("Search the web", "ignored query"),
    ).resolves.toBe("");
  });

  it("returns an empty string when the Responses payload does not contain output messages", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAIWebSearchAdapter("sk-test", "gpt-search");

    await expect(
      adapter.search("Search the web", "ignored query"),
    ).resolves.toBe("");
  });

  it("returns an empty string when fetch throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAIWebSearchAdapter("sk-test", "gpt-search");

    await expect(
      adapter.search("Search the web", "ignored query"),
    ).resolves.toBe("");
  });

  it("passes AbortSignal to fetch and propagates aborts", async () => {
    const abortError = new Error("cancelled");
    abortError.name = "AbortError";
    const fetchMock = vi.fn(async () => {
      throw abortError;
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAIWebSearchAdapter("sk-test", "gpt-search");
    const controller = new AbortController();

    await expect(
      adapter.search("Search the web", "ignored query", {
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("returns an empty string from the null adapter", async () => {
    const adapter = new NullWebSearchAdapter();

    await expect(
      adapter.search("Search the web", "ignored query"),
    ).resolves.toBe("");
  });
});
