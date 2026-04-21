import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerReflexionRoutes } from "../../../src/routes/reflexion.routes";
import { HttpError } from "../../../src/utils/http-error";

describe("registerReflexionRoutes", () => {
  it("returns 400 on invalid public body before calling the service", async () => {
    const service = { runPass: vi.fn() };
    const app = Fastify({ logger: false });
    registerReflexionRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/reflexion-pass",
      payload: { noradId: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(service.runPass).not.toHaveBeenCalled();
    await app.close();
  });

  it("applies schema defaults and clamping on the public reflexion route", async () => {
    const service = {
      runPass: vi.fn().mockResolvedValue({
        target: {
          noradId: 32958,
          name: "SAT-32958",
          declared: {
            operator_country: "USA",
            classification_tier: "restricted",
            object_class: "payload",
            platform: "bus-a",
          },
          orbital: {
            inclinationDeg: 98.2,
            raanDeg: 13.4,
            meanMotionRevPerDay: 14.8,
            apogeeKm: 510,
            perigeeKm: 490,
          },
        },
        strictCoplane: [],
        beltByCountry: [],
        milLineagePeers: [],
        findingId: null,
      }),
    };
    const app = Fastify({ logger: false });
    registerReflexionRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/reflexion-pass",
      payload: {
        noradId: "32958",
        dIncMax: 99,
        dRaanMax: undefined,
        dMmMax: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(service.runPass).toHaveBeenCalledWith({
      noradId: 32958,
      dIncMax: 5,
      dRaanMax: 5,
      dMmMax: 0.001,
    });
    expect(res.json()).toMatchObject({
      target: { noradId: 32958, name: "SAT-32958" },
      findingId: null,
    });
    await app.close();
  });

  it("maps HttpError.notFound from the service to a 404 response on the public route", async () => {
    const service = {
      runPass: vi
        .fn()
        .mockRejectedValue(HttpError.notFound("satellite not found")),
    };
    const app = Fastify({ logger: false });
    registerReflexionRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/reflexion-pass",
      payload: { noradId: 32958, dIncMax: 0.3, dRaanMax: 5, dMmMax: 0.05 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "satellite not found" });
    await app.close();
  });

  it("does not expose the stale non-api reflexion path", async () => {
    const service = {
      runPass: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerReflexionRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/reflexion",
      payload: { noradId: 32958 },
    });

    expect(res.statusCode).toBe(404);
    expect(service.runPass).not.toHaveBeenCalled();
    await app.close();
  });
});
