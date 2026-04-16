import { describe, it, expect } from "vitest";
import {
  mapFindingStatus,
  toDbStatus,
  parseFindingId,
} from "./finding-status.transformer";

describe("mapFindingStatus", () => {
  it.each([
    ["archived", "accepted"],
    ["invalidated", "rejected"],
    ["active", "pending"],
    ["unknown", "in-review"],
  ])("db=%s → dto=%s", (db, dto) => {
    expect(mapFindingStatus(db)).toBe(dto);
  });
});

describe("toDbStatus", () => {
  it.each([
    ["accepted", "archived"],
    ["rejected", "invalidated"],
    ["pending", "active"],
    ["in-review", "active"],
  ])("dto=%s → db=%s", (dto, db) => {
    expect(toDbStatus(dto)).toBe(db);
  });
});

describe("parseFindingId", () => {
  it("strips f: prefix", () => expect(parseFindingId("f:42")).toBe(42n));
  it("accepts raw digits", () => expect(parseFindingId("17")).toBe(17n));
  it("rejects non-numeric", () => expect(parseFindingId("abc")).toBeNull());
  it("rejects empty", () => expect(parseFindingId("")).toBeNull());
});
