import { describe, it, expect } from "vitest";
import { fieldSqlFor } from "../../../src/utils/sql-field";
import { MISSION_WRITABLE_COLUMNS } from "../../../src/utils/field-constraints";

type SqlRenderer = {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: () => string;
    escapeString: (value: string) => string;
    casing: { getColumnCasing: (column: string) => string };
  }) => { sql: string };
};

function renderColumnSql(field: string): string {
  return (fieldSqlFor(field) as unknown as SqlRenderer).toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: () => "?",
    escapeString: (value) => `'${value}'`,
    casing: { getColumnCasing: (column) => column },
  }).sql;
}

describe("fieldSqlFor", () => {
  it.each(Object.keys(MISSION_WRITABLE_COLUMNS))(
    "returns the expected SQL identifier for whitelisted field '%s'",
    (field) => {
      expect(renderColumnSql(field)).toBe(field);
    },
  );

  it("throws on unknown field", () => {
    expect(() => fieldSqlFor("password")).toThrow(/unsupported field 'password'/);
  });

  it("throws on empty string", () => {
    expect(() => fieldSqlFor("")).toThrow(/unsupported field ''/);
  });
});
