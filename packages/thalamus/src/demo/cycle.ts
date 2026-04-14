/**
 * Demo: end-to-end Thalamus research cycle.
 *
 * Boots a minimal container against the live Postgres pool, runs one user-triggered
 * cycle on a hard-coded SSA query, then prints the cycle summary + top findings.
 *
 * Usage:
 *   THALAMUS_MODE=cloud    pnpm --filter @interview/thalamus demo-cycle  # live LLMs
 *   THALAMUS_MODE=fixtures pnpm --filter @interview/thalamus demo-cycle  # disk replay
 *   THALAMUS_MODE=record   pnpm --filter @interview/thalamus demo-cycle  # record + serve
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@interview/db-schema";
import { ResearchCycleTrigger } from "@interview/shared/enum";
import { buildThalamusContainer } from "../config/container";

const QUERY =
  "Upcoming conjunctions and traffic risk for Starlink constellation in the next 7 days";

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://thalamus:thalamus@localhost:5433/thalamus";
  const mode = process.env.THALAMUS_MODE ?? "cloud";

  console.log(`\n┌─ Thalamus Demo Cycle ────────────────────────────────────`);
  console.log(`│ mode:     ${mode}`);
  console.log(`│ database: ${redact(databaseUrl)}`);
  console.log(`│ query:    ${QUERY}`);
  console.log(`└──────────────────────────────────────────────────────────\n`);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  const c = buildThalamusContainer({ db });

  console.log(
    `[registry] discovered ${c.registry.size()} cortex skills: ${c.registry
      .names()
      .slice(0, 6)
      .join(", ")}${c.registry.size() > 6 ? ", …" : ""}\n`,
  );

  const t0 = Date.now();
  let cycle;
  try {
    cycle = await c.thalamusService.runCycle({
      query: QUERY,
      triggerType: ResearchCycleTrigger.User,
      lang: "en",
      mode: "audit",
      // Lowered below the default 0.7 so data-audit findings
      // ("data suspect, withhold burns") survive the confidence gate and
      // land in the kept set for the reviewer to see.
      minConfidence: 0.5,
    });
  } catch (err) {
    console.error("Cycle failed:", err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  }
  const elapsedMs = Date.now() - t0;

  console.log(`\n┌─ Cycle Summary ──────────────────────────────────────────`);
  console.log(`│ id:         ${cycle.id}`);
  console.log(`│ status:     ${cycle.status}`);
  console.log(`│ cortices:   ${(cycle.corticesUsed ?? []).join(", ")}`);
  console.log(`│ findings:   ${cycle.findingsCount ?? 0}`);
  console.log(`│ totalCost:  $${(cycle.totalCost ?? 0).toFixed(4)}`);
  console.log(`│ elapsed:    ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`└──────────────────────────────────────────────────────────\n`);

  // Top findings
  const findings = await c.graphService.listFindings({
    limit: 5,
    minConfidence: 0.5,
  });

  if (findings.length > 0) {
    console.log("Top Findings:");
    console.log(
      "  " +
        pad("title", 50) +
        " " +
        pad("cortex", 20) +
        " " +
        pad("conf", 6) +
        " " +
        pad("urg", 6),
    );
    console.log("  " + "-".repeat(86));
    for (const f of findings) {
      console.log(
        "  " +
          pad(truncate(f.title, 50), 50) +
          " " +
          pad(String(f.cortex), 20) +
          " " +
          pad(f.confidence.toFixed(2), 6) +
          " " +
          pad(String(f.urgency ?? "-"), 6),
      );
    }
    console.log("");
  } else {
    console.log("(no findings persisted — check logs for SQL/LLM errors)\n");
  }

  // Edge counts via stats
  try {
    const stats = await c.graphService.getGraphStats();
    console.log(
      `Graph state: ${stats.totalFindings} findings, ${stats.totalEdges} edges, ${stats.recentCount24h} new in last 24h\n`,
    );
  } catch {
    // entity resolver might not be wired in some envs
  }

  await pool.end();
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function redact(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
