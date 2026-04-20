import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  cycleHistoryController,
  cycleRunController,
} from "../../../src/controllers/cycles.controller";

describe("cycleRunController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service = { runUserCycle: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/cycles/run", cycleRunController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/cycles/run",
      payload: { kind: "all" },
    });

    expect(res.statusCode).toBe(400);
    expect(service.runUserCycle).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses the default query when none is provided", async () => {
    const service = {
      runUserCycle: vi.fn().mockResolvedValue({
        cycle: {
          id: "c1",
          kind: "fish",
          startedAt: "2026-04-19T10:00:00.000Z",
          completedAt: "2026-04-19T10:00:01.000Z",
          findingsEmitted: 0,
          cortices: ["nano-sweep"],
        },
      }),
    };
    const app = Fastify({ logger: false });
    app.post("/cycles/run", cycleRunController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/cycles/run",
      payload: { kind: "fish" },
    });

    expect(service.runUserCycle).toHaveBeenCalledWith(
      "fish",
      "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast",
    );
    expect(res.statusCode).toBe(200);
    // Controller must emit the wire DTO, not the raw service object.
    expect(res.json()).toEqual({
      cycle: {
        id: "c1",
        kind: "fish",
        startedAt: "2026-04-19T10:00:00.000Z",
        completedAt: "2026-04-19T10:00:01.000Z",
        findingsEmitted: 0,
        cortices: ["nano-sweep"],
      },
    });
    await app.close();
  });

  it("returns 500 with error copied from result.cycle.error", async () => {
    const service = {
      runUserCycle: vi.fn().mockResolvedValue({
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "2026-04-19T10:00:00.000Z",
          completedAt: "2026-04-19T10:00:01.000Z",
          findingsEmitted: 0,
          cortices: [],
          error: "boom",
        },
      }),
    };
    const app = Fastify({ logger: false });
    app.post("/cycles/run", cycleRunController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/cycles/run",
      payload: { kind: "thalamus", query: "screen geo" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      cycle: {
        id: "c1",
        kind: "thalamus",
        startedAt: "2026-04-19T10:00:00.000Z",
        completedAt: "2026-04-19T10:00:01.000Z",
        findingsEmitted: 0,
        cortices: [],
        error: "boom",
      },
      error: "boom",
    });
    await app.close();
  });

  it("projects findings + costUsd into the response DTO", async () => {
    const service = {
      runUserCycle: vi.fn().mockResolvedValue({
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "2026-04-19T10:00:00.000Z",
          completedAt: "2026-04-19T10:00:01.000Z",
          findingsEmitted: 1,
          cortices: ["thalamus"],
          findings: [
            {
              id: "11",
              title: "t",
              summary: "s",
              sourceClass: "KG",
              confidence: 0.9,
              evidenceRefs: [],
            },
          ],
          costUsd: 0.42,
        },
      }),
    };
    const app = Fastify({ logger: false });
    app.post("/cycles/run", cycleRunController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/cycles/run",
      payload: { kind: "thalamus", query: "q" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cycle.findings).toHaveLength(1);
    expect(body.cycle.findings[0].sourceClass).toBe("KG");
    expect(body.cycle.costUsd).toBe(0.42);
    await app.close();
  });
});

describe("cycleHistoryController", () => {
  it("wraps service history inside {items}", async () => {
    const service = {
      listHistory: vi.fn().mockReturnValue([{ id: "c1" }, { id: "c2" }]),
    };
    const app = Fastify({ logger: false });
    app.get("/cycles/history", cycleHistoryController(service as never));

    const res = await app.inject({ method: "GET", url: "/cycles/history" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ id: "c1" }, { id: "c2" }] });
    await app.close();
  });
});
