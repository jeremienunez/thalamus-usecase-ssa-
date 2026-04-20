import { describe, it, expect, vi } from "vitest";
import { createPayloadsApi } from "./payloads";
import type { ApiFetcher } from "./client";

const fakeFetcher = (paths: string[]): ApiFetcher => ({
  getJson: vi.fn(async (p: string) => {
    paths.push(p);
    return { items: [], count: 0 };
  }),
  postJson: vi.fn(),
});

describe("createPayloadsApi", () => {
  it("listForSatellite() hits /api/satellites/:id/payloads with the numeric id", async () => {
    const paths: string[] = [];
    const api = createPayloadsApi(fakeFetcher(paths));
    await api.listForSatellite(42);
    expect(paths).toEqual(["/api/satellites/42/payloads"]);
  });
});
