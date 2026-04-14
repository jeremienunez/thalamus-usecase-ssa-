import { describe, it, expect } from "vitest";
import { countTokens } from "../../src/memory/tokens";

describe("countTokens", () => {
  it("returns positive int for non-empty string", () => {
    expect(countTokens("hello world")).toBeGreaterThan(0);
  });
  it("zero for empty", () => {
    expect(countTokens("")).toBe(0);
  });
});
