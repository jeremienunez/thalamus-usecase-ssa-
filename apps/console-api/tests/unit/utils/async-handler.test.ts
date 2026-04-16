import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { asyncHandler } from "../../../src/utils/async-handler";

describe("asyncHandler", () => {
  it("passes through successful result as JSON", async () => {
    const app = Fastify();
    app.get(
      "/ok",
      asyncHandler(async () => ({ hello: "world" })),
    );
    const res = await app.inject({ method: "GET", url: "/ok" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hello: "world" });
    await app.close();
  });

  it("maps thrown Error to 500 with message", async () => {
    const app = Fastify({ logger: false });
    app.get(
      "/boom",
      asyncHandler(async () => {
        throw new Error("kaboom");
      }),
    );
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: "kaboom" });
    await app.close();
  });

  it("redacts internal errors when NODE_ENV is production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = Fastify({ logger: false });
      app.get(
        "/boom",
        asyncHandler(async () => {
          throw new Error("internal secret");
        }),
      );
      const res = await app.inject({ method: "GET", url: "/boom" });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "internal error" });
      await app.close();
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("passes through explicit statusCode errors even in production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = Fastify({ logger: false });
      app.get(
        "/bad",
        asyncHandler(async () => {
          const err = new Error("bad input") as Error & { statusCode: number };
          err.statusCode = 400;
          throw err;
        }),
      );
      const res = await app.inject({ method: "GET", url: "/bad" });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "bad input" });
      await app.close();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
