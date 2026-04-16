import { describe, expect, it } from "vitest";
import { ReflexionPassBodySchema } from "../../../src/schemas/reflexion.schema";

describe("ReflexionPassBodySchema", () => {
  it("accepts numeric-string NORAD ids and fills tuning defaults", () => {
    expect(ReflexionPassBodySchema.parse({ noradId: "32958" })).toEqual({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });
  });

  it("clamps tuning values into the supported ranges", () => {
    expect(
      ReflexionPassBodySchema.parse({
        noradId: 32958,
        dIncMax: 0,
        dRaanMax: 50,
        dMmMax: 1,
      }),
    ).toEqual({
      noradId: 32958,
      dIncMax: 0.01,
      dRaanMax: 20,
      dMmMax: 0.5,
    });
  });

  it("rejects invalid strict NORAD ids", () => {
    for (const noradId of [0, -1, 1.5, NaN, Infinity, true, false]) {
      expect(ReflexionPassBodySchema.safeParse({ noradId }).success).toBe(false);
    }
  });

  it("rejects non-finite and boolean tuning values", () => {
    for (const dIncMax of [NaN, Infinity, -Infinity, true, false]) {
      expect(ReflexionPassBodySchema.safeParse({ noradId: 32958, dIncMax }).success).toBe(false);
    }
  });
});
