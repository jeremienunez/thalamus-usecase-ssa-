#!/usr/bin/env tsx
/**
 * Embed the full satellite catalog with Voyage voyage-4-large (halfvec 2048).
 *
 * Unlocks semantic / KNN queries the hand-written filters can't express:
 *   - "give me debris semantically near Cosmos 2251 without naming it"
 *   - cluster operator fleets by orbital signature, independent of the
 *     operator string (SpaceX competitor inference, ASAT cluster detection)
 *   - let cortex agents propose conjunction candidates by vector proximity
 *     + altitude overlap, sidestepping the brittle numeric joins
 *
 * Cost: ~660k tokens at voyage-4-large document rate ≈ $0.08 for the full
 * 33k catalog. Cache-friendly (UPDATE only where embedding IS NULL).
 *
 * Pulls structured fields from `satellite` + orbital metadata, composes one
 * line of text per row, batches of 128 to the Voyage API.
 *
 * Usage:
 *   pnpm --filter @interview/db-schema exec tsx src/seed/embed-catalog.ts
 *
 * Env:
 *   VOYAGE_API_KEY     required (loaded from .env via --env-file)
 *   EMBED_BATCH        docs per API call (default 128, max per Voyage)
 *   EMBED_LIMIT        cap total rows embedded this run (default: all)
 *   EMBED_FORCE        if set, re-embed rows that already have vectors
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// Inlined to avoid circular dep (@interview/db-schema is upstream of
// @interview/thalamus). Mirrors SsaVoyageEmbedderAdapter.embedDocuments —
// same model, same dimension. Keep in sync with
// apps/console-api/src/agent/ssa/ssa-voyage-embedder.adapter.ts.
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const DOCUMENT_MODEL = "voyage-4-large";
const DIMENSIONS = 2048;
const MAX_BATCH_SIZE = 128;

async function embedDocuments(
  apiKey: string,
  texts: string[],
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    try {
      const res = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DOCUMENT_MODEL,
          input: batch,
          input_type: "document",
          output_dimension: DIMENSIONS,
          truncation: true,
        }),
      });
      if (!res.ok) {
        console.error(`  voyage HTTP ${res.status}: ${await res.text()}`);
        continue;
      }
      const data = (await res.json()) as {
        data: { embedding: number[]; index: number }[];
      };
      for (const item of data.data) results[i + item.index] = item.embedding;
    } catch (err) {
      console.error(`  voyage call failed at batch ${i}:`, err);
    }
  }
  return results;
}

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const BATCH = Number(process.env.EMBED_BATCH ?? 128);
const LIMIT = process.env.EMBED_LIMIT ? Number(process.env.EMBED_LIMIT) : null;
const FORCE = process.env.EMBED_FORCE === "1";

interface Row {
  id: string;
  name: string;
  objectClass: string | null;
  noradId: number | null;
  launchYear: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  bus: string | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
  massKg: number | null;
}

/**
 * Compose a dense text line that captures both identity (name, NORAD,
 * operator) and orbital signature (regime, altitude band, inclination).
 * Semantic proximity in this space should cluster objects that share a
 * mission profile — which is what we want for KNN conjunction screening.
 */
function composeText(r: Row): string {
  const regime =
    r.apogeeKm != null && r.perigeeKm != null
      ? classifyRegime(r.perigeeKm, r.apogeeKm)
      : "unknown-regime";
  const alt =
    r.apogeeKm != null && r.perigeeKm != null
      ? `altitude ${Math.round(r.perigeeKm)}x${Math.round(r.apogeeKm)}km`
      : "altitude-unknown";
  const inc = r.inclinationDeg != null ? `inclination ${r.inclinationDeg.toFixed(1)}°` : "";
  const parts: string[] = [
    r.name,
    r.objectClass ?? "",
    regime,
    alt,
    inc,
    r.operator ?? "",
    r.operatorCountry ?? "",
    r.platformClass ?? "",
    r.bus ?? "",
    r.launchYear ? `launched ${r.launchYear}` : "",
    r.massKg != null ? `${Math.round(r.massKg)}kg` : "",
    r.noradId != null ? `NORAD ${r.noradId}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

function classifyRegime(perigee: number, apogee: number): string {
  const mean = (perigee + apogee) / 2;
  if (mean < 2000) return "LEO";
  if (mean < 35000) return "MEO";
  if (mean < 36500) return "GEO";
  return "HEO";
}

async function main(): Promise<void> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error("✗ VOYAGE_API_KEY missing — run via `pnpm exec dotenv` or set it in .env");
    process.exit(1);
  }

  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  try {
    const whereClause = FORCE
      ? sql``
      : sql`WHERE satellite.embedding IS NULL`;
    const limitClause = LIMIT ? sql`LIMIT ${LIMIT}` : sql``;

    const rows = await db.execute<Row & Record<string, unknown>>(sql`
      SELECT
        satellite.id::text AS id,
        satellite.name,
        satellite.object_class AS "objectClass",
        satellite.norad_id AS "noradId",
        satellite.launch_year AS "launchYear",
        o.name AS operator,
        oc.name AS "operatorCountry",
        pc.name AS "platformClass",
        sb.name AS bus,
        (satellite.metadata->>'apogeeKm')::numeric::float AS "apogeeKm",
        (satellite.metadata->>'perigeeKm')::numeric::float AS "perigeeKm",
        (satellite.metadata->>'inclinationDeg')::numeric::float AS "inclinationDeg",
        satellite.mass_kg AS "massKg"
      FROM satellite
      LEFT JOIN operator o ON o.id = satellite.operator_id
      LEFT JOIN operator_country oc ON oc.id = satellite.operator_country_id
      LEFT JOIN platform_class pc ON pc.id = satellite.platform_class_id
      LEFT JOIN satellite_bus sb ON sb.id = satellite.satellite_bus_id
      ${whereClause}
      ORDER BY satellite.id
      ${limitClause}
    `);

    const candidates: Row[] = rows.rows;
    console.log(`▸ ${candidates.length} rows to embed (force=${FORCE})`);
    if (candidates.length === 0) {
      console.log("▸ nothing to do — all rows already embedded");
      return;
    }

    let ok = 0, fail = 0;
    const t0 = Date.now();
    for (let i = 0; i < candidates.length; i += BATCH) {
      const chunk = candidates.slice(i, i + BATCH);
      const texts = chunk.map(composeText);
      const vectors = await embedDocuments(apiKey, texts);

      // Write vectors back in one transactional batch.
      await db.transaction(async (tx) => {
        for (let j = 0; j < chunk.length; j++) {
          const v = vectors[j];
          const row = chunk[j]!;
          if (!v) { fail++; continue; }
          // pgvector halfvec literal: [0.1,0.2,…]
          const literal = `[${v.join(",")}]`;
          await tx.execute(sql`
            UPDATE satellite
            SET embedding = ${literal}::halfvec(2048),
                embedding_model = 'voyage-4-large',
                embedded_at = NOW()
            WHERE id = ${BigInt(String(row.id))}
          `);
          ok++;
        }
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(
        `\r  embedded ${ok}/${candidates.length}  fail=${fail}  elapsed=${elapsed}s`,
      );
    }
    console.log("");

    const after = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(embedding)::int AS embedded,
        COUNT(*) FILTER (WHERE embedding IS NULL)::int AS missing
      FROM satellite
    `);
    console.log(`▸ catalog embedding state:`, after.rows[0]);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\n✗ embed failed:", err);
    process.exit(1);
  });
}
