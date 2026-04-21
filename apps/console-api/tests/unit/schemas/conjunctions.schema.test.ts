import { describe, expect, it } from "vitest";
import {
  ConjunctionsQuerySchema,
  KnnCandidatesQuerySchema,
  ScreenQuerySchema,
} from "../../../src/schemas/conjunctions.schema";

describe("ConjunctionsQuerySchema", () => {
  it("defaults minPc to 0", () => {
    expect(ConjunctionsQuerySchema.parse({})).toEqual({ minPc: 0 });
  });

  it("clamps minPc into [0, 1]", () => {
    expect(ConjunctionsQuerySchema.parse({ minPc: -1 })).toEqual({ minPc: 0 });
    expect(ConjunctionsQuerySchema.parse({ minPc: 0.25 })).toEqual({ minPc: 0.25 });
    expect(ConjunctionsQuerySchema.parse({ minPc: 5 })).toEqual({ minPc: 1 });
  });

  it("rejects non-finite and boolean minPc values", () => {
    for (const minPc of [NaN, Infinity, -Infinity, true, false]) {
      expect(ConjunctionsQuerySchema.safeParse({ minPc }).success).toBe(false);
    }
  });
});

describe("ScreenQuerySchema", () => {
  it("clamps windowHours and limit, and normalises empty primaryNoradId to undefined", () => {
    expect(
      ScreenQuerySchema.parse({
        windowHours: 20_000,
        primaryNoradId: "",
        limit: 0,
      }),
    ).toEqual({
      windowHours: 8760,
      primaryNoradId: undefined,
      limit: 1,
    });
  });
});

describe("KnnCandidatesQuerySchema", () => {
  it("parses strings, clamps tunables, and normalises empty objectClass", () => {
    expect(
      KnnCandidatesQuerySchema.parse({
        targetNoradId: "25544",
        knnK: 0,
        limit: 999,
        marginKm: 999,
        objectClass: "",
        excludeSameFamily: "true",
        efSearch: 1,
      }),
    ).toEqual({
      targetNoradId: 25544,
      knnK: 1,
      limit: 500,
      marginKm: 500,
      objectClass: undefined,
      excludeSameFamily: true,
      efSearch: 10,
    });
  });

  it("rejects non-integer targetNoradId", () => {
    expect(
      KnnCandidatesQuerySchema.safeParse({ targetNoradId: "not-a-number" }).success,
    ).toBe(false);
  });
});
