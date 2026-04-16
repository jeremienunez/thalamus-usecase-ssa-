import { describe, expect, it } from "vitest";
import { KnnPropagateBodySchema } from "../../../src/schemas/knn-propagation.schema";

describe("KnnPropagateBodySchema", () => {
  it("fills defaults for tunables and dryRun", () => {
    expect(KnnPropagateBodySchema.parse({ field: "variant" })).toEqual({
      field: "variant",
      k: 5,
      minSim: 0.8,
      limit: 500,
      dryRun: false,
    });
  });

  it("clamps k, minSim, and limit into the supported ranges", () => {
    expect(
      KnnPropagateBodySchema.parse({
        field: "power",
        k: 1,
        minSim: 2,
        limit: 10_000,
        dryRun: true,
      }),
    ).toEqual({
      field: "power",
      k: 3,
      minSim: 0.99,
      limit: 2000,
      dryRun: true,
    });
  });

  it("rejects invalid strict fields", () => {
    expect(KnnPropagateBodySchema.safeParse({ field: "altitude" }).success).toBe(false);
    expect(
      KnnPropagateBodySchema.safeParse({
        field: "variant",
        dryRun: "false",
      }).success,
    ).toBe(false);
  });

  it("rejects non-finite and boolean numeric knobs", () => {
    for (const k of [NaN, Infinity, -Infinity, true, false]) {
      expect(KnnPropagateBodySchema.safeParse({ field: "variant", k }).success).toBe(false);
    }
  });
});
