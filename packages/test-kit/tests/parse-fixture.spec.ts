import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseFixture } from "../src";

describe("@interview/test-kit parseFixture", () => {
  const schema = z.object({
    id: z.number().int(),
    name: z.string(),
  });

  it("returns typed data when the fixture matches the schema", () => {
    expect(parseFixture(schema, { id: 7, name: "AQUA" })).toEqual({
      id: 7,
      name: "AQUA",
    });
  });

  it("throws a formatted zod error when the fixture shape drifts", () => {
    expect(() => parseFixture(schema, { id: "7", name: "AQUA" })).toThrow(
      /parseFixture: fixture does not match schema:/,
    );
  });
});
