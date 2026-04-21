import { describe, expect, it } from "vitest";
import { CycleRunBodySchema } from "../../../src/schemas/cycles.schema";

describe("CycleRunBodySchema", () => {
  it("accepts valid kinds with or without a query", () => {
    expect(CycleRunBodySchema.parse({ kind: "thalamus" })).toEqual({ kind: "thalamus" });
    expect(CycleRunBodySchema.parse({ kind: "both", query: "  debris watch  " })).toEqual({
      kind: "both",
      query: "debris watch",
    });
  });

  it("rejects unknown kinds", () => {
    expect(CycleRunBodySchema.safeParse({ kind: "all" }).success).toBe(false);
  });

  it("rejects blank queries after trim even for valid kinds", () => {
    expect(CycleRunBodySchema.safeParse({ kind: "fish", query: "   " }).success).toBe(false);
  });
});
