import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type SpaceWeatherSource =
  | "noaa-swpc-27do"
  | "gfz-kp"
  | "sidc-eisn";

export interface SpaceWeatherRow {
  source: SpaceWeatherSource;
  epoch: string;
  f107: number | null;
  apIndex: number | null;
  kpIndex: number | null;
  sunspotNumber: number | null;
  issuedAt: string;
}

export class SpaceWeatherRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Latest forecast rows across all sources covering the horizon.
   * Returns the newest `issued_at` per (source, epoch) so the caller
   * sees each source's most current reading without audit duplicates.
   */
  async listLatestForecast(
    horizonDays: number,
    limit: number,
  ): Promise<SpaceWeatherRow[]> {
    const result = await this.db.execute<SpaceWeatherRow & Record<string, unknown>>(sql`
      SELECT DISTINCT ON (source, epoch)
        source               AS "source",
        epoch::text          AS "epoch",
        f107                 AS "f107",
        ap_index             AS "apIndex",
        kp_index             AS "kpIndex",
        sunspot_number       AS "sunspotNumber",
        issued_at::text      AS "issuedAt"
      FROM space_weather_forecast
      WHERE epoch >= now() - INTERVAL '7 days'
        AND epoch <= now() + (${horizonDays} || ' days')::interval
      ORDER BY source, epoch, issued_at DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async countRows(): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM space_weather_forecast`,
    );
    return (result.rows[0] as { n: number }).n;
  }

  async countBySource(): Promise<Record<string, number>> {
    const result = await this.db.execute<{ source: string; n: number }>(sql`
      SELECT source, COUNT(*)::int AS n
      FROM space_weather_forecast
      GROUP BY source
    `);
    const out: Record<string, number> = {};
    for (const r of result.rows) out[r.source] = r.n;
    return out;
  }
}
