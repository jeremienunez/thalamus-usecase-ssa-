import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/utils/concurrency";

describe("mapWithConcurrency", () => {
  it("returns empty array for empty input", async () => {
    const result = await mapWithConcurrency([] as number[], 4, async (n) => n * 2);
    expect(result).toEqual([]);
  });

  it("preserves input order even when tasks resolve out-of-order", async () => {
    const delays = [30, 5, 15, 1, 20];
    const result = await mapWithConcurrency(delays, 3, async (d, i) => {
      await new Promise((r) => setTimeout(r, d));
      return i;
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("caps concurrency at the given limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBe(4);
  });

  it("never exceeds items.length concurrent workers (limit > items.length)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3], 100, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBe(3);
  });

  it("propagates the first rejection and stops spawning new work", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
        started.push(n);
        if (n === 1) throw new Error("boom");
        await new Promise((r) => setTimeout(r, 10));
        return n;
      }),
    ).rejects.toThrow("boom");
    // Once the rejection surfaces, workers that were mid-flight finish, but
    // no new items beyond the concurrency window get started.
    expect(started.length).toBeLessThanOrEqual(3);
  });

  it("rejects on invalid limit", async () => {
    await expect(
      mapWithConcurrency([1, 2], 0, async (n) => n),
    ).rejects.toThrow("limit must be >= 1");
    await expect(
      mapWithConcurrency([1, 2], Number.NaN, async (n) => n),
    ).rejects.toThrow("limit must be >= 1");
  });
});
