import { describe, it, expect, vi } from "vitest";
import { createSatellitesApi } from "./satellites";
import type { ApiFetcher } from "./client";

const fakeFetcher = (paths: string[]): ApiFetcher => ({
  getJson: vi.fn(async (p: string) => {
    paths.push(p);
    return { items: [], count: 0 };
  }),
  postJson: vi.fn(),
});

describe("createSatellitesApi", () => {
  it("list() hits /api/satellites with no query when regime is undefined", async () => {
    const paths: string[] = [];
    const api = createSatellitesApi(fakeFetcher(paths));
    await api.list();
    expect(paths).toEqual(["/api/satellites"]);
  });

  it("list() appends regime query param", async () => {
    const paths: string[] = [];
    const api = createSatellitesApi(fakeFetcher(paths));
    await api.list("LEO");
    expect(paths).toEqual(["/api/satellites?regime=LEO"]);
  });
});
