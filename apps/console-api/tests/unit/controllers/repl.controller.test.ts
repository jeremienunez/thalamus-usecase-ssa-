import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ReplStreamEvent } from "@interview/shared";
import { typedSpy } from "@interview/test-kit";
import type { ReplChatService } from "../../../src/services/repl-chat.service";
import { ReplFollowUpService } from "../../../src/services/repl-followup.service";
import type { ReplTurnService } from "../../../src/services/repl-turn.service";
import { CycleStreamPump } from "../../../src/services/cycle-stream-pump.service";
import { CycleSummariser } from "../../../src/services/cycle-summariser.service";
import type { LlmTransportFactory } from "../../../src/services/llm-transport.port";
import {
  SsaReplFollowUpExecutor,
  SsaReplFollowUpPolicy,
  type SsaReplFollowUpDeps,
} from "../../../src/agent/ssa/followup";
import {
  replChatStreamController,
  replTurnController,
} from "../../../src/controllers/repl.controller";
import { registerReplRoutes } from "../../../src/routes/repl.routes";

describe("replChatStreamController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service: Parameters<typeof replChatStreamController>[0] = {
      handleStream: vi.fn(),
    };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatStreamController(service));

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
    const service: Parameters<typeof replChatStreamController>[0] = {
      handleStream: vi.fn(() => gen()),
    };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatStreamController(service));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { input: "bonjour" },
    });

    expect(service.handleStream).toHaveBeenCalledWith(
      "bonjour",
      undefined,
      expect.any(AbortSignal),
    );
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
    const service: Parameters<typeof replChatStreamController>[0] = {
      handleStream: vi.fn(() => gen()),
    };
    const app = Fastify({ logger: false });
    app.post("/chat", replChatStreamController(service));

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

describe("registerReplRoutes", () => {
  function buildRealFollowUps() {
    const runCycle = typedSpy<SsaReplFollowUpDeps["thalamusService"]["runCycle"]>();
    runCycle.mockResolvedValue({ id: "cyc:child" });
    const findByCycleId = typedSpy<
      SsaReplFollowUpDeps["findingRepo"]["findByCycleId"]
    >();
    findByCycleId.mockResolvedValue([
      {
        id: "f:2",
        title: "Extended monitoring window",
        summary: "30d horizon keeps operator risk under review",
        cortex: "strategist",
        findingType: "brief",
        urgency: "medium",
        confidence: 0.9,
      },
    ]);
    const findById = typedSpy<
      NonNullable<SsaReplFollowUpDeps["findingRepo"]["findById"]>
    >();
    findById.mockResolvedValue(null);
    const findByFindingIds = typedSpy<
      SsaReplFollowUpDeps["edgeRepo"]["findByFindingIds"]
    >();
    findByFindingIds.mockResolvedValue([]);
    const llm: LlmTransportFactory = {
      create() {
        return {
          async call() {
            return {
              content: "Follow-up summary",
              provider: "mock-llm",
            };
          },
        };
      },
    };
    const deps: SsaReplFollowUpDeps = {
      thalamusService: { runCycle },
      findingRepo: {
        findByCycleId,
        findById,
      },
      edgeRepo: {
        findByFindingIds,
      },
    };

    return {
      runCycle,
      findByCycleId,
      service: new ReplFollowUpService(
        new SsaReplFollowUpPolicy({
          edgeRepo: deps.edgeRepo,
        }),
        new SsaReplFollowUpExecutor(
          deps,
          new CycleStreamPump(),
          new CycleSummariser(llm),
        ),
      ),
    };
  }

  it("wires /api/repl/chat through the stubbed auth middleware and forwards user id 1", async () => {
    async function* gen(): AsyncGenerator<ReplStreamEvent> {
      yield { event: "classified", data: { action: "chat" } };
      yield {
        event: "done",
        data: { provider: "mock", costUsd: 0, tookMs: 1, findingsCount: 0 },
      };
    }

    const chat: Parameters<typeof registerReplRoutes>[1] = {
      handleStream: vi.fn(() => gen()),
    };
    const followUps: Parameters<typeof registerReplRoutes>[2] = {
      executeSelected: vi.fn(() => gen()),
    };
    const turn: Parameters<typeof registerReplRoutes>[3] = {
      handle: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerReplRoutes(app, chat, followUps, turn);

    const res = await app.inject({
      method: "POST",
      url: "/api/repl/chat",
      payload: { input: "bonjour" },
    });

    expect(res.statusCode).toBe(200);
    expect(chat.handleStream).toHaveBeenCalledWith(
      "bonjour",
      1n,
      expect.any(AbortSignal),
    );
    await app.close();
  });

  it("streams the real /api/repl/followups/run SSE flow through the registered route", async () => {
    async function* gen(): AsyncGenerator<ReplStreamEvent> {
      yield { event: "classified", data: { action: "chat" } };
      yield {
        event: "done",
        data: { provider: "mock", costUsd: 0, tookMs: 1, findingsCount: 0 },
      };
    }

    const chat: Parameters<typeof registerReplRoutes>[1] = {
      handleStream: vi.fn(() => gen()),
    };
    const { service: followUps, runCycle, findByCycleId } = buildRealFollowUps();
    const turn: Parameters<typeof registerReplRoutes>[3] = {
      handle: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerReplRoutes(app, chat, followUps, turn);

    const payload = {
      query: "scan conjonctions",
      parentCycleId: "cyc:1",
      item: {
        followupId: "fu:1",
        kind: "deep_research_30d",
        auto: false,
        title: "Extend verification horizon to 30 days",
        rationale: "Needs monitoring",
        score: 0.9,
        gateScore: 0.7,
        costClass: "medium",
        reasonCodes: ["needs_monitoring"],
        target: null as null,
      },
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/repl/followups/run",
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain("event: followup.started");
    expect(res.body).toContain("event: followup.finding");
    expect(res.body).toContain("event: followup.summary");
    expect(res.body).toContain("event: followup.done");
    expect(res.body).toContain('"provider":"mock-llm"');
    expect(runCycle).toHaveBeenCalledWith({
      query: expect.stringContaining(
        "scan conjonctions\n\nVerification follow-up for parent cycle cyc:1. Extend the evidence horizon to 30 days for the same user objective.",
      ),
      userId: 1n,
      triggerType: "user",
      triggerSource: "console-followup:30d:cyc:1",
    });
    expect(runCycle.mock.calls[0]?.[0].query).toContain(
      "Keep the follow-up focused on conjunction/collision risk",
    );
    expect(findByCycleId).toHaveBeenCalledWith("cyc:child");
    expect(turn.handle).not.toHaveBeenCalled();
    await app.close();
  });

  it("wires /api/repl/turn to the turn service", async () => {
    const chat: Parameters<typeof registerReplRoutes>[1] = {
      handleStream: vi.fn(),
    };
    const followUps: Parameters<typeof registerReplRoutes>[2] = {
      executeSelected: vi.fn(),
    };
    const turn: Parameters<typeof registerReplRoutes>[3] = {
      handle: vi.fn().mockResolvedValue({ ok: true }),
    };
    const app = Fastify({ logger: false });
    registerReplRoutes(app, chat, followUps, turn);

    const res = await app.inject({
      method: "POST",
      url: "/api/repl/turn",
      payload: { input: "track yaogan" },
    });

    expect(res.statusCode).toBe(200);
    expect(turn.handle).toHaveBeenCalledWith("track yaogan", "anon");
    expect(followUps.executeSelected).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("replTurnController", () => {
  it("defaults sessionId and forwards input to the turn service", async () => {
    const service: Parameters<typeof replTurnController>[0] = {
      handle: vi.fn().mockResolvedValue({ ok: true }),
    };
    const app = Fastify({ logger: false });
    app.post("/turn", replTurnController(service));

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
