import { describe, expect, it } from "vitest";
import { buildBannerText } from "../../../src/server";

describe("buildBannerText", () => {
  it("documents the real REPL turn payload instead of the stale query example", () => {
    const text = buildBannerText(
      4000,
      {
        databaseUrl: "postgres://***@localhost:5433/thalamus",
        redisUrl: "redis://localhost:6380",
        cortices: 29,
      },
      {
        postgres: { ok: true, pgvector: "0.8.2" },
        redis: { ok: true },
        cortices: 29,
        catalog: { satellites: 500, regimes: 12 },
      },
    );

    expect(text).toContain("/api/repl/turn");
    expect(text).toContain(`-H 'content-type: application/json'`);
    expect(text).toContain(`{"input":"LEO traffic"}`);
    expect(text).not.toContain(`{"query":"LEO traffic"}`);
  });
});
