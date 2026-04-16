import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { asyncHandler } from "./async-handler";

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
});
