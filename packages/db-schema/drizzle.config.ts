import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * - `schema`   : barrel of every pgTable/pgEnum in the package.
 * - `out`      : generated SQL migrations + journal.
 * - `dialect`  : postgresql (pgvector is loaded by init.sql, not by drizzle-kit).
 * - `dbCredentials.url` : reads DATABASE_URL from the environment (docker-compose
 *   default: postgres://thalamus:thalamus@localhost:5433/thalamus).
 *
 * `pnpm drizzle-kit generate` diff-compiles the schema into a new SQL file under
 * `migrations/`. The HNSW index on research_finding.embedding is patched in
 * manually after generate (drizzle-kit does not emit `USING hnsw`).
 */
export default {
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://thalamus:thalamus@localhost:5433/thalamus",
  },
  strict: true,
  verbose: true,
} satisfies Config;
