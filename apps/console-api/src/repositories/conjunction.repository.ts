import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type ConjunctionRow = {
  id: string;
  primary_id: string;
  secondary_id: string;
  primary_name: string;
  secondary_name: string;
  primary_mm: number | null;
  epoch: Date | string;
  min_range_km: number;
  relative_velocity_kmps: number | null;
  probability_of_collision: number | null;
  combined_sigma_km: number | null;
  hard_body_radius_m: number | null;
  pc_method: string | null;
  computed_at: Date | string;
};

export class ConjunctionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listAboveMinPc(minPc: number): Promise<ConjunctionRow[]> {
    const rows = await this.db.execute<ConjunctionRow>(sql`
      SELECT
        ce.id::text                                         AS id,
        ce.primary_satellite_id::text                       AS primary_id,
        ce.secondary_satellite_id::text                     AS secondary_id,
        sp.name                                             AS primary_name,
        ss.name                                             AS secondary_name,
        NULLIF(sp.telemetry_summary->>'meanMotion','')::float AS primary_mm,
        ce.epoch,
        ce.min_range_km,
        ce.relative_velocity_kmps,
        ce.probability_of_collision,
        ce.combined_sigma_km,
        ce.hard_body_radius_m,
        ce.pc_method,
        ce.computed_at
      FROM conjunction_event ce
      LEFT JOIN satellite sp ON sp.id = ce.primary_satellite_id
      LEFT JOIN satellite ss ON ss.id = ce.secondary_satellite_id
      WHERE COALESCE(ce.probability_of_collision, 0) >= ${minPc}
      ORDER BY ce.probability_of_collision DESC NULLS LAST
      LIMIT 500
    `);
    return rows.rows;
  }
}
