import { describe, expect, it } from "vitest";
import { pgTable } from "drizzle-orm/pg-core";
import { vector } from "../src/schema/_vector";

const vectorTable = pgTable("vector_driver_test", {
  embedding: vector("embedding", { dimensions: 3 }),
});

describe("vector custom type", () => {
  it("serializes vectors to pgvector wire format", () => {
    expect(vectorTable.embedding.getSQLType()).toBe("halfvec(3)");
    expect(vectorTable.embedding.mapToDriverValue([1, 2.5, -3])).toBe(
      "[1,2.5,-3]",
    );
  });

  it("parses bracketed and unbracketed finite vectors", () => {
    expect(vectorTable.embedding.mapFromDriverValue("[1,2.5,-3]")).toEqual([
      1, 2.5, -3,
    ]);
    expect(vectorTable.embedding.mapFromDriverValue("1, 2.5, -3")).toEqual([
      1, 2.5, -3,
    ]);
  });

  it("returns an empty vector for null or empty driver values", () => {
    expect(vectorTable.embedding.mapFromDriverValue(null)).toEqual([]);
    expect(vectorTable.embedding.mapFromDriverValue("")).toEqual([]);
    expect(vectorTable.embedding.mapFromDriverValue("[]")).toEqual([]);
  });

  it("throws on malformed or non-finite driver values", () => {
    expect(() =>
      vectorTable.embedding.mapFromDriverValue("[not-a-number]"),
    ).toThrow("Invalid vector driver value");
    expect(() => vectorTable.embedding.mapFromDriverValue("[1,,2]")).toThrow(
      "Invalid vector driver value",
    );
    expect(() =>
      vectorTable.embedding.mapFromDriverValue("[Infinity]"),
    ).toThrow("Invalid vector driver value");
  });
});
