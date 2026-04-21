/**
 * SPEC-TH-011 — Source Fetchers
 *
 * Concrete fetchers hit external HTTP (CelesTrak, NOAA SWPC, ITU SRS, ESA
 * DISCOS) — those live in `tests/integration/`. This unit file keeps only
 * the deterministic registry behavior owned locally: dispatch, cache-key
 * handling, and partial-failure tolerance.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { SourceResult } from "../../../../../src/agent/ssa/sources/types";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SPEC-TH-011 source dispatch", () => {
  it("returns an empty source list for an unknown cortex without throwing", async () => {
    const sourcesIndex = (await import(
      "../../../../../src/agent/ssa/sources"
    )) as {
      fetchSourcesForCortex: (
        c: string,
        p: Record<string, unknown>,
      ) => Promise<SourceResult[]>;
    };
    const out = await sourcesIndex.fetchSourcesForCortex("not_a_real_cortex", {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });

  it("loads the production self-registered CelesTrak fetcher via sources/index", async () => {
    await import("../../../../../src/agent/ssa/sources");
    const { fetchSourcesForCortex, getFetcherByKind } = await import(
      "../../../../../src/agent/ssa/sources/registry"
    );

    expect(getFetcherByKind("celestrak")).toBeTypeOf("function");
    const out = await fetchSourcesForCortex("launch_epoch_forecaster", {});

    expect(out).toContainEqual(
      expect.objectContaining({
        type: "orbit_model_reference",
        url: "https://celestrak.org/publications/AIAA/2006-6753/",
      }),
    );
  });

  it("reuses the cached result for identical bigint params instead of re-fetching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z"));

    const { registerSource, fetchSourcesForCortex } = await import(
      "../../../../../src/agent/ssa/sources/registry"
    );
    const fetcher = vi.fn(async (params: Record<string, unknown>) => {
      expect(params).toEqual({ operatorId: 42n });
      return [
        {
          type: "unit-cache",
          source: "cache-test",
          data: { operatorId: "42" },
          fetchedAt: new Date().toISOString(),
          latencyMs: 0,
        },
      ] satisfies SourceResult[];
    });
    registerSource(["unit_cache_bigint"], fetcher);

    const first = await fetchSourcesForCortex("unit_cache_bigint", {
      operatorId: 42n,
    });
    const second = await fetchSourcesForCortex("unit_cache_bigint", {
      operatorId: 42n,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("keeps fulfilled results when one registered fetcher rejects", async () => {
    const { registerSource, fetchSourcesForCortex } = await import(
      "../../../../../src/agent/ssa/sources/registry"
    );
    const boom = vi.fn(async () => {
      throw new Error("network down");
    });
    const ok = vi.fn(async () => [
      {
        type: "unit-ok",
        source: "ok-fetcher",
        data: { value: 1 },
        fetchedAt: "2026-04-21T00:00:00.000Z",
        latencyMs: 4,
      },
    ] satisfies SourceResult[]);
    registerSource(["unit_partial_failure"], boom);
    registerSource(["unit_partial_failure"], ok);

    const out = await fetchSourcesForCortex("unit_partial_failure", {
      noradId: 25544,
    });

    expect(boom).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      {
        type: "unit-ok",
        source: "ok-fetcher",
        data: { value: 1 },
        fetchedAt: "2026-04-21T00:00:00.000Z",
        latencyMs: 4,
      },
    ]);
  });
});
