import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  replChatController,
  replTurnController,
} from "../../../src/controllers/repl.controller";

describe("replChatController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service = { handle: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { input: "   " },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid request" });
    expect(service.handle).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes validated input to the chat service", async () => {
    const service = {
      handle: vi.fn().mockResolvedValue({
        kind: "chat",
        text: "Bonjour",
        provider: "mock",
        tookMs: 12,
      }),
    };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { input: "  bonjour  " },
    });

    expect(service.handle).toHaveBeenCalledWith("bonjour");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      kind: "chat",
      text: "Bonjour",
      provider: "mock",
      tookMs: 12,
    });
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
