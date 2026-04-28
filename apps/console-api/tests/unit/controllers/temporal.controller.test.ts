import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerTemporalRoutes } from "../../../src/routes/temporal.routes";

describe("registerTemporalRoutes", () => {
  it("parses temporal pattern query parameters for the read-only cortex route", async () => {
    const services = makeServices();
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, services);

    const res = await app.inject({
      method: "GET",
      url: "/api/cortex/temporal-patterns?terminalStatus=timeout&sourceDomain=production&includeAuditOnly=true&limit=999",
    });

    expect(res.statusCode).toBe(200);
    expect(services.memory.queryPatterns).toHaveBeenCalledWith({
      terminalStatus: "timeout",
      sourceDomain: "production",
      includeAuditOnly: true,
      limit: 50,
    });
    expect(res.json()).toEqual({ patterns: [], nextCursor: null });
    await app.close();
  });

  it("returns 400 for malformed audit-mode query flags", async () => {
    const services = makeServices();
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, services);

    const res = await app.inject({
      method: "GET",
      url: "/api/cortex/temporal-patterns?includeAuditOnly=maybe",
    });

    expect(res.statusCode).toBe(400);
    expect(services.memory.queryPatterns).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not expose mutable temporal pattern endpoints", async () => {
    const services = makeServices();
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, services);

    const res = await app.inject({
      method: "POST",
      url: "/api/cortex/temporal-patterns",
      payload: { status: "accepted" },
    });

    expect(res.statusCode).toBe(404);
    expect(services.memory.queryPatterns).not.toHaveBeenCalled();
    expect(services.shadow.runClosedWindow).not.toHaveBeenCalled();
    await app.close();
  });

  it("starts a temporal shadow run from a closed-window admin request", async () => {
    const services = makeServices({
      shadowResult: {
        mode: "shadow",
        from: "2026-04-27T10:00:00.000Z",
        to: "2026-04-27T11:00:00.000Z",
        sourceDomain: "simulation",
        params: {
          pattern_window_ms: 1_000,
          pre_trace_decay_ms: 1_000,
          learning_rate: 0.1,
          activation_threshold: 0.25,
          min_support: 2,
          max_steps: 2,
          pattern_version: "temporal-v0.2.0",
        },
        projection: {
          projectionRunId: "900",
          projectionVersion: "temporal-projection-v0.2.0",
          sourceScope: "temporal-shadow-run",
          inputSnapshotHash: "projection-snapshot",
          reviewEvidenceCount: 2,
          simRunCount: 2,
          eventCount: 4,
          insertedEventCount: 4,
        },
        learning: {
          learningRunId: "700",
          inputSnapshotHash: "learning-snapshot",
          eventCount: 4,
          patternCount: 1,
          persistedPatternCount: 1,
        },
        kgWriteAttempted: false,
        actionAuthority: false,
      },
    });
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, services);

    const res = await app.inject({
      method: "POST",
      url: "/api/temporal/shadow-runs",
      payload: {
        from: "2026-04-27T10:00:00.000Z",
        to: "2026-04-27T11:00:00.000Z",
        sourceDomain: "simulation",
        targetOutcomes: ["resolved"],
        params: {
          min_support: 2,
          activation_threshold: 0.25,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(services.shadow.runClosedWindow).toHaveBeenCalledWith({
      from: new Date("2026-04-27T10:00:00.000Z"),
      to: new Date("2026-04-27T11:00:00.000Z"),
      sourceDomain: "simulation",
      targetOutcomes: ["resolved"],
      params: {
        min_support: 2,
        activation_threshold: 0.25,
      },
    });
    expect(res.json()).toMatchObject({
      mode: "shadow",
      projection: { eventCount: 4 },
      learning: { patternCount: 1 },
      kgWriteAttempted: false,
      actionAuthority: false,
    });
    await app.close();
  });

  it("returns 400 for malformed shadow-run windows", async () => {
    const services = makeServices();
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, services);

    const res = await app.inject({
      method: "POST",
      url: "/api/temporal/shadow-runs",
      payload: {
        from: "not-a-date",
        to: "2026-04-27T11:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(services.shadow.runClosedWindow).not.toHaveBeenCalled();
    await app.close();
  });
});

function makeServices(input: { shadowResult?: unknown } = {}): Parameters<
  typeof registerTemporalRoutes
>[1] {
  return {
    memory: {
      queryPatterns: vi.fn().mockResolvedValue({ patterns: [], nextCursor: null }),
    },
    shadow: {
      runClosedWindow: vi.fn().mockResolvedValue(input.shadowResult ?? {}),
    },
  };
}
