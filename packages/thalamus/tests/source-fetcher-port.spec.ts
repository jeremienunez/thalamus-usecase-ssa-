/**
 * SourceFetcherPort — Phase 3 · Task 3.3a of thalamus agnosticity cleanup.
 *
 * StandardStrategy currently imports `fetchSourcesForCortex` directly from
 * `../sources` (the SSA fetcher registry). This port lets the kernel call
 * domain-neutral code; the SSA adapter ships the concrete registry.
 */

import { describe, it, expect } from "vitest";
import {
  NoopSourceFetcher,
  type SourceFetcherPort,
} from "../src";

describe("NoopSourceFetcher — kernel default when no domain adapter injected", () => {
  it("returns an empty array for any cortex + params", async () => {
    const f: SourceFetcherPort = new NoopSourceFetcher();
    const out = await f.fetchForCortex("any_cortex", { foo: 1 });
    expect(out).toEqual([]);
  });

  it("returns a fresh array on each call (no shared mutation)", async () => {
    const f: SourceFetcherPort = new NoopSourceFetcher();
    const a = await f.fetchForCortex("x", {});
    const b = await f.fetchForCortex("y", {});
    expect(a).not.toBe(b);
  });
});
