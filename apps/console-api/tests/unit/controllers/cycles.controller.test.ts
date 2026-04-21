import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerCyclesRoutes } from "../../../src/routes/cycles.routes";

describe("registerCyclesRoutes", () => {
  it("returns 400 on invalid public body and does not call the cycle service", async () => {
    const service = { runUserCycle: vi.fn() };
    const app = Fastify({ logger: false });
    registerCyclesRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/cycles/run",
      payload: { kind: "all" },
    });

    expect(res.statusCode).toBe(400);
    expect(service.runUserCycle).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses the default query on the public run route when none is provided", async () => {
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
      listHistory: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerCyclesRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/cycles/run",
      payload: { kind: "fish" },
    });

    expect(service.runUserCycle).toHaveBeenCalledWith(
      "fish",
      "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast",
    );
    expect(res.statusCode).toBe(200);
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

  it("returns 500 with error mirrored from result.cycle.error on the public run route", async () => {
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
      listHistory: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerCyclesRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/cycles/run",
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

  it("projects findings and costUsd on the public run response", async () => {
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
      listHistory: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerCyclesRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/cycles/run",
      payload: { kind: "thalamus", query: "q" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cycle.findings).toHaveLength(1);
    expect(body.cycle.findings[0].sourceClass).toBe("KG");
    expect(body.cycle.costUsd).toBe(0.42);
    await app.close();
  });

  it("wraps history inside {items} on the public list route", async () => {
    const service = {
      runUserCycle: vi.fn(),
      listHistory: vi.fn().mockReturnValue([{ id: "c1" }, { id: "c2" }]),
    };
    const app = Fastify({ logger: false });
    registerCyclesRoutes(app, service as never);

    const res = await app.inject({ method: "GET", url: "/api/cycles" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ id: "c1" }, { id: "c2" }] });
    await app.close();
  });

  it("does not expose stale non-api cycle paths", async () => {
    const service = {
      runUserCycle: vi.fn(),
      listHistory: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerCyclesRoutes(app, service as never);

    const run = await app.inject({ method: "POST", url: "/cycles/run" });
    const list = await app.inject({ method: "GET", url: "/cycles/history" });

    expect(run.statusCode).toBe(404);
    expect(list.statusCode).toBe(404);
    expect(service.runUserCycle).not.toHaveBeenCalled();
    expect(service.listHistory).not.toHaveBeenCalled();
    await app.close();
  });
});
