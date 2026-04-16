import { sql, type SQL } from "drizzle-orm";
import { MISSION_WRITABLE_COLUMNS } from "./field-constraints";

/**
 * Compile-time guard: if a MISSION_WRITABLE_COLUMNS key is renamed, this
 * assertion fails to typecheck until the switch below is updated.
 */
type _WritableFieldKeys = keyof typeof MISSION_WRITABLE_COLUMNS;
const _exhaustive: Record<_WritableFieldKeys, true> = {
  variant: true,
  lifetime: true,
  power: true,
  mass_kg: true,
  launch_year: true,
};
// Suppress "unused" — this exists purely for the type check above.
void _exhaustive;

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
