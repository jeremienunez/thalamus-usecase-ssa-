import { runMigrations } from "../packages/db-schema/src/migrate";

function printHelp(): void {
  console.log(`Usage: pnpm tsx scripts/test-db-migrate.ts

Runs the production migration stack against DATABASE_URL for test and CI jobs.

Environment:
  DATABASE_URL   required, for example postgres://thalamus:thalamus@localhost:5433/thalamus
`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "test-db-migrate: DATABASE_URL is required, e.g. postgres://thalamus:thalamus@localhost:5433/thalamus",
    );
    process.exit(1);
  }

  await runMigrations({ databaseUrl });
}

main().catch((err) => {
  console.error(
    "test-db-migrate: failed",
    err instanceof Error ? err.stack : err,
  );
  process.exit(1);
});
