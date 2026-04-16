import { describe, expect, it } from "vitest";
import { SatellitesQuerySchema } from "../../../src/schemas/satellites.schema";

describe("SatellitesQuerySchema", () => {
  it("accepts only supported regimes", () => {
    expect(SatellitesQuerySchema.parse({ regime: "GEO" })).toEqual({
      regime: "GEO",
      limit: 2000,
    });
    expect(SatellitesQuerySchema.safeParse({ regime: "geo" }).success).toBe(false);
  });

  it("defaults and clamps limit into the supported range", () => {
    expect(SatellitesQuerySchema.parse({})).toEqual({ limit: 2000 });
    expect(SatellitesQuerySchema.parse({ limit: 0 })).toEqual({ limit: 1 });
    expect(SatellitesQuerySchema.parse({ limit: 10_000 })).toEqual({ limit: 5000 });
  });

  it("rejects non-finite and boolean limit values", () => {
    for (const limit of [NaN, Infinity, -Infinity, true, false]) {
      expect(SatellitesQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });
});
