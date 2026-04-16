import { describe, it, expect } from "vitest";
import { parseExplicitCommand } from "../../src/router/parser";
import { StepSchema, RouterPlanSchema } from "../../src/router/schema";

describe("pc action — parser", () => {
  it("parses /pc <conjunctionId>", () => {
    expect(parseExplicitCommand("/pc ce:1")).toEqual({
      steps: [{ action: "pc", conjunctionId: "ce:1" }],
      confidence: 1,
    });
  });
  it("parses /pc with numeric id", () => {
    expect(parseExplicitCommand("/pc 42")).toEqual({
      steps: [{ action: "pc", conjunctionId: "42" }],
      confidence: 1,
    });
  });
  it("returns null for /pc with no arg", () => {
    expect(parseExplicitCommand("/pc")).toBeNull();
  });
  it("only takes first token", () => {
    expect(parseExplicitCommand("/pc ce:7 extra noise")).toEqual({
      steps: [{ action: "pc", conjunctionId: "ce:7" }],
      confidence: 1,
    });
  });
});

describe("pc action — schema", () => {
  it("accepts a pc step", () => {
    expect(() =>
      StepSchema.parse({ action: "pc", conjunctionId: "ce:1" }),
    ).not.toThrow();
  });
  it("rejects pc step without conjunctionId", () => {
    expect(() =>
      StepSchema.parse({ action: "pc" } as unknown),
    ).toThrow();
  });
  it("accepts a plan with one pc step", () => {
    expect(() =>
      RouterPlanSchema.parse({
        steps: [{ action: "pc", conjunctionId: "ce:1" }],
        confidence: 1,
      }),
    ).not.toThrow();
  });
});
