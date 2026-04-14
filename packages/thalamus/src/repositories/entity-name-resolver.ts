/**
 * Entity Name Resolver — Batch-resolves entity names from (type, id) pairs
 * Used by knowledge graph endpoint to hydrate node labels.
 *
 * Domain: SSA (Space Situational Awareness). Entity types match
 * `ResearchEntityType` values (satellite, operator_country, operator, …).
 */

import { sql } from "drizzle-orm";
import { type Database } from "@interview/db-schema";

export interface EntityRef {
  entityType: string;
  entityId: bigint;
}

/**
 * entityType → backing table + column used as the node label.
 * Keys track `ResearchEntityType` snake-case values.
 */
const ENTITY_TABLE_MAP: Record<string, { table: string; nameCol: string }> = {
  satellite: { table: "satellite", nameCol: "name" },
  operator_country: { table: "operator_country", nameCol: "name" },
  operator: { table: "operator", nameCol: "name" },
  // `launch` tracks a launch/campaign record; we key on year for now to
  // mirror the previous launch-year labeling shape.
  launch: { table: "launch", nameCol: "year" },
  satellite_bus: { table: "satellite_bus", nameCol: "name" },
  payload: { table: "payload", nameCol: "name" },
  orbit_regime: { table: "orbit_regime", nameCol: "name" },
  platform_class: { table: "platform_class", nameCol: "name" },
};

export class EntityNameResolver {
  constructor(private db: Database) {}

  /**
   * Resolve names for a batch of (entityType, entityId) pairs.
   * Returns Map<"type:id", name>. Missing entities silently omitted.
   */
  async resolve(refs: EntityRef[]): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();

    // Group by entity type
    const grouped = new Map<string, bigint[]>();
    for (const ref of refs) {
      const ids = grouped.get(ref.entityType) ?? [];
      ids.push(ref.entityId);
      grouped.set(ref.entityType, ids);
    }

    const result = new Map<string, string>();

    // Query each entity type in parallel
    const queries = [...grouped.entries()].map(async ([entityType, ids]) => {
      const mapping = ENTITY_TABLE_MAP[entityType];
      if (!mapping) return;

      const uniqueIds = [...new Set(ids.map((id) => id.toString()))];
      if (uniqueIds.length === 0) return;

      const idPlaceholders = uniqueIds.map((id) => sql`${id}`);
      const rows = await this.db.execute<{
        id: string | number | bigint;
        resolved_name: string;
      }>(
        sql`SELECT id, ${sql.raw(mapping.nameCol)}::text AS resolved_name FROM ${sql.raw(mapping.table)} WHERE id IN (${sql.join(idPlaceholders, sql`, `)})`,
      );

      for (const row of rows.rows) {
        result.set(`${entityType}:${row.id}`, row.resolved_name);
      }
    });

    await Promise.all(queries);
    return result;
  }
}
