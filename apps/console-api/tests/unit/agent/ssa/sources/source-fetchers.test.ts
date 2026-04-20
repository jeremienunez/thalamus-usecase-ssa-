/**
 * SPEC-TH-011 — Source Fetchers
 *
 * Tests the shipped SourceFetcher contract and the SSA source-kind catalog.
 * Concrete fetchers hit external HTTP (CelesTrak, NOAA SWPC, ITU SRS, ESA
 * DISCOS) — those live in `tests/integration/`. Here we lock the interface.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  SourceFetcher,
  SourceResult,
  SourceKind,
} from "../../../../../src/agent/ssa/sources/types";
import * as sourcesIndex from "../../../../../src/agent/ssa/sources";

describe("SPEC-TH-011 SourceFetcher contract", () => {
  it("SourceResult has the documented shape", () => {
    expectTypeOf<SourceResult>().toHaveProperty("type").toEqualTypeOf<string>();
    expectTypeOf<SourceResult>()
      .toHaveProperty("source")
      .toEqualTypeOf<string>();
    expectTypeOf<SourceResult>()
      .toHaveProperty("fetchedAt")
      .toEqualTypeOf<string>();
    expectTypeOf<SourceResult>()
      .toHaveProperty("latencyMs")
      .toEqualTypeOf<number>();
    expectTypeOf<SourceResult>()
      .toHaveProperty("data")
      .toEqualTypeOf<unknown>();
  });

  it("SourceFetcher is a Promise-returning function of params → SourceResult[]", () => {
    expectTypeOf<SourceFetcher>().toEqualTypeOf<
      (params: Record<string, unknown>) => Promise<SourceResult[]>
    >();
  });

  it("a conforming fetcher typechecks against the interface", async () => {
    const fakeFetcher: SourceFetcher = async () => [
      {
        type: "celestrak",
        source: "CelesTrak",
        url: "https://celestrak.org/NORAD/elements/",
        data: { ok: true },
        fetchedAt: new Date().toISOString(),
        latencyMs: 42,
      },
    ];
    const out = await fakeFetcher({ noradId: 25544 });
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("celestrak");
    expect(out[0]!.latencyMs).toBe(42);
  });
});

describe("SPEC-TH-011 SourceKind catalog (SSA)", () => {
  it("union covers the 8 SSA source kinds", () => {
    const kinds: SourceKind[] = [
      "celestrak",
      "space-weather",
      "launch-market",
      "bus-archetype",
      "orbit-regime",
      "spectra",
      "regulation",
      "knowledge-graph",
    ];
    expect(kinds).toHaveLength(8);
    // Compile-time: each literal is assignable to SourceKind — the variable type is SourceKind[].
    expectTypeOf<(typeof kinds)[number]>().toEqualTypeOf<SourceKind>();
  });
});

describe("SPEC-TH-011 sources barrel surface", () => {
  it("index re-exports types and the cortex → fetchers entry point", () => {
    const keys = Object.keys(sourcesIndex);
    // The barrel should at minimum expose `fetchSourcesForCortex` (used by executor).
    expect(keys).toContain("fetchSourcesForCortex");
  });

  it("fetchSourcesForCortex returns [] for an unknown cortex without throwing", async () => {
    const out = await (
      sourcesIndex as unknown as {
        fetchSourcesForCortex: (
          c: string,
          p: Record<string, unknown>,
        ) => Promise<SourceResult[]>;
      }
    ).fetchSourcesForCortex("not_a_real_cortex", {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });
});

describe("SPEC-TH-011 integration-only ACs", () => {
  it.todo("AC-HTTP each concrete fetcher handles 4xx/5xx as empty results");
  it.todo("AC-timeout concrete fetcher aborts after 10s with empty result");
  it.todo("AC-rate-limit concrete fetcher respects per-source RPS cap");
});
