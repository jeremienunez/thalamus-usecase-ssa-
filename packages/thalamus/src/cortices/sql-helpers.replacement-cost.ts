import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryReplacementCost — heuristic loss-actuary cost bands for a single satellite.
 *
 * No pricing data in DB; computes $/kg-driven bus + payload + launch estimates
 * from `mass_kg` and payload count. Bands = ±30 % around the mid estimate.
 * Returns a single-row array (or empty if the satellite id is unknown).
 */

export interface ReplacementCostRow {
  satelliteId: number;
  name: string;
  operatorName: string | null;
  massKg: number | null;
  busName: string | null;
  payloadNames: string[];
  estimatedCost: { low: number; mid: number; high: number; currency: "USD" };
  breakdown: { bus: number; payload: number; launch: number };
}

interface RawRow {
  satelliteId: number;
  name: string;
  operatorName: string | null;
  massKg: number | null;
  busName: string | null;
  payloadNames: string[] | null;
}

const FALLBACK_MASS_KG = 500;
const USD_PER_KG_BUS = 50_000;
const USD_PER_PAYLOAD_FIXED = 10_000_000;
const USD_PER_KG_LAUNCH = 10_000;

export async function queryReplacementCost(
  db: Database,
  opts: { satelliteId: string | number | bigint },
): Promise<ReplacementCostRow[]> {
  if (opts.satelliteId == null) return [];

  const results = await db.execute(sql`
    SELECT
      s.id::int           AS "satelliteId",
      s.name,
      op.name             AS "operatorName",
      s.mass_kg           AS "massKg",
      sb.name             AS "busName",
      (
        SELECT array_agg(p.name ORDER BY p.name)
        FROM satellite_payload sp
        JOIN payload p ON p.id = sp.payload_id
        WHERE sp.satellite_id = s.id
      )                   AS "payloadNames"
    FROM satellite s
    LEFT JOIN operator op    ON op.id = s.operator_id
    LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
    WHERE s.id = ${BigInt(opts.satelliteId as string | number)}
    LIMIT 1
  `);

  const row = results.rows[0] as unknown as RawRow | undefined;
  if (!row) return [];

  const massKg = row.massKg ?? FALLBACK_MASS_KG;
  const payloadNames = row.payloadNames ?? [];
  const bus = massKg * USD_PER_KG_BUS;
  const payload = Math.max(payloadNames.length, 1) * USD_PER_PAYLOAD_FIXED;
  const launch = massKg * USD_PER_KG_LAUNCH;
  const mid = bus + payload + launch;

  return [
    {
      satelliteId: row.satelliteId,
      name: row.name,
      operatorName: row.operatorName,
      massKg: row.massKg,
      busName: row.busName,
      payloadNames,
      estimatedCost: {
        low: Math.round(mid * 0.7),
        mid: Math.round(mid),
        high: Math.round(mid * 1.3),
        currency: "USD",
      },
      breakdown: {
        bus: Math.round(bus),
        payload: Math.round(payload),
        launch: Math.round(launch),
      },
    },
  ];
}
