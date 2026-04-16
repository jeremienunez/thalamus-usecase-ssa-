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
      runUserCycle: vi.fn().mockResolvedValue({ cycle: { id: "c1" } }),
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
    await app.close();
  });

  it("returns 500 with error copied from result.cycle.error", async () => {
    const service = {
      runUserCycle: vi.fn().mockResolvedValue({
        cycle: { id: "c1", error: "boom" },
        history: [],
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
      cycle: { id: "c1", error: "boom" },
      history: [],
      error: "boom",
    });
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
