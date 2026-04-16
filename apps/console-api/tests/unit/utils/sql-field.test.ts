import { describe, it, expect } from "vitest";
import { fieldSqlFor } from "../../../src/utils/sql-field";
import { MISSION_WRITABLE_COLUMNS } from "../../../src/utils/field-constraints";

describe("fieldSqlFor", () => {
  it.each(Object.keys(MISSION_WRITABLE_COLUMNS))(
    "returns a SQL fragment for whitelisted field '%s'",
    (field) => {
      expect(fieldSqlFor(field)).toBeDefined();
    },
  );

  it("throws on unknown field", () => {
    expect(() => fieldSqlFor("password")).toThrow(/unsupported field 'password'/);
  });

  it("throws on empty string", () => {
    expect(() => fieldSqlFor("")).toThrow(/unsupported field ''/);
  });
});
