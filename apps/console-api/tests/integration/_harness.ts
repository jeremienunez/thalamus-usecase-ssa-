import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";

import * as schema from "@interview/db-schema";
export const INTEGRATION_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

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

export interface IntegrationHarness {
  databaseName: string;
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createIntegrationHarness(): Promise<IntegrationHarness> {
  const adminPool = new Pool({
    connectionString: INTEGRATION_DATABASE_URL,
    max: 1,
  });
  const databaseName = `it_${randomUUID().replace(/-/g, "")}`;
  const adminClient = await adminPool.connect();

  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdent(databaseName)}`);
    await migrateIntoDatabase(databaseName);
  } finally {
    adminClient.release();
  }

  const pool = new Pool({
    connectionString: withDatabaseName(INTEGRATION_DATABASE_URL, databaseName),
    max: 1,
  });
  const client = await pool.connect();
  const db = drizzle<typeof schema>(client, { schema });

  let cachedTables: string[] | null = null;

  async function listTables(): Promise<string[]> {
    if (cachedTables) return cachedTables;
    const result = await client.query<{ tablename: string }>(
      `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '__drizzle_migrations'
        ORDER BY tablename
      `,
    );
    cachedTables = result.rows.map((row) => row.tablename);
    return cachedTables;
  }

  async function reset(): Promise<void> {
    const tables = await listTables();
    if (tables.length === 0) return;
    const identifiers = tables
      .map((tableName) => `public.${quoteIdent(tableName)}`)
      .join(", ");
    await db.execute(sql.raw(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`));
  }

  async function close(): Promise<void> {
    try {
      client.release();
      await pool.end();
    } finally {
      await adminPool.query(
        `DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`,
      );
      await adminPool.end();
    }
  }

  return {
    databaseName,
    pool,
    db,
    reset,
    close,
  };
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function migrateIntoDatabase(databaseName: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..", "..", "..");
  const migrationsFolder = resolve(repoRoot, "packages", "db-schema", "migrations");
  const initSqlPath = resolve(repoRoot, "infra", "postgres", "init.sql");
  const migrationPool = new Pool({
    connectionString: withDatabaseName(INTEGRATION_DATABASE_URL, databaseName),
    max: 1,
  });
  const client = await migrationPool.connect();

  try {
    await client.query(readFileSync(initSqlPath, "utf8"));

    for (const fileName of PRE_DRIZZLE_SQL) {
      await client.query(readFileSync(resolve(migrationsFolder, fileName), "utf8"));
    }

    await migrate(drizzle(client), { migrationsFolder });

    for (const fileName of POST_DRIZZLE_SQL) {
      await client.query(readFileSync(resolve(migrationsFolder, fileName), "utf8"));
    }
  } finally {
    client.release();
    await migrationPool.end();
  }
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.search = "";
  return url.toString();
}
