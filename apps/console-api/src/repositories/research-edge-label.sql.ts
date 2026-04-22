import { sql } from "drizzle-orm";

// Canonical node-ref resolution for research_edge entity references.
//
// This powers KG node ids and linkedEntityIds. It intentionally keeps
// satellites as raw ids so the graph can continue to use `sat:${id}`.
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

// Human-readable display labels for inspection-style reads.
//
// Unlike the node-ref resolver above, this resolves satellites and other
// entity tables to their display names so legacy REPL graph reads stay useful.
export const researchEdgeEntityDisplayLabelExprSql = sql`
  CASE
    WHEN re.entity_type = 'satellite'
      THEN COALESCE(s.name, re.entity_id::text)
    WHEN re.entity_type = 'operator'
      THEN COALESCE(op_display.name, re.entity_id::text)
    WHEN re.entity_type = 'operator_country'
      THEN COALESCE(oc.name, re.entity_id::text)
    WHEN re.entity_type = 'orbit_regime'
      THEN COALESCE(r_display.name, re.entity_id::text)
    WHEN re.entity_type = 'payload'
      THEN COALESCE(p.name, re.entity_id::text)
    WHEN re.entity_type = 'satellite_bus'
      THEN COALESCE(sb.name, re.entity_id::text)
    WHEN re.entity_type = 'launch'
      THEN COALESCE(l.mission_name, l.name, re.entity_id::text)
    WHEN re.entity_type = 'finding'
      THEN COALESCE(rf_target.title, re.entity_id::text)
    WHEN re.entity_type = 'conjunction_event'
      THEN CONCAT('conjunction #', re.entity_id::text)
    ELSE re.entity_id::text
  END
`;

export const researchEdgeEntityDisplayLabelSql = sql`
  ${researchEdgeEntityDisplayLabelExprSql} AS to_name
`;

export const researchEdgeEntityDisplayLabelJoinsSql = sql`
  LEFT JOIN satellite s
    ON re.entity_type = 'satellite' AND s.id = re.entity_id
  LEFT JOIN operator op_display
    ON re.entity_type = 'operator' AND op_display.id = re.entity_id
  LEFT JOIN operator_country oc
    ON re.entity_type = 'operator_country' AND oc.id = re.entity_id
  LEFT JOIN orbit_regime r_display
    ON re.entity_type = 'orbit_regime' AND r_display.id = re.entity_id
  LEFT JOIN payload p
    ON re.entity_type = 'payload' AND p.id = re.entity_id
  LEFT JOIN satellite_bus sb
    ON re.entity_type = 'satellite_bus' AND sb.id = re.entity_id
  LEFT JOIN launch l
    ON re.entity_type = 'launch' AND l.id = re.entity_id
  LEFT JOIN research_finding rf_target
    ON re.entity_type = 'finding' AND rf_target.id = re.entity_id
`;
