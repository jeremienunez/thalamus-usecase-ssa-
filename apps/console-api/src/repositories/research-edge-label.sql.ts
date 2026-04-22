import { sql } from "drizzle-orm";

// Canonical label resolution for research_edge entity references.
export const researchEdgeEntityLabelSql = sql`
  CASE
    WHEN re.entity_type = 'operator'
      THEN COALESCE(op.name, re.entity_id::text)
    WHEN re.entity_type = 'orbit_regime'
      THEN COALESCE(r.name, re.entity_id::text)
    ELSE re.entity_id::text
  END AS entity_id
`;

export const researchEdgeEntityLabelJoinsSql = sql`
  LEFT JOIN operator op
    ON re.entity_type = 'operator' AND op.id = re.entity_id
  LEFT JOIN orbit_regime r
    ON re.entity_type = 'orbit_regime' AND r.id = re.entity_id
`;
