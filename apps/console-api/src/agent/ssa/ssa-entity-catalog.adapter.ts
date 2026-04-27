/**
 * SSA EntityCatalogPort adapter.
 *
 * Consolidates the two SSA-specific responsibilities previously owned by
 * the kernel:
 *   - `resolveNames`: batch-resolves display names from (entityType, entityId)
 *     pairs across the SSA catalog tables (satellite, operator, launch…).
 *   - `cleanOrphans`: deletes research_edge rows whose target no longer
 *     exists in the SSA entity tables.
 *
 * Owns the ENTITY_TABLE_MAP and the CASCADE CASE SQL. Replaces the kernel's
 * deleted entity-name resolver and legacy edge orphan cleanup.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import type {
  EntityCatalogPort,
  EntityRef,
} from "@interview/thalamus";

const ENTITY_TABLE_MAP: Record<string, { table: string; nameCol: string }> = {
  satellite: { table: "satellite", nameCol: "name" },
  operator_country: { table: "operator_country", nameCol: "name" },
  operator: { table: "operator", nameCol: "name" },
  launch: { table: "launch", nameCol: "year" },
  satellite_bus: { table: "satellite_bus", nameCol: "name" },
  payload: { table: "payload", nameCol: "name" },
  orbit_regime: { table: "orbit_regime", nameCol: "name" },
  platform_class: { table: "platform_class", nameCol: "name" },
};

export class SsaEntityCatalogAdapter implements EntityCatalogPort {
  constructor(private db: Database) {}

  async resolveNames(refs: EntityRef[]): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();

    const grouped = new Map<string, bigint[]>();
    for (const ref of refs) {
      const ids = grouped.get(ref.entityType) ?? [];
      ids.push(ref.entityId);
      grouped.set(ref.entityType, ids);
    }

    const result = new Map<string, string>();

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

  async cleanOrphans(): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM research_edge re
      WHERE NOT EXISTS (
        CASE re.entity_type
          WHEN 'satellite' THEN (SELECT 1 FROM satellite WHERE id = re.entity_id)
          WHEN 'operator_country' THEN (SELECT 1 FROM operator_country WHERE id = re.entity_id)
          WHEN 'operator' THEN (SELECT 1 FROM operator WHERE id = re.entity_id)
          WHEN 'launch' THEN (SELECT 1 FROM launch WHERE id = re.entity_id)
          WHEN 'satellite_bus' THEN (SELECT 1 FROM satellite_bus WHERE id = re.entity_id)
          WHEN 'payload' THEN (SELECT 1 FROM payload WHERE id = re.entity_id)
          WHEN 'orbit_regime' THEN (SELECT 1 FROM orbit_regime WHERE id = re.entity_id)
          WHEN 'platform_class' THEN (SELECT 1 FROM platform_class WHERE id = re.entity_id)
          WHEN 'finding' THEN (SELECT 1 FROM research_finding WHERE id = re.entity_id)
          ELSE NULL
        END
      )
    `);
    return result.rowCount ?? 0;
  }
}
