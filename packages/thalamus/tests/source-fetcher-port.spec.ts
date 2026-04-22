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

export function sourceFetcherPortContract(
  name: string,
  build: () => SourceFetcherPort,
): void {
  describe(`SourceFetcherPort contract — ${name}`, () => {
    it("fetchForCortex returns an array", async () => {
      expect(Array.isArray(await build().fetchForCortex("any_cortex", {}))).toBe(
        true,
      );
    });

    it("fetchForCortex returns a fresh array on each call", async () => {
      const fetcher = build();
      const a = await fetcher.fetchForCortex("x", {});
      const b = await fetcher.fetchForCortex("y", {});
      expect(a).not.toBe(b);
    });

    it("fetchForCortex handles unknown cortex names without throwing", async () => {
      await expect(build().fetchForCortex("does-not-exist", {})).resolves.toEqual(
        expect.any(Array),
      );
    });
  });
}

sourceFetcherPortContract("NoopSourceFetcher", () => new NoopSourceFetcher());

describe("NoopSourceFetcher — kernel default when no domain adapter injected", () => {
  it("returns an empty array for any cortex + params", async () => {
    const out = await new NoopSourceFetcher().fetchForCortex("any_cortex", {
      foo: 1,
    });
    expect(out).toEqual([]);
  });
});
