import { describe, it, expect } from "vitest";
import { type BuildQueryConfig, SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { fieldSqlFor } from "../../../src/utils/sql-field";
import { MISSION_WRITABLE_COLUMNS } from "../../../src/utils/field-constraints";

function renderColumnSql(field: string): string {
  const fragment: SQL = fieldSqlFor(field);
  const config: BuildQueryConfig = {
    casing: new CasingCache(),
    escapeName: (name) => `"${name}"`,
    escapeParam: (num) => `$${num}`,
    escapeString: (value) => `'${value}'`,
  };
  return fragment.toQuery(config).sql;
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
