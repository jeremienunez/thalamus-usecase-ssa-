/**
 * Boot-time health snapshot for the console-api banner's System block.
 *
 * This is NOT request-time code: it runs once during boot, produces a static
 * snapshot, prints it, done. That's why it lives under infra/ (external
 * system probing) and not under services/ + repositories/ (which are
 * reserved for the request cycle: controller → service → repository → db).
 *
 * Every probe is defensive: a single failure (DB not migrated yet, Redis
 * restart) must never kill the boot. Failing probes report ok=false and
 * null counts; the banner renders a red dot instead of a green one.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Redis from "ioredis";
import { sql } from "drizzle-orm";

export type HealthSnapshot = {
  postgres: { ok: boolean; pgvector: string | null };
  redis: { ok: boolean };
  cortices: number;
  catalog: { satellites: number | null; regimes: number | null };
};

export async function snapshotHealth(
  db: NodePgDatabase<Record<string, unknown>>,
  redis: Redis,
  corticesCount: number,
): Promise<HealthSnapshot> {
  const [postgres, catalog, redisOk] = await Promise.all([
    probePostgres(db),
    probeCatalog(db),
    probeRedis(redis),
  ]);
  return {
    postgres,
    redis: { ok: redisOk },
    cortices: corticesCount,
    catalog,
  };
}

async function probePostgres(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<HealthSnapshot["postgres"]> {
  try {
    const res = await db.execute(
      sql`select extversion from pg_extension where extname = 'vector' limit 1`,
    );
    const row = (res as { rows: Array<{ extversion?: string }> }).rows[0];
    return { ok: true, pgvector: row?.extversion ?? null };
  } catch {
    return { ok: false, pgvector: null };
  }
}

async function probeCatalog(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<HealthSnapshot["catalog"]> {
  try {
    const sats = await db.execute(
      sql`select count(*)::int as n from satellite`,
    );
    const regs = await db.execute(
      sql`select count(distinct orbit_regime_id)::int as n from satellite where orbit_regime_id is not null`,
    );
    const satRow = (sats as { rows: Array<{ n?: number }> }).rows[0];
    const regRow = (regs as { rows: Array<{ n?: number }> }).rows[0];
    return {
      satellites: satRow?.n ?? null,
      regimes: regRow?.n ?? null,
    };
  } catch {
    return { satellites: null, regimes: null };
  }
}

async function probeRedis(redis: Redis): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}
