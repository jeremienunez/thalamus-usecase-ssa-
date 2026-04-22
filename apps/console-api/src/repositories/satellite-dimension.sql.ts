import { sql } from "drizzle-orm";

// Canonical catalog dimension joins for queries rooted at `satellite s`.
export const satelliteDimensionJoinsSql = sql`
  LEFT JOIN operator op ON op.id = s.operator_id
  LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
  LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
  LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
`;

export const satelliteOrbitRegimeJoinSql = sql`
  LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
`;
