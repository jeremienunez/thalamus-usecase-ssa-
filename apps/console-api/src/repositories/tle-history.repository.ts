import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { NewTleHistory } from "@interview/db-schema";

export interface TleHistoryRow {
  satelliteId: bigint;
  noradId: number;
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclinationDeg: number;
  raan: number | null;
  argOfPerigee: number | null;
  meanAnomaly: number | null;
  bstar: number | null;
}

export class TleHistoryRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Batch-insert TLE snapshots. Idempotent via the `(satellite_id, epoch)`
   * unique index — repeated fetches of the same epoch are silently ignored
   * and the inserted count reflects only first-time rows.
   */
  async upsertMany(rows: NewTleHistory[]): Promise<number> {
    if (rows.length === 0) return 0;

    // Chunk size stays under Postgres' 1664-entry expression-list limit
    // (10 cols × 150 rows = 1500 entries per multi-row VALUES statement).
    const CHUNK = 150;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values = chunk
        .map(
          (r) => sql`(
            ${r.satelliteId}::bigint,
            ${r.noradId}::int,
            ${r.epoch},
            ${r.meanMotion}::real,
            ${r.eccentricity}::real,
            ${r.inclinationDeg}::real,
            ${r.raan}::real,
            ${r.argOfPerigee}::real,
            ${r.meanAnomaly}::real,
            ${r.bstar}::real
          )`,
        );
      const joined = sql.join(values, sql`, `);
      const result = await this.db.execute(sql`
        INSERT INTO tle_history (
          satellite_id, norad_id, epoch,
          mean_motion, eccentricity, inclination_deg,
          raan, arg_of_perigee, mean_anomaly, bstar
        )
        VALUES ${joined}
        ON CONFLICT (satellite_id, epoch) DO NOTHING
      `);
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  /** Return the last N TLE snapshots for one satellite, newest first. */
  async listRecentForSatellite(
    satelliteId: bigint,
    limit: number,
  ): Promise<TleHistoryRow[]> {
    const result = await this.db.execute<TleHistoryRow & Record<string, unknown>>(sql`
      SELECT
        satellite_id    AS "satelliteId",
        norad_id        AS "noradId",
        epoch::text     AS "epoch",
        mean_motion     AS "meanMotion",
        eccentricity    AS "eccentricity",
        inclination_deg AS "inclinationDeg",
        raan            AS "raan",
        arg_of_perigee  AS "argOfPerigee",
        mean_anomaly    AS "meanAnomaly",
        bstar           AS "bstar"
      FROM tle_history
      WHERE satellite_id = ${satelliteId}
      ORDER BY epoch DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  /** Return the last N TLE snapshots for a NORAD id, newest first. */
  async listRecentForNorad(
    noradId: number,
    limit: number,
  ): Promise<TleHistoryRow[]> {
    const result = await this.db.execute<TleHistoryRow & Record<string, unknown>>(sql`
      SELECT
        satellite_id    AS "satelliteId",
        norad_id        AS "noradId",
        epoch::text     AS "epoch",
        mean_motion     AS "meanMotion",
        eccentricity    AS "eccentricity",
        inclination_deg AS "inclinationDeg",
        raan            AS "raan",
        arg_of_perigee  AS "argOfPerigee",
        mean_anomaly    AS "meanAnomaly",
        bstar           AS "bstar"
      FROM tle_history
      WHERE norad_id = ${noradId}
      ORDER BY epoch DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async countRows(): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM tle_history`,
    );
    return (result.rows[0] as { n: number }).n;
  }
}
