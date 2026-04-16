import { describe, expect, it } from "vitest";
import {
  MissionStartBodySchema,
  SweepReviewBodySchema,
  SweepReviewParamsSchema,
} from "../../../src/schemas/sweep.schema";

describe("SweepReviewParamsSchema", () => {
  it("accepts non-empty ids up to 128 chars", () => {
    expect(SweepReviewParamsSchema.parse({ id: "pending:123" })).toEqual({ id: "pending:123" });
    expect(SweepReviewParamsSchema.safeParse({ id: "" }).success).toBe(false);
    expect(SweepReviewParamsSchema.safeParse({ id: "x".repeat(129) }).success).toBe(false);
  });
});

describe("SweepReviewBodySchema", () => {
  it("accepts strict booleans and optional reasons", () => {
    expect(SweepReviewBodySchema.parse({ accept: true })).toEqual({ accept: true });
    expect(SweepReviewBodySchema.parse({ accept: false, reason: "needs review" })).toEqual({
      accept: false,
      reason: "needs review",
    });
  });

  it("rejects non-boolean accept values and oversized reasons", () => {
    expect(SweepReviewBodySchema.safeParse({ accept: "true" }).success).toBe(false);
    expect(
      SweepReviewBodySchema.safeParse({
        accept: true,
        reason: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });
});

describe("MissionStartBodySchema", () => {
  it("defaults maxSatsPerSuggestion to 5", () => {
    expect(MissionStartBodySchema.parse({})).toEqual({ maxSatsPerSuggestion: 5 });
  });

  it("clamps maxSatsPerSuggestion into the supported range", () => {
    expect(MissionStartBodySchema.parse({ maxSatsPerSuggestion: 0 })).toEqual({
      maxSatsPerSuggestion: 1,
    });
    expect(MissionStartBodySchema.parse({ maxSatsPerSuggestion: 25 })).toEqual({
      maxSatsPerSuggestion: 20,
    });
  });

  it("rejects non-finite and boolean maxSatsPerSuggestion values", () => {
    for (const maxSatsPerSuggestion of [NaN, Infinity, -Infinity, true, false]) {
      expect(MissionStartBodySchema.safeParse({ maxSatsPerSuggestion }).success).toBe(false);
    }
  });
});
