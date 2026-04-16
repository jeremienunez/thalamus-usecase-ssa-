import { sql, type SQL } from "drizzle-orm";

/** Guard: only the 5 whitelisted MISSION_WRITABLE_COLUMNS are ever interpolated. */
export function fieldSqlFor(field: string): SQL {
  switch (field) {
    case "variant":
      return sql`variant`;
    case "lifetime":
      return sql`lifetime`;
    case "power":
      return sql`power`;
    case "mass_kg":
      return sql`mass_kg`;
    case "launch_year":
      return sql`launch_year`;
    default:
      throw new Error(`fieldSqlFor: unsupported field '${field}'`);
  }
}
