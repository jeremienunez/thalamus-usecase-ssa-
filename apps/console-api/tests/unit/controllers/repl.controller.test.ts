import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ReplStreamEvent } from "@interview/shared";
import {
  replChatStreamController,
  replTurnController,
} from "../../../src/controllers/repl.controller";

describe("replChatStreamController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service = { handleStream: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatStreamController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { input: "   " },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid request" });
    expect(service.handleStream).not.toHaveBeenCalled();
    await app.close();
  });

  it("streams SSE events produced by the service generator", async () => {
    async function* gen(): AsyncGenerator<ReplStreamEvent> {
      yield { event: "classified", data: { action: "chat" } };
      yield {
        event: "chat.complete",
        data: { text: "hello", provider: "mock" },
      };
      yield {
        event: "done",
        data: { provider: "mock", costUsd: 0, tookMs: 1, findingsCount: 0 },
      };
    }
    const service = { handleStream: vi.fn(() => gen()) };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatStreamController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { input: "bonjour" },
    });

    expect(service.handleStream).toHaveBeenCalledWith("bonjour");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    const body = res.body;
    expect(body).toContain("event: classified");
    expect(body).toContain('data: {"action":"chat"}');
    expect(body).toContain("event: chat.complete");
    expect(body).toContain("event: done");
    await app.close();
  });

  it("emits an error event if the generator throws", async () => {
    async function* gen(): AsyncGenerator<ReplStreamEvent> {
      yield { event: "classified", data: { action: "chat" } };
      throw new Error("boom");
    }
    const service = { handleStream: vi.fn(() => gen()) };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatStreamController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { input: "bonjour" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: error");
    expect(res.body).toContain('"message":"boom"');
    await app.close();
  });
});

describe("replTurnController", () => {
  it("defaults sessionId and forwards input to the turn service", async () => {
    const service = { handle: vi.fn().mockResolvedValue({ ok: true }) };
    const app = Fastify({ logger: false });
    app.post("/turn", replTurnController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/turn",
      payload: { input: "track yaogan" },
    });

    expect(service.handle).toHaveBeenCalledWith("track yaogan", "anon");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
