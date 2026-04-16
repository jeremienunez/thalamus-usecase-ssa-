import { describe, expect, it } from "vitest";
import { ConjunctionsQuerySchema } from "../../../src/schemas/conjunctions.schema";

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
