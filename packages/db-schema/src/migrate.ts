/**
 * Programmatic migration runner for prod.
 *
 * The migration corpus in this repo has two kinds of files:
 *
 *   1. Drizzle-generated (tracked in migrations/meta/_journal.json):
 *        0000_flawless_dorian_gray.sql, 0001_whole_liz_osborn.sql, ...
 *      -> applied by drizzle's own `migrate()`, which idempotently skips
 *         files already recorded in the `__drizzle_migrations` table.
 *
 *   2. Hand-injected raw SQL (NOT in the journal — drizzle-kit can't emit
 *      them: HNSW indexes, pg_trgm GIN indexes, enum preludes, SQL fns):
 *        0000_enums_prelude.sql       <-- must run BEFORE drizzle migrations
 *                                         (tables reference these enum types)
 *        0001_hnsw_index.sql          ┐
 *        0002_embedding_2048.sql      │ must run AFTER drizzle migrations
 *        0003_sim_memory_hnsw.sql     │ (they reference tables)
 *        0011_source_item_trgm_gin.sql│
 *        0012_orbital_analytics_fns.sql
 *        0013_conjunction_knn_fn.sql  ┘
 *      All of them are authored to be fully idempotent
 *      (`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
 *      `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object`), so replaying
 *      them on every deploy is safe.
 *
 * Exit code is 0 on success, 1 on any failure. The caller (K8s Job, init
 * container, CI step) halts the rollout on non-zero.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Names relative to the migrations/ folder, in intended execution order.
const PRE_DRIZZLE_SQL = ["0000_enums_prelude.sql"] as const;

const POST_DRIZZLE_SQL = [
  "0001_hnsw_index.sql",
  "0002_embedding_2048.sql",
  "0003_sim_memory_hnsw.sql",
  "0011_source_item_trgm_gin.sql",
  "0012_orbital_analytics_fns.sql",
  "0013_conjunction_knn_fn.sql",
  "0014_satellite_embedding.sql",
] as const;

export type RunMigrationsOptions = {
  databaseUrl: string;
  initSqlPath?: string;
  migrationsFolder?: string;
};

export async function runMigrations({
  databaseUrl,
  initSqlPath,
  migrationsFolder,
}: RunMigrationsOptions): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const resolvedMigrationsFolder =
    migrationsFolder ?? resolve(here, "..", "migrations");
  const resolvedInitSqlPath =
    initSqlPath ??
    resolve(here, "..", "..", "..", "infra", "postgres", "init.sql");

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const db = drizzle(pool);
  const t0 = Date.now();

  console.log(`migrate: target ${redact(databaseUrl)}`);
  console.log(`migrate: folder ${resolvedMigrationsFolder}`);

  try {
    await runInitSql(pool, resolvedInitSqlPath);
    await runRawSql(
      pool,
      resolvedMigrationsFolder,
      PRE_DRIZZLE_SQL,
      "pre-drizzle",
    );
    await runDrizzle(db, resolvedMigrationsFolder);
    await runRawSql(
      pool,
      resolvedMigrationsFolder,
      POST_DRIZZLE_SQL,
      "post-drizzle",
    );
    console.log(`migrate: ok (${Date.now() - t0}ms)`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("migrate: DATABASE_URL is required");
    process.exit(1);
  }
  await runMigrations({ databaseUrl: url });
}

async function runInitSql(pool: Pool, path: string): Promise<void> {
  const sql = readFileSync(path, "utf8");
  const t = Date.now();
  console.log(`  [bootstrap] ${path} ...`);
  await pool.query(sql);
  console.log(`  [bootstrap] ok (${Date.now() - t}ms)`);
}

async function runRawSql(
  pool: Pool,
  folder: string,
  files: readonly string[],
  phase: string,
): Promise<void> {
  for (const name of files) {
    const path = resolve(folder, name);
    const sql = readFileSync(path, "utf8");
    const t = Date.now();
    console.log(`  [${phase}] ${name} ...`);
    await pool.query(sql);
    console.log(`  [${phase}] ${name} ok (${Date.now() - t}ms)`);
  }
}

async function runDrizzle(
  db: ReturnType<typeof drizzle>,
  migrationsFolder: string,
): Promise<void> {
  const t = Date.now();
  console.log("  [drizzle] migrate() via _journal.json ...");
  await migrate(db, { migrationsFolder });
  console.log(`  [drizzle] ok (${Date.now() - t}ms)`);
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("migrate: failed", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
