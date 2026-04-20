import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { SatellitePayloadRow } from "../types/payload.types";

export type { SatellitePayloadRow } from "../types/payload.types";

/**
 * Reads the payload manifest for a single satellite.
 *
 * Shape is the many-to-many join `satellite_payload ⋈ payload`, yielding
 * one row per onboard payload with per-link role / mass / power budget
 * sourced from the join table and static identity from the catalog row.
 */
export class PayloadRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listBySatelliteId(satelliteId: bigint): Promise<SatellitePayloadRow[]> {
    const rows = await this.db.execute<SatellitePayloadRow>(sql`
      SELECT
        p.id::text    AS id,
        p.name,
        p.slug,
        sp.role,
        sp.mass_kg,
        sp.power_w,
        p.photo_url
      FROM satellite_payload sp
      JOIN payload p ON p.id = sp.payload_id
      WHERE sp.satellite_id = ${satelliteId}
      ORDER BY p.name
    `);
    return rows.rows;
  }
}
